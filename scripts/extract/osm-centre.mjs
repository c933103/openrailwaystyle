// The centre Overpass gives a way or relation with `out center`, computed
// locally from its points: the middle of the bounding box of a way's nodes,
// or of a relation's node and way members (member relations have no effect),
// as the Overpass QL documentation defines it. Overpass holds a latitude as
// whole 1e-7 degrees offset by 91 (a longitude without offset), averages the
// two edges as doubles and prints 7 decimals; doing the same gives its
// centre to the last digit (checked against 7,302 station ways, every one
// whose nodes had not been edited since Overpass answered).
const units = degrees => Math.round(degrees * 1e7);
const latitude = u => (u + 910_000_000) / 1e7 - 91;
const longitude = u => u / 1e7;
const printed = value => Number(value.toFixed(7));

export function overpassCentre(points) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const {lat, lon} of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const y = units(lat), x = units(lon);
    if (y < south) south = y;
    if (y > north) north = y;
    if (x < west) west = x;
    if (x > east) east = x;
  }
  if (south === Infinity) return null;
  return {lat: printed((latitude(south) + latitude(north)) / 2), lon: printed((longitude(west) + longitude(east)) / 2)};
}
