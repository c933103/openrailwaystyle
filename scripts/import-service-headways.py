#!/usr/bin/env python3
"""Import published numerical headways; never infer trains from OSM relations."""
import argparse
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request

SOURCE = "https://www.mtr.com.hk/en/customer/services/train_service_index.html"
FULL_LINES = {"Island Line": "ISL", "Tsuen Wan Line": "TWL", "South Island Line": "SIL",
              "Disneyland Resort Line": "DRL", "Tuen Ma Line": "TML", "Airport Express": "AEL"}
PERIODS = ["am", "pm", "offpeak", "saturday", "sunday_holiday"]


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if tag in ("td", "th"):
            self.cell = []

    def handle_data(self, value):
        if self.cell is not None:
            self.cell.append(value)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            if self.row is not None:
                self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        if tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None


def interval(raw):
    # A slash can mean direction-specific service; retain it without guessing.
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?", raw)
    if not match:
        return {"reported": raw, "minutes": None}
    lo, hi = float(match[1]), float(match[2] or match[1])
    if not 0 < lo <= hi <= 1440:
        raise ValueError(f"Invalid published headway: {raw}")
    return {"reported": raw, "minutes": [lo, hi]}


def parse(raw, checked):
    parser = Tables()
    parser.feed(raw.decode("utf-8"))
    rows, full = [], set()
    for cells in parser.rows:
        if len(cells) != 6 or not any(re.search(r"\d", cell) for cell in cells[1:]):
            continue
        label = cells[0].rstrip("~#").strip()
        if label in FULL_LINES:
            ref, network, kind = FULL_LINES[label], "港鐵 MTR", "subway"
        elif re.fullmatch(r"Route \d+P?", label):
            ref, network, kind = label.split()[1], "輕鐵 Light Rail", "light_rail"
        else:
            ref, network, kind = None, None, None
        record = {"id": "mtr-hk/" + (ref or re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")),
                  "label": label, "match": {"ref": ref, "network": network, "kind": kind} if ref else None,
                  "scope": "whole_route" if ref else "section_requires_mapping",
                  "profiles": {period: interval(value) for period, value in zip(PERIODS, cells[1:])}}
        rows.append(record)
        if ref:
            full.add(ref)
    expected = set(FULL_LINES.values()) | {"505", "507", "610", "614", "614P", "615", "615P", "705", "706", "751", "761P"}
    if full != expected or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Source table changed or is incomplete; audit before replacing data")
    return {"schema": 1, "source": {"id": "mtr-hk", "name": "MTR published average headways", "url": SOURCE,
            "checked": checked, "review_after_days": 30, "sha256": hashlib.sha256(raw).hexdigest(),
            "timezone": "Asia/Hong_Kong", "quality": "published_headway_estimate",
            "period_definition": "Operator's weekday morning peak, evening peak and non-peak categories; clock windows are not supplied on this page.",
            "notes": ["The hourly estimate is 60 divided by the reported minutes; it is not an exact departure count.",
                      "Use the lower hourly bound for width and retain both bounds in details.",
                      "Non-peak excludes early morning and late night exceptions.",
                      "Disneyland Resort Line has 10–20 minute headways while the park is closed; the normal-service profile does not cover that condition.",
                      "Route 751P adds weekday peak service on part of 751; its own headway is not published here and remains unknown.",
                      "Section-specific heavy-rail rows are retained but must not be applied to an entire branched route."]},
            "routes": sorted(rows, key=lambda row: row["id"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, help="Reuse an already downloaded official page")
    parser.add_argument("--checked", default=dt.datetime.now(dt.timezone.utc).date().isoformat())
    parser.add_argument("--out", type=Path, default=Path("styles/service-headways.json"))
    args = parser.parse_args()
    dt.date.fromisoformat(args.checked)
    if args.html:
        raw = args.html.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE, timeout=30) as response:
            raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError("Source exceeded the 2 MB import budget")
    result = parse(raw, args.checked)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(result['routes'])} published rows; {sum(bool(r['match']) for r in result['routes'])} whole routes can be matched.")


if __name__ == "__main__":
    main()
