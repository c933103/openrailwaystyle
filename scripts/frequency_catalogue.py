#!/usr/bin/env python3
"""Normalize Transitous and Mobility Database discovery without licence allow-lists.

Catalogue metadata is evidence, not a licence granted by the catalogue. Terms
and provenance are retained for every contributing source. No GTFS ZIP is
downloaded by this script; the main compiler decides whether a schedule is rail.
"""
import argparse
from collections import Counter
import csv
import json
from pathlib import Path
import re
from urllib.parse import urlsplit, urlunsplit

TRANSITOUS_LICENSES = "https://github.com/public-transport/transitous/blob/main/website/data/license.json"
TRANSITOUS_FEEDS = "https://github.com/public-transport/transitous/tree/main/feeds"
MOBILITY_CSV = "https://files.mobilitydatabase.org/feeds_v2.csv"


def source_key(url):
    """Deduplicate an identical producer URL, not an operator name or region."""
    try:
        parts = urlsplit(url or "")
    except ValueError:
        return ""
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return ""
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(),
                       parts.path, parts.query, ""))


def licence_evidence(value, origin, ref):
    value = value if isinstance(value, dict) else {}
    def field(*names):
        for name in names:
            if name in value and value[name] not in (None, ""):
                return value[name]
        return None
    spdx = field("spdx_license_identifier", "spdx-identifier", "spdx_identifier")
    url = field("license_url", "url", "terms_url")
    restrictions = {
        "create_derived_product": field("create_derived_product", "create-derived-product"),
        "redistribution_allowed": field("redistribution_allowed", "redistribution-allowed"),
        "commercial_use_allowed": field("commercial_use_allowed", "commercial-use-allowed"),
        "prohibit_frequency_use": field("prohibit_frequency_use"),
    }
    restrictions = {k: v for k, v in restrictions.items() if v is not None}
    if not (spdx or url or restrictions):
        return None
    return {"origin": origin, "reference": ref, "spdx": spdx or "",
            "terms_url": url or "", "restrictions": restrictions}


def is_no(value):
    return value is False or (isinstance(value, str) and value.strip().lower() in ("no", "false", "prohibited", "forbidden", "0"))


def usage_rights(row):
    """Reject only documented restrictions on the intended derived-use output.

    An unknown SPDX identifier or a URL-only terms link is *not* a denial.
    Source-specific reviewed prohibitions can be encoded in rules, bound to
    expected_source, with their evidence link retained.
    """
    evidences = list(row.get("rights_evidence") or [])
    if not evidences:
        old = licence_evidence(row, "catalogue", row.get("catalogue_url", TRANSITOUS_LICENSES))
        if old:
            evidences.append(old)
    denials = []
    for item in evidences:
        spdx = (item.get("spdx") or "").upper()
        restrictions = item.get("restrictions") or {}
        if re.match(r"^CC-BY-(?:NC-)?ND-", spdx):
            denials.append({"origin": item.get("origin"), "reference": item.get("reference"),
                            "basis": "NoDerivatives licence (" + spdx + ")"})
        if is_no(restrictions.get("create_derived_product")) or restrictions.get("prohibit_frequency_use") is True:
            denials.append({"origin": item.get("origin"), "reference": item.get("reference"),
                            "basis": "explicit restriction on derived frequency use"})
    known = sorted({x.get("spdx") for x in evidences if x.get("spdx")})
    urls = sorted({x.get("terms_url") for x in evidences if x.get("terms_url")})
    return {"state": "prohibited" if denials else ("linked" if urls else "identified" if known else "not_provided"),
            "prohibitions": denials, "spdx_identifiers": known, "terms_urls": urls,
            "evidence": evidences, "conflicting_spdx": len(known) > 1}


def compact_mobility(row):
    get = lambda *names: next((str(row[name]).strip() for name in names
        if row.get(name) not in ("", None)), "")
    return {"id": get("id", "mdb_source_id"), "data_type": get("data_type"),
            "status": get("status"), "provider": get("provider"),
            "name": get("name"), "country": get("location.country_code", "country_code"),
            "download": get("urls.direct_download", "urls.direct_download_url", "urls.latest",
                            "direct_download_url", "latest"),
            "terms_url": get("urls.license", "urls.license_url", "license_url"),
            "authentication_type": get("urls.authentication_type", "authentication_type")}


def build_catalogue(licences, feed_sources, mobility_rows):
    """feed_sources: (region, source, pinned source-list URL) tuples."""
    rows = {}
    by_mdb = {}
    by_url = {}
    counts = Counter()
    for item in licences:
        name = item.get("filename", "")
        if not name.endswith(".gtfs.zip"):
            continue
        row = dict(item)
        row["catalogue_url"] = TRANSITOUS_LICENSES
        row["delivery"] = "transitous"
        row["lineage"] = [{"catalogue": "transitous-licence", "id": name,
                           "url": TRANSITOUS_LICENSES, "source": item.get("source", "")}]
        ev = licence_evidence(item, "transitous-licence", TRANSITOUS_LICENSES)
        row["rights_evidence"] = [ev] if ev else []
        rows[name] = row
        if source_key(item.get("source")):
            by_url.setdefault(source_key(item["source"]), name)
        counts["transitous_licence"] += 1

    def append(row, lineage, evidence=None):
        if lineage not in row["lineage"]:
            row["lineage"].append(lineage)
        if evidence is not None and evidence not in row["rights_evidence"]:
            row["rights_evidence"].append(evidence)

    for region, item, source_list_url in feed_sources:
        if not isinstance(item, dict) or item.get("spec", "gtfs") not in ("gtfs", ""):
            counts["non_schedule"] += 1
            continue
        name = item.get("name", "")
        if not isinstance(name, str) or not name or "/" in name or "\\" in name:
            counts["invalid_name"] += 1
            continue
        filename = region + "_" + name + ".gtfs.zip"
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", region):
            counts["invalid_region"] += 1
            continue
        direct = item.get("url") or ""
        mdb = str(item.get("mdb-id") or "")
        row = rows.setdefault(filename, {
            "filename": filename, "human_name": name, "country_code": region.split("-")[0].upper(),
            "source": direct, "delivery": "transitous", "catalogue_url": TRANSITOUS_FEEDS,
            "lineage": [], "rights_evidence": []})
        if not row.get("source") and direct:
            row["source"] = direct
        if not row.get("publisher"):
            row["publisher"] = {"name": name, "url": direct}
        if mdb:
            by_mdb.setdefault(mdb, filename)
        if source_key(direct):
            by_url.setdefault(source_key(direct), filename)
        lin = {"catalogue": "transitous-feeds", "id": region + "/" + name,
               "url": source_list_url, "source": direct, "mdb_id": mdb}
        ev = licence_evidence(item.get("license"), "transitous-feeds", source_list_url)
        append(row, lin, ev)
        counts["transitous_schedule_source"] += 1

    for original in mobility_rows:
        m = compact_mobility(original)
        if m["data_type"] != "gtfs" or not m["id"]:
            counts["mobility_non_schedule"] += 1
            continue
        counts["mobility_gtfs"] += 1
        match = by_mdb.get(m["id"])
        if match:
            counts["overlap_mdb_id"] += 1
        if not match and source_key(m["download"]):
            match = by_url.get(source_key(m["download"]))
            if match:
                counts["overlap_source_url"] += 1
        if match is None:
            match = "mdb_" + re.sub(r"[^A-Za-z0-9_.-]", "-", m["id"])[:130] + ".gtfs.zip"
            if match in rows:
                raise ValueError("Mobility Database ID collision: " + match)
            rows[match] = {
                "filename": match, "human_name": m["name"] or m["provider"] or m["id"],
                "country_code": m["country"], "country_name": m["country"],
                "source": m["download"], "delivery": "direct",
                "publisher": {"name": m["provider"] or m["name"], "url": m["download"]},
                "catalogue_url": MOBILITY_CSV, "lineage": [], "rights_evidence": []}
            if source_key(m["download"]):
                by_url[source_key(m["download"])] = match
        row = rows[match]
        if not row.get("source") and m["download"]:
            row["source"] = m["download"]
        if not row.get("country_code") and m["country"]:
            row["country_code"] = m["country"]
        lin = {"catalogue": "mobility-database", "id": m["id"], "url": MOBILITY_CSV,
               "source": m["download"], "status": m["status"],
               "authentication_type": m["authentication_type"]}
        ev = licence_evidence({"license_url": m["terms_url"]}, "mobility-database", MOBILITY_CSV)
        append(row, lin, ev)

    counts["merged_entries"] = len(rows)
    counts["with_terms_evidence"] = sum(bool(row["rights_evidence"]) for row in rows.values())
    counts["without_terms_evidence"] = len(rows) - counts["with_terms_evidence"]
    counts["with_source_link"] = sum(bool(row.get("source")) for row in rows.values())
    return [rows[key] for key in sorted(rows)], dict(counts)


def read_transitous(directory, ref):
    for path in sorted(Path(directory).glob("*.json")):
        region = path.stem
        obj = json.loads(path.read_text())
        if not isinstance(obj, dict) or not isinstance(obj.get("sources"), list):
            raise ValueError("Invalid Transitous source list: " + str(path))
        url = "https://github.com/public-transport/transitous/blob/" + ref + "/feeds/" + path.name
        for entry in obj["sources"]:
            yield region, entry, url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--licences", type=Path, required=True)
    parser.add_argument("--feeds-directory", type=Path, required=True)
    parser.add_argument("--transitous-ref", required=True)
    parser.add_argument("--mobility-csv", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    with args.mobility_csv.open(newline="", encoding="utf-8-sig") as f:
        mobility = list(csv.DictReader(f))
    rows, counts = build_catalogue(json.loads(args.licences.read_text()),
                                   read_transitous(args.feeds_directory, args.transitous_ref), mobility)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n")
    report = {"schema": 1, "transitous_ref": args.transitous_ref, "sources": [
        TRANSITOUS_LICENSES, TRANSITOUS_FEEDS, MOBILITY_CSV], "counts": counts,
        "note": "Metadata and overlaps only; legal eligibility and rail schedules are assessed downstream."}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
