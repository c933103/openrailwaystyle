# Frequency and service acquisition, 11 October 2026

## Verified state before correction

- PR #171 merged at `2026-10-10T01:48:57Z` and already activates production timetable matching. PR #168 is an additional offline evidence helper, not a prerequisite switch for that deployed matcher.
- All three assets in release `service-frequency-data` were last updated at `2026-10-09T14:09:46Z`–`14:09:47Z`. Its schema-3 manifest has 5,489 catalogue entries (361 compiled, 3,588 no-rail, 1,535 retry-pending, five excluded), but **no `applied_profiles` field**. The archive contains no `profiles.json.gz`. This publication predates #171; deploying application code cannot manufacture the missing aggregate.
- Service run [38097664354](https://github.com/c933103/openrailwaystyle/actions/runs/38097664354), job 114346842578, made five transport attempts, each logging only `fetch failed`, then stopped with `Nothing fetched: Overpass stayed unavailable`. The hidden nested transport cause cannot be reconstructed from that log. The previous successful run [38079057909](https://github.com/c933103/openrailwaystyle/actions/runs/38079057909) subdivided the Europe-g queue from 12 to 15 boxes and consumed 50,005,358 bytes without a completed box. A successful maintenance exit did not establish acquired geography.
- Saved service snapshot `2c3ddf40527aa6da5904660a885f718cb4bc4fb0` has 144,026 drawable legacy ways, all without verifiable source provenance; all 6,750 retained relations likewise lack provenance. There are 65 retained relation declarations without drawable geometry. The table predates retention of OSM versions/timestamps/membership evidence. Unknown provenance is a real evidence limitation, not proof that those drawable ways are missing. New queries retain the source evidence; historical rows cannot be retroactively certified. The underlying source/tagging cause of the 65 geometry gaps remains unverified.
- India, the rest of Asia, North America, the Americas and World were still unstarted. The scheduler always selected a pending stage before any unstarted one, allowing the Europe-g queue to monopolize acquisition.

## Repair

Both Service and branch-line maintenance now give the least recently attempted unfinished stage a turn, preserving the defined order for first attempts and preserving every stage's accepted data, queued boxes and partial transactions. Completed-stage refresh remains on the existing 14-day cadence after initial acquisition. Zero-byte outages save an explicit deferred attempt and warning; they never complete a box. Run/per-stage manifest metadata records acquired, partial or deferred outcomes. Existing byte limits, request delays, subdivisions and rejection of incomplete source data remain in force.

Nested DNS/socket/TLS error codes now appear in bounded diagnostics. This reveals the next failure's actual cause without dumping headers or credentials; it does not claim that the unavailable provider itself has been repaired.

An independent main-only job in the existing Service workflow disables only active, removed `pr71-*`, `pr73-*`, `repair-pr73` and `audit-country-label` definitions. Definitions still present on main and all historical runs are retained. The same job starts the current production frequency workflow if the release lacks an applied aggregate, unless a main production refresh is already queued/running/waiting. Once an aggregate is published, normal frequency scheduling owns refreshes. Production acquisition is never run by PR fixture checks.

## Acceptance still outstanding

The refresh must finish and publish a digest-verified section aggregate before the live map can claim timetable widths. Matching counts and changed/expired bindings need inspection after publication; nonzero counts alone do not prove comprehensive reconciliation. This correction does not close #111.

Worldwide service acquisition must account for every outstanding region, followed by provenance-bearing refreshes of the legacy coverage and investigation of geometry gaps. Fair scheduling does not certify completed global coverage or resolve a provider outage. This correction does not close #108.

Validation uses controlled fixture responses only, including a five-attempt zero-byte transport outage, preserved geometry/queues, stage fairness, oldest-stage refresh, maintenance dispatch deduplication, removal allowlists, main-only authorization and malformed publication metadata. Hosted production outcomes are separate evidence.
