"""Read-only comparison of the exact Atlas crossings candidates."""
from collections import Counter, defaultdict
from pathlib import Path
import gzip
import json
import math
import sys

folder = Path(sys.argv[1])
cutoff = json.loads((folder / "source.json").read_text())["osmTimestamp"]
regions = [(tuple(map(float, key.split(","))), seen)
           for key, seen in json.loads((folder / "regions.json").read_text())["changes"].items()]
def evidence(row):
    lat, lon = map(float, row[1:3])
    matches = [seen for (south, west, north, east), seen in regions
               if south <= lat < north and west <= lon < east]
    assert len(matches) == 1, (lat, lon, matches)
    return "Overpass older than extract floor" if matches[0] < cutoff else "Overpass not older than extract floor"

def tile(row):
    lat, lon = map(float, row[1:3])
    n = 512
    return f"9/{int((lon + 180) * n / 360)}/{int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)*n/2)}"

def records(path):
    with gzip.open(path, "rt", encoding="utf-8") as rows:
        previous = -1
        for line in rows:
            ahead = line.rstrip("\n").split("\t")
            ident = int(ahead[0])
            assert ident > previous
            previous = ident
            yield ident, ahead

a = iter(records(folder / "old.tsv.gz"))
b = iter(records(folder / "new.tsv.gz"))
p, q = next(a, None), next(b, None)
counts = defaultdict(Counter)
removed_tiles = defaultdict(list)
changed_kind = Counter()
while p is not None or q is not None:
    if q is None or p is not None and p[0] < q[0]:
        counts[evidence(p[1])]["only Overpass"] += 1
        if tile(p[1]) in {"9/173/294", "9/408/208"}:
            removed_tiles[tile(p[1])].append(p[0])
        p = next(a, None)
    elif p is None or q[0] < p[0]:
        counts[evidence(q[1])]["only extract"] += 1
        q = next(b, None)
    else:
        old, new = p[1], q[1]
        newer = evidence(old)
        if old[1:3] != new[1:3]:
            changed_kind[(newer, "coordinates")] += 1
        if old[3:5] != new[3:5]:
            changed_kind[(newer, "kind/minor")] += 1
        x, y = list(map(lambda v: json.loads(v[5]) if len(v) > 5 else {}, (old, new)))
        same = list(map(float, old[1:3])) == list(map(float, new[1:3])) and old[3:5] == new[3:5] and x == y
        counts[newer]["same row" if same else "changed row"] += 1
        p, q = next(a, None), next(b, None)
merged = sum(counts.values(), Counter())
assert merged["same row"] + merged["changed row"] + merged["only Overpass"] == 1232432, merged
assert merged["same row"] + merged["changed row"] + merged["only extract"] == 1233878, merged
report = {"oldTimestampComparedTo": cutoff, "groups": counts,
          "coordinateOrClassification": {"/".join(k):v for k,v in changed_kind.items()},
          "missingTileCanonicalNodeIDs": removed_tiles, "total": merged}
print("## Pinned level crossings data comparison")
print("\n```json\n" + json.dumps(report, indent=2) + "\n```")
