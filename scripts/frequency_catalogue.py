#!/usr/bin/env python3
"""Normalize Transitous and Mobility Database discovery without licence allow-lists.

Catalogue metadata is evidence, not a licence granted by the catalogue. Terms
and provenance are retained for every contributing source. No GTFS ZIP is
downloaded by this script; the main compiler decides whether a schedule is rail.
"""
import argparse
from collections import Counter
import csv
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRANSITOUS_LICENSES = "https://github.com/public-transport/transitous/blob/main/website/data/license.json"
TRANSITOUS_FEEDS = "https://github.com/public-transport/transitous/tree/main/feeds"
MOBILITY_CSV = "https://files.mobilitydatabase.org/feeds_v2.csv"

_reference_spec = importlib.util.spec_from_file_location('frequency_references', Path(__file__).with_name('frequency_references.py'))
references = importlib.util.module_from_spec(_reference_spec)
_reference_spec.loader.exec_module(references)
_publication_spec = importlib.util.spec_from_file_location('frequency_publication', Path(__file__).with_name('frequency_publication.py'))
publication = importlib.util.module_from_spec(_publication_spec)
_publication_spec.loader.exec_module(publication)


def access_review_url(url):
    """Recognize explicit URL credentials/grants, not arbitrary query names."""
    if not isinstance(url, str):
        return None
    try:
        parts = urlsplit(url)
        if parts.scheme.lower() not in ('http', 'https') or not parts.hostname:
            return None
        # Do not turn a recognition budget/parse failure into an unsigned URL.
        # This scans the already loaded catalogue string; no request is made.
        parameters = parse_qsl(parts.query, keep_blank_values=True)
        names = {name.lower() for name, value in parameters if value}
        host = parts.hostname.lower().rstrip('.')
        if parts.username is not None or parts.password is not None:
            reason = 'embedded_url_credentials'
        elif (host.endswith('.blob.core.windows.net')
              and {'sig', 'sv', 'se', 'sp'} <= names
              and ('sr' in names or {'ss', 'srt'} <= names)):
            reason = 'signed_storage_access'
        elif host == 'api.511.org' and 'api_key' in names:
            # Provider documentation identifies this as an issued access key.
            # Its appearance in ancillary real-time metadata is not permission
            # to retain it with a static timetable's public provenance.
            reason = 'documented_api_access_key'
        else:
            return None
        safe_names = lambda values: sorted({name if re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', name) else 'parameter' for name in values})
        authority = '['+host+']' if ':' in host else host
        try:
            port = parts.port
        except ValueError:
            port = None  # Display only; the record remains paused, not acquired.
        if port is not None:
            authority += ':'+str(port)
        display = urlunsplit((parts.scheme, authority, parts.path,
            urlencode([(name if re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', name) else 'parameter',
                        '[redacted]') for name, _ in parameters]), ''))
        return {'reason': reason, 'host': host, 'parameter_names': safe_names(names),
                'url': display, 'url_sha256': hashlib.sha256(url.encode('utf-8')).hexdigest()}
    except (ValueError, UnicodeError):
        return None


def prepare_catalogue_row(row):
    """Keep ordinary operational URLs; pause grants before staging publication.

    Reconciliation happens on the original inputs before this one-way boundary.
    No unsigned URL is invented by removing a signature. A future source-specific
    review may replace the input with an independently declared public endpoint.
    """
    row = references.project_row(row)
    lineage = row.get('lineage') if isinstance(row.get('lineage'), list) else []
    acquisition_items = [row]+[item for item in lineage if isinstance(item, dict)]
    current_pairs = {(item.get('source'), item.get('source_sha256')) for item in acquisition_items
                     if isinstance(item.get('source'), str) and isinstance(item.get('source_sha256'), str)}
    reviews, prepared_identities = [], set()
    existing = row.get('access_review')
    for item in existing if isinstance(existing, list) else []:
        if not isinstance(item, dict) or item.get('reason') not in ('embedded_url_credentials', 'signed_storage_access', 'documented_api_access_key'):
            continue
        fingerprint, display = item.get('url_sha256'), item.get('url')
        if not isinstance(fingerprint, str) or not re.fullmatch(r'[a-f0-9]{64}', fingerprint) or not isinstance(display, str):
            continue
        if (display, fingerprint) not in current_pairs:
            continue  # An unrelated inherited audit cannot pause another feed.
        try:
            parts = urlsplit(display)
            parameters = parse_qsl(parts.query, keep_blank_values=True)
            if (parts.scheme not in ('http', 'https') or not parts.hostname or parts.username is not None
                    or parts.password is not None or parts.fragment or any(value != '[redacted]' for _, value in parameters)):
                continue
            recognized = access_review_url(display)
            if item['reason'] != 'embedded_url_credentials' and (not recognized or recognized['reason'] != item['reason']):
                continue
            prepared_identities.add((display, fingerprint))
            safe_parameters = [(name if re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', name) else 'parameter', value) for name, value in parameters]
            display = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(safe_parameters), ''))
            # Reconstruct the small evidence schema, never copy upstream extras.
            reviews.append({'reason': item['reason'], 'host': parts.hostname.lower().rstrip('.'),
                'parameter_names': sorted({name.lower() for name, _ in safe_parameters}),
                'url': display, 'url_sha256': fingerprint})
        except ValueError:
            continue
    acquisition_urls = [row.get('source')]+[item.get('source') for item in lineage if isinstance(item, dict)]
    acquisition_hashes = {hashlib.sha256(url.encode('utf-8')).hexdigest() for url in acquisition_urls if isinstance(url, str)}
    # Already prepared rows retain original identities alongside display URLs.
    acquisition_hashes.update(item.get('url_sha256') for item in reviews)
    def record(grant, original_identity=None):
        if (original_identity or grant['url_sha256']) in acquisition_hashes:
            reviews.append(grant)
    def sanitize(value):
        if isinstance(value, list):
            return [sanitize(item) for item in value]
        if not isinstance(value, dict):
            grant = access_review_url(value)
            if grant:
                record(grant)
                return grant['url']
            return value
        result = {}
        for key, item in value.items():
            if key == 'access_review':
                continue
            grant = access_review_url(item)
            if grant:
                original_identity = grant['url_sha256']
                fingerprint = value.get(key+'_sha256')
                if (isinstance(fingerprint, str) and re.fullmatch(r'[a-f0-9]{64}', fingerprint)
                        and ((item, fingerprint) in prepared_identities or item == grant['url'])):
                    grant['url_sha256'] = fingerprint
                # Raw acquisition identity decides the pause before any
                # prepared display fingerprint is reused for audit continuity.
                record(grant, original_identity)
                result[key] = grant['url']
                result[key+'_sha256'] = grant['url_sha256']
            elif key not in result:
                result[key] = sanitize(item)
        return result
    result = sanitize(row)
    if reviews:
        unique = {item['url_sha256']: item for item in reviews}
        result['access_review'] = [unique[key] for key in sorted(unique)]
    return result


def source_key(url):
    """Deduplicate an identical producer URL, not an operator name or region."""
    if not isinstance(url, str):
        return ''
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
    """Retain rights metadata; do not confuse data use with GTFS redistribution.

    Atlas calculates factual timetable statistics for end users and does not
    republish per-feed GTFS copies. SPDX names, NoDerivatives labels, missing
    metadata, and generic restrictions on creating *redistributed datasets*
    are not automated reasons to discard a source.

    Only a reviewed, source-bound rule that explicitly forbids THIS application's
    timetable-frequency use can be an exclusion. The required review is encoded
    as an exact-original-URL match by discover(), never as a catalogue guess.
    """
    evidences = list(row.get("rights_evidence") or [])
    if not evidences:
        old = licence_evidence(row, "catalogue", row.get("catalogue_url", TRANSITOUS_LICENSES))
        if old:
            evidences.append(old)
    denials = []
    for item in evidences:
        restrictions = item.get("restrictions") or {}
        if (item.get("origin") == "source-specific-reviewed-rule"
                and restrictions.get("prohibit_frequency_use") is True
                and item.get("terms_url")):
            denials.append({"origin": item.get("origin"), "reference": item.get("reference"),
                            "terms_url": item["terms_url"],
                            "basis": "source terms explicitly forbid end-user timetable-frequency use"})
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


def catalogue_sources(transitous_ref):
    """Public upstream locations for the exact pinned reconciliation inputs."""
    if not isinstance(transitous_ref, str) or not re.fullmatch(r'[a-f0-9]{40}', transitous_ref):
        raise ValueError('Transitous ref must be a full pinned Git commit SHA')
    return [TRANSITOUS_LICENSES.replace('/main/', '/' + transitous_ref + '/'),
            TRANSITOUS_FEEDS.replace('/main/', '/' + transitous_ref + '/'), MOBILITY_CSV]


def build_catalogue(licences, feed_sources, mobility_rows, transitous_ref=None, reference_index=None, definition_metadata=None, publication_context=None):
    """feed_sources: (region, source, pinned source-list URL) tuples."""
    licence_url, feeds_url, _ = catalogue_sources(transitous_ref) if transitous_ref is not None else [
        TRANSITOUS_LICENSES, TRANSITOUS_FEEDS, MOBILITY_CSV]
    feed_sources, mobility_rows = list(feed_sources), list(mobility_rows)
    rows = {}
    by_mdb = {}
    by_url = {}
    counts = Counter()
    for item in licences:
        name = item.get("filename", "")
        if not isinstance(name, str) or not name.endswith(".gtfs.zip"):
            continue
        row = dict(item)
        row["catalogue_url"] = licence_url
        row["delivery"] = "transitous"
        row["lineage"] = [{"catalogue": "transitous-licence", "id": name,
                           "url": licence_url, "source": item.get("source", "")}]
        ev = licence_evidence(item, "transitous-licence", licence_url)
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

    # Retain the established filename universe. For references, these are only
    # compatibility keys; format and acquisition authority are resolved below.
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
            "source": direct, "delivery": "transitous", "catalogue_url": feeds_url,
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
        counts["legacy_transitous_candidate_sources"] += 1

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
    prepared = [prepare_catalogue_row(rows[key]) for key in sorted(rows)]
    # Resolve only after forming the legacy universe, preserving old owners and
    # identities instead of silently swallowing newly matched Mobility rows.
    prepared, reference_counts = references.apply_references(prepared, feed_sources,
        mobility_rows, compact_mobility, reference_index, licence_evidence, definition_metadata, publication_context)
    prepared = [prepare_catalogue_row(row) for row in prepared]
    counts.update(reference_counts)
    counts['pending_access_review'] = sum(bool(row.get('access_review')) for row in prepared)
    counts['with_source_link'] = sum(bool(row.get('source')) for row in prepared)
    counts['with_terms_evidence'] = sum(bool(row.get('rights_evidence')) for row in prepared)
    counts['without_terms_evidence'] = len(prepared) - counts['with_terms_evidence']
    return prepared, dict(counts)


def read_transitous(directory, ref, input_hashes=None, definition_metadata=None):
    paths = []
    for scanned, path in enumerate(Path(directory).iterdir(), 1):
        if scanned > references.MAX_FILES:
            raise ValueError('Transitous metadata file limit')
        if path.suffix == '.json':
            paths.append(path)
    paths.sort()
    total, records = 0, 0
    for path in paths:
        region = path.stem
        if path.is_symlink() or not path.is_file():
            raise ValueError('Invalid Transitous metadata file')
        with path.open('rb') as stream:
            data = stream.read(references.MAX_FILE_BYTES + 1)
        total += len(data)
        if len(data) > references.MAX_FILE_BYTES or total > references.MAX_TOTAL_BYTES:
            raise ValueError('Transitous metadata byte limit')
        if input_hashes is not None:
            input_hashes[path.name] = hashlib.sha256(data).hexdigest()
        obj = json.loads(data)
        if not isinstance(obj, dict) or not isinstance(obj.get("sources"), list):
            raise ValueError("Invalid Transitous source list: " + str(path))
        url = "https://github.com/public-transport/transitous/blob/" + ref + "/feeds/" + path.name
        if definition_metadata is not None:
            definition_metadata[url] = {'file_sha256': hashlib.sha256(data).hexdigest(),
                'blob_sha': hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}
        for entry in obj["sources"]:
            records += 1
            if records > references.MAX_RECORDS or len(json.dumps(entry, ensure_ascii=False).encode()) > references.MAX_RECORD_BYTES:
                raise ValueError('Transitous metadata record limit')
            yield region, entry, url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--licences", type=Path, required=True)
    parser.add_argument("--feeds-directory", type=Path, required=True)
    parser.add_argument("--transitous-ref", required=True)
    parser.add_argument("--mobility-csv", type=Path, required=True)
    parser.add_argument("--transitland-feeds-directory", type=Path)
    parser.add_argument("--transitland-ref")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--publication-index", type=Path, help="Secret-free pinned licence membership artifact")
    args = parser.parse_args()
    try:
        sources = catalogue_sources(args.transitous_ref)
    except ValueError as error:
        parser.error(str(error))
    if bool(args.transitland_feeds_directory) != bool(args.transitland_ref):
        parser.error('--transitland-feeds-directory and --transitland-ref must be supplied together')
    try:
        reference_index = (references.read_transitland(args.transitland_feeds_directory, args.transitland_ref)
                           if args.transitland_ref else references.unavailable())
    except ValueError as error:
        parser.error(str(error))
    if args.transitland_ref:
        sources.append(references.pinned_url(args.transitland_ref))
    with args.licences.open('rb') as stream:
        licence_data = stream.read(publication.MAX_INPUT_BYTES + 1)
    publication_index = publication.build_index(licence_data, sources[0])
    publication_context = publication.Context(publication_index)
    mobility_data = args.mobility_csv.read_bytes()
    mobility = list(csv.DictReader(io.StringIO(mobility_data.decode("utf-8-sig"), newline="")))
    feed_hashes, definition_metadata = {}, {}
    rows, counts = build_catalogue(json.loads(licence_data),
        read_transitous(args.feeds_directory, args.transitous_ref, feed_hashes, definition_metadata), mobility, args.transitous_ref, reference_index, definition_metadata, publication_context)
    # Exact parsed feed files: SHA-256 of the sorted compact filename -> SHA-256
    # JSON map (UTF-8 with JSON's default ASCII escaping), not the mutable branch.
    feeds_digest = hashlib.sha256(json.dumps(feed_hashes, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    args.output.write_bytes(data)
    index_data = publication.encoded(publication_index) + b'\n'
    index_path = args.publication_index or args.report.with_name('publication-index.json')
    index_path.write_bytes(index_data)
    report = {"schema": 4, "publication_index": {"sha256": publication.sha(index_data), "records": len(publication_index['records'])}, "catalogue_sha256": hashlib.sha256(data).hexdigest(),
        "transitous_ref": args.transitous_ref, "sources": sources,
        "transitland_ref": args.transitland_ref,
        "transitland_state": reference_index['state'],
        "transitland_reason": reference_index['reason'],
        "input_sha256": {"transitous_licences": hashlib.sha256(licence_data).hexdigest(),
                         "transitous_feeds": feeds_digest,
                         "mobility_csv": hashlib.sha256(mobility_data).hexdigest(),
                         "transitland_feeds": reference_index["sha256"]},
        "counts": counts,
        "note": "Metadata and overlaps only; legal eligibility and rail schedules are assessed downstream."}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(counts))


if __name__ == "__main__":
    main()

