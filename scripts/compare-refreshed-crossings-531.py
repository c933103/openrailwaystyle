"""Report exact node evidence from two pinned regional working copies."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote

root = Path(sys.argv[1])
older, fresher = [json.loads((root / name).read_text()) for name in sys.argv[2:]]
requested_regions = {"south-america", "australia-oceania"}
assert older["filter"] == fresher["filter"]
assert len(older["regions"]) == 175 and older["regions"].keys() == fresher["regions"].keys()
changed = {key for key, value in older["regions"].items() if fresher["regions"][key] != value}
assert changed == requested_regions, sorted(changed)
baseline = json.loads((root / "baseline.md").read_text().split("```json\n")[1].split("\n```")[0])
unresolved = baseline["laterOverpassOnly"]
assert len(unresolved) == 15, unresolved
ids = ["n" + str(rec["id"]) for rec in unresolved]

print("## Refreshed OSM row evidence\n")
print("Both requested copies changed; 173 other index records are unchanged.")
found = {}
for region in sorted(requested_regions):
    before, after = older["regions"][region], fresher["regions"][region]
    assert after["sourceDate"] == "2026-11-24" and after["sourceTimestamp"] > before["sourceTimestamp"]
    asset = after["asset"]
    assert re.fullmatch(r"region-[a-z0-9-]+-20261124-[a-f0-9]{12}\.osm\.pbf", asset), asset
    subprocess.run(["gh", "release", "download", "osm-extract", "--pattern", asset, "--dir", str(root)], check=True)
    payload = root / asset
    with payload.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    assert digest == after["sha256"] and payload.stat().st_size == after["bytes"]
    print(f"- {region}: {before['sourceTimestamp']} → {after['sourceTimestamp']}, SHA-256 verified.")
    result = subprocess.run(["osmium", "getid", "--verbose-ids", "-f", "opl", str(payload), *ids], capture_output=True, text=True)
    returned = {line.split()[0] for line in result.stdout.splitlines()}
    missing_line = re.search(r"^Missing node IDs: ([0-9 ]+)$", result.stderr, re.M)
    missing = {"n" + value for value in missing_line.group(1).split()} if missing_line else set()
    assert result.returncode == int(bool(missing)) and not returned & missing and returned | missing == set(ids), result.stderr
    for line in result.stdout.splitlines():
        ident, *fields = line.split()
        assert ident in ids
        fields = {field[0]: field[1:] for field in fields}
        tags = dict(pair.split("=", 1) for pair in fields.get("T", "").split(",") if "=" in pair)
        record = {"region": region, "railway": unquote(tags.get("railway", "")), "version": fields.get("v"),
                  "sourceTimestamp": fields.get("t"), "lon": fields.get("x"), "lat": fields.get("y")}
        found.setdefault(ident, []).append(record)

def state(ident):
    if ident not in found:
        return "not in either refreshed filtered copy"
    if any(row["railway"] in ("level_crossing", "crossing") for row in found[ident]):
        return "crossing in refreshed copy"
    return "node present without crossing classification"

print("\n```json")
print(json.dumps([{"overpass": rec, "regionalMatches": found.get(ident, []), "status": state(ident)}
                  for ident, rec in zip(ids, unresolved)], indent=2))
print("```")
print("\nFiltered absence is not a claim of deletion from the underlying OSM history.")
