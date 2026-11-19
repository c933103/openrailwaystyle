#!/usr/bin/env python3
"""Prepare a local original map and OziExplorer calibration for the Atlas preview."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

from osgeo import gdal, ogr
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write


def sheet_boundary(calibration):
    corners = []
    for line in calibration.read_text(encoding="latin-1").splitlines():
        fields = line.split(",")
        if fields[0] == "MMPLL":
            lon, lat = map(float, fields[2:4])
            if not (-180 <= lon <= 180 and -85.051129 <= lat <= 85.051129):
                raise ValueError("Sheet corners must be within Web Mercator")
            corners.append((lon, lat))
    if len(corners) < 4 or not 0 < max(x for x, _ in corners) - min(x for x, _ in corners) < 180:
        raise ValueError("Expected a single non-antimeridian sheet footprint")
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for lon, lat in [*corners, corners[0]]:
        ring.AddPoint_2D(lon, lat)
    polygon = ogr.Geometry(ogr.wkbPolygon)
    polygon.AddGeometry(ring)
    if not polygon.IsValid() or polygon.GetArea() <= 0:
        raise ValueError("The sheet footprint must be a valid polygon")
    return polygon


def archive_tiles(directory, output, sheet):
    tiles = {}
    for path in directory.glob("*/*/*.png"):
        z, x, y = map(int, (*path.relative_to(directory).parts[:2], path.stem))
        tiles[zxy_to_tileid(z, x, y)] = path
    if not tiles:
        raise ValueError("The raster produced no nonempty tiles")
    west, south, east, north = sheet["bounds"]
    header = {
        "tile_type": TileType.PNG,
        "tile_compression": Compression.NONE,
        "min_lon_e7": round(west * 1e7),
        "min_lat_e7": round(south * 1e7),
        "max_lon_e7": round(east * 1e7),
        "max_lat_e7": round(north * 1e7),
        "center_lon_e7": round((east + west) * 5e6),
        "center_lat_e7": round((north + south) * 5e6),
        "center_zoom": (sheet["minzoom"] + sheet["maxzoom"]) // 2,
    }
    with write(output) as archive:
        for tile_id, path in sorted(tiles.items()):
            archive.write_tile(tile_id, path.read_bytes())
        archive.finalize(header, {"name": sheet["name"], "sheets": [sheet]})
    return len(tiles)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("calibration", type=Path, help="OziExplorer .map file next to its original scan")
    parser.add_argument("output", type=Path, help="Local styles/data/soviet-topo directory")
    parser.add_argument("--sheet", required=True, help="Printed sheet identifier")
    parser.add_argument("--name", required=True, help="Sheet or region name to display")
    parser.add_argument("--date", required=True, help="Cartographic date and its meaning as printed")
    parser.add_argument("--scale", required=True, type=int, help="Scale denominator")
    parser.add_argument("--source", required=True, help="HTTPS page for the archive or sheet")
    parser.add_argument("--credit", required=True, help="Source credit to display")
    parser.add_argument("--minzoom", type=int, default=3)
    parser.add_argument("--maxzoom", type=int, required=True)
    args = parser.parse_args()
    url = urlparse(args.source)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        parser.error("--source must be an HTTPS catalogue URL")
    if args.scale <= 0 or not 0 <= args.minzoom <= args.maxzoom <= 13:
        parser.error("Expected a positive scale and preview zooms between 0 and 13")

    gdal.UseExceptions()
    ogr.UseExceptions()
    raster = gdal.Open(str(args.calibration))
    grid = raster.GetGCPSpatialRef()
    if grid is None or raster.GetGCPCount() < 4:
        parser.error("The original sheet must have a declared datum and at least four calibration points")
    if raster.RasterCount != 1 or raster.GetRasterBand(1).GetColorTable() is None:
        parser.error("Expected an indexed-colour original sheet")
    boundary = sheet_boundary(args.calibration)
    args.output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".build-", dir=args.output) as temporary:
        stage = Path(temporary)
        rgb = gdal.Translate(str(stage / "colour.vrt"), raster, format="VRT", rgbExpand="rgb")
        output = stage / "sheet.tif"
        warped = gdal.Warp(
            str(output), rgb, dstSRS="EPSG:3857", tps=True, errorThreshold=0,
            cutlineWKT=boundary.ExportToWkt(), cutlineSRS=grid.CloneGeogCS().ExportToWkt(),
            cropToCutline=True, dstAlpha=True, resampleAlg="bilinear",
            creationOptions=["TILED=YES", "COMPRESS=DEFLATE"],
        )
        wgs84 = gdal.Info(warped, format="json")["wgs84Extent"]["coordinates"][0]
        bounds = [min(x for x, _ in wgs84), min(y for _, y in wgs84),
                  max(x for x, _ in wgs84), max(y for _, y in wgs84)]
        warped = None
        tiles = stage / "tiles"
        subprocess.run([
            "gdal2tiles", "--quiet", "--xyz", "--exclude", "--webviewer=none",
            "--resampling=average", f"--zoom={args.minzoom}-{args.maxzoom}", str(output), str(tiles),
        ], check=True)
        sheet = {
            "id": args.sheet, "name": args.name, "date": args.date, "scale": args.scale, "bounds": bounds,
            "source": args.source, "credit": args.credit, "minzoom": args.minzoom, "maxzoom": args.maxzoom,
            "alignment": "Calibrated from the scan grid. Historical survey and alignment accuracy vary.",
        }
        archive = stage / "preview.pmtiles"
        count = archive_tiles(tiles, archive, sheet)
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        name = f"{digest}.pmtiles"
        manifest = stage / "index.json"
        manifest.write_text(json.dumps({"version": 1, "archive": name, "sheets": [sheet]}, indent=2) + "\n")
        archive.replace(args.output / name)
        manifest.replace(args.output / "index.json")
        print(f"{count} tiles · {args.output / name}")


if __name__ == "__main__":
    main()
