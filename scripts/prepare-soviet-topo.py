#!/usr/bin/env python3
"""Prepare a transparent tiled mosaic from local historical scans and calibrations."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

from osgeo import gdal, ogr
from PIL import Image
from pmtiles.tile import Compression, TileType, deserialize_header, zxy_to_tileid
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


def mosaic_tiles(tiles, mosaic):
    # Only tiles shared by two footprints need decoding. Independent sheets
    # stay sparse, so a global build never allocates a world-sized raster.
    for tile in tiles.glob("*/*/*.png"):
        target = mosaic / tile.relative_to(tiles)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            tile.replace(target)
            continue
        with Image.open(target) as base, Image.open(tile) as above:
            combined = Image.alpha_composite(base.convert("RGBA"), above.convert("RGBA"))
        combined.save(target)


def archive_tiles(directory, output, sheets):
    tiles = {}
    for path in directory.glob("*/*/*.png"):
        z, x, y = map(int, (*path.relative_to(directory).parts[:2], path.stem))
        tiles[zxy_to_tileid(z, x, y)] = path
    if not tiles:
        raise ValueError("The raster produced no nonempty tiles")
    west = min(s["bounds"][0] for s in sheets)
    south = min(s["bounds"][1] for s in sheets)
    east = max(s["bounds"][2] for s in sheets)
    north = max(s["bounds"][3] for s in sheets)
    header = {
        "tile_type": TileType.PNG,
        "tile_compression": Compression.NONE,
        "min_lon_e7": round(west * 1e7),
        "min_lat_e7": round(south * 1e7),
        "max_lon_e7": round(east * 1e7),
        "max_lat_e7": round(north * 1e7),
        "center_lon_e7": round((east + west) * 5e6),
        "center_lat_e7": round((north + south) * 5e6),
        "center_zoom": (sheets[0]["minzoom"] + sheets[0]["maxzoom"]) // 2,
    }
    with write(output) as archive:
        for tile_id, path in sorted(tiles.items()):
            archive.write_tile(tile_id, path.read_bytes())
        archive.finalize(header, {"name": "Historical topographic maps", "sheets": sheets})
    return len(tiles)


def validate_sheet(sheet, root):
    for key in ("calibration", "id", "name", "date", "source", "credit"):
        if not isinstance(sheet.get(key), str) or not sheet[key].strip():
            raise ValueError(f"Expected nonempty {key} for every sheet")
    url = urlparse(sheet["source"])
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ValueError("Source must be an HTTPS catalogue URL")
    for key in ("scale", "minzoom", "maxzoom"):
        if type(sheet.get(key)) is not int:
            raise ValueError(f"Expected integer {key} for every sheet")
    if sheet["scale"] <= 0 or not 0 <= sheet["minzoom"] <= sheet["maxzoom"] <= 13:
        raise ValueError("Expected a positive scale and zooms between 0 and 13")
    calibration = root / sheet["calibration"]
    if calibration.suffix.lower() != ".map" or not calibration.is_file():
        raise ValueError(f"Local calibration file not found: {calibration}")
    return {**sheet, "calibration": calibration}


def prepare_sheet(sheet, stage):
    calibration = sheet["calibration"]
    raster = gdal.Open(str(calibration))
    grid = raster.GetGCPSpatialRef()
    if grid is None or raster.GetGCPCount() < 4:
        raise ValueError(f"{calibration}: expected a declared datum and at least four calibration points")
    if raster.RasterCount != 1 or raster.GetRasterBand(1).GetColorTable() is None:
        raise ValueError(f"{calibration}: expected an indexed-colour original sheet")
    boundary = sheet_boundary(calibration)
    rgb = gdal.Translate(str(stage / "colour.vrt"), raster, format="VRT", rgbExpand="rgb")
    output = stage / "sheet.tif"
    warped = gdal.Warp(
        str(output), rgb, dstSRS="EPSG:3857", tps=True, errorThreshold=0,
        cutlineWKT=boundary.ExportToWkt(), cutlineSRS=grid.CloneGeogCS().ExportToWkt(),
        cropToCutline=True, dstAlpha=True, resampleAlg="bilinear",
        creationOptions=["TILED=YES", "COMPRESS=DEFLATE"],
    )
    wgs84 = gdal.Info(warped, format="json")["wgs84Extent"]["coordinates"][0]
    if max(x for x, _ in wgs84) - min(x for x, _ in wgs84) > 180:
        raise ValueError(f"{calibration}: split a sheet crossing the antimeridian before tiling")
    bounds = [max(-180, min(x for x, _ in wgs84)), max(-85.051129, min(y for _, y in wgs84)),
              min(180, max(x for x, _ in wgs84)), min(85.051129, max(y for _, y in wgs84))]
    warped = None
    tiles = stage / "tiles"
    subprocess.run([
        "gdal2tiles", "--quiet", "--xyz", "--exclude", "--webviewer=none",
        "--resampling=average", f"--zoom={sheet['minzoom']}-{sheet['maxzoom']}", str(output), str(tiles),
    ], check=True)
    if not any(tiles.glob("*/*/*.png")):
        raise ValueError(f"{calibration}: no nonempty tiles")
    details = {key: sheet[key] for key in ("id", "name", "date", "scale", "source", "credit", "minzoom", "maxzoom")}
    return tiles, {
        **details, "bounds": bounds,
        "alignment": "Calibrated from the scan grid. Historical survey and alignment accuracy vary.",
    }


def write_index(output, stage, groups):
    manifest = stage / "index.json"
    manifest.write_text(json.dumps({"version": 2, "groups": groups}, indent=2) + "\n")
    manifest.replace(output / "index.json")


def build(sheets, output):
    gdal.UseExceptions()
    ogr.UseExceptions()
    groups = defaultdict(list)
    for sheet in sheets:
        groups[sheet["scale"], sheet["minzoom"], sheet["maxzoom"]].append(sheet)
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".build-", dir=output) as temporary:
        stage = Path(temporary)
        results = []
        # The coarser archive stays available above its native zoom where the
        # finer layer has no tile. MapLibre overzooms each source independently.
        for key in sorted(groups, key=lambda group: (-group[0], group[1], group[2])):
            details = []
            with TemporaryDirectory(prefix="group-", dir=stage) as group_directory:
                group_stage = Path(group_directory)
                mosaic = group_stage / "mosaic"
                for sheet in groups[key]:
                    with TemporaryDirectory(prefix="sheet-", dir=group_stage) as sheet_directory:
                        tiles, item = prepare_sheet(sheet, Path(sheet_directory))
                        mosaic_tiles(tiles, mosaic)
                        details.append(item)
                archive = group_stage / "source.pmtiles"
                count = archive_tiles(mosaic, archive, details)
                with archive.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                name = f"{digest}.pmtiles"
                archive.replace(output / name)
            results.append({"archives": [name], "sheets": details})
            print(f"{len(details)} sheets · {count} tiles · {output / name}", flush=True)
        write_index(output, stage, results)


def stage_archive(path, output, stage):
    with path.open("rb") as stream:
        header = deserialize_header(stream.read(127))
        if header["tile_type"] not in (TileType.PNG, TileType.WEBP):
            raise ValueError(f"{path}: expected a PNG or WebP raster archive")
        if header["min_zoom"] > header["max_zoom"] or header["max_zoom"] > 13:
            raise ValueError(f"{path}: unsupported archive zoom range")
        length = header["tile_data_offset"] + header["tile_data_length"]
        if path.stat().st_size != length:
            raise ValueError(f"{path}: incomplete archive")
        stream.seek(0)
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    name = f"{digest}.pmtiles"
    target = output / name
    if not target.exists():
        candidate = stage / name
        shutil.copyfile(path, candidate)
        with candidate.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                raise ValueError(f"{path}: file changed during staging")
        candidate.replace(target)
    elif target.stat().st_size != length:
        raise ValueError(f"{target}: existing archive has an unexpected length")
    return name


def stage_published_archives(catalogue, root, output):
    """Assemble locally downloaded files and their published sheet indexes."""
    groups = catalogue["groups"]
    if not isinstance(groups, list) or not groups or not all(isinstance(group, dict) for group in groups):
        raise ValueError("Expected a nonempty array of archive groups")
    ogr.UseExceptions()
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".build-", dir=output) as temporary:
        stage = Path(temporary)
        results = []
        seen = set()
        previous_scale = float("inf")
        for group in groups:
            scale = group.get("scale")
            if type(scale) is not int or not 0 < scale <= previous_scale:
                raise ValueError("Order archive groups by scale, coarsest first")
            previous_scale = scale
            credit, source = group.get("credit"), group.get("source")
            url = urlparse(source) if isinstance(source, str) else None
            if not isinstance(credit, str) or not credit.strip() or not url or url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("An archive group needs a credit and HTTPS source URL")
            paths = group.get("archives")
            if not isinstance(paths, list) or not paths or not all(isinstance(path, str) and path for path in paths):
                raise ValueError("An archive group must list local PMTiles files")
            index = group.get("footprints")
            if not isinstance(index, str) or not index or not (root / index).is_file():
                raise ValueError("An archive group needs a local GeoJSON footprint index")
            vector = ogr.Open(str(root / index))
            layer = vector.GetLayer()
            if not layer.GetSpatialRef() or not layer.GetSpatialRef().IsGeographic():
                raise ValueError(f"{index}: expected geographic sheet footprints")
            sheets = []
            for feature in layer:
                geometry = feature.GetGeometryRef()
                identifier = feature.GetField("id")
                if not identifier or geometry is None or geometry.IsEmpty():
                    continue
                year = feature.GetField("year") if feature.GetFieldIndex("year") >= 0 else None
                parts = list(geometry) if geometry.GetGeometryName() == "MULTIPOLYGON" else [geometry]
                for part in parts:
                    west, east, south, north = part.GetEnvelope()
                    bounds = [max(-180, west), max(-85.051129, south), min(180, east), min(85.051129, north)]
                    if bounds[0] < bounds[2] and bounds[1] < bounds[3]:
                        sheets.append({
                            "id": identifier, "name": identifier, "scale": scale, "bounds": bounds,
                            "date": f"Catalogue date {year}" if year else "Date unverified",
                            "source": source, "credit": credit,
                            "alignment": "Catalogue footprint and georeferencing. Survey and alignment accuracy vary.",
                        })
            if not sheets:
                raise ValueError(f"{index}: no historical sheet footprints")
            names = [stage_archive(root / path, output, stage) for path in paths]
            for name in names:
                if name in seen:
                    raise ValueError("The same archive occurs more than once")
                seen.add(name)
            results.append({"archives": names, "sheets": sheets})
            print(f"{len(names)} archives · {len(sheets)} sheet footprints · 1:{scale:,}", flush=True)
        write_index(output, stage, results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="A local .map file or a JSON array of sheet records")
    parser.add_argument("output", type=Path, help="Local styles/data/soviet-topo directory")
    parser.add_argument("--sheet", help="Printed sheet identifier for a single .map file")
    parser.add_argument("--name", help="Sheet or region name to display")
    parser.add_argument("--date", help="Cartographic date and its meaning as printed")
    parser.add_argument("--scale", type=int, help="Scale denominator")
    parser.add_argument("--source", help="HTTPS page for the archive or sheet")
    parser.add_argument("--credit", help="Source credit to display")
    parser.add_argument("--minzoom", type=int)
    parser.add_argument("--maxzoom", type=int)
    args = parser.parse_args()
    details = {key: getattr(args, key) for key in ("name", "date", "scale", "source", "credit", "minzoom", "maxzoom")}
    try:
        if args.input.suffix.lower() == ".json":
            if args.sheet is not None or any(value is not None for value in details.values()):
                raise ValueError("Put sheet details in the catalogue when using a JSON input")
            records = json.loads(args.input.read_text())
            if isinstance(records, dict) and "groups" in records:
                stage_published_archives(records, args.input.parent, args.output)
                return
            if not isinstance(records, list) or not records or not all(isinstance(sheet, dict) for sheet in records):
                raise ValueError("Expected a nonempty array of sheet records")
            sheets = [validate_sheet(record, args.input.parent) for record in records]
        else:
            if details["minzoom"] is None:
                details["minzoom"] = 3
            sheets = [validate_sheet({**details, "calibration": str(args.input), "id": args.sheet}, Path.cwd())]
        build(sheets, args.output)
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
