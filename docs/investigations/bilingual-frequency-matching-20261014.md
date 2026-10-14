# Bilingual timetable agency matching — 14 October 2026

Related: #111 and #112. This correction does not close either broader issue.

## Reproduced failure and correction

The published Tokyo feed declares `agency_name="東京メトロ Tokyo Metro"`.
OSM's Namboku service declares `operator="東京メトロ"`, `ref="N"`.
The old matcher compared the concatenated bilingual name with the single-language
OSM name. It rejected this identity before checking the path or applying counts.

The corrected normalizer retains the entire declaration and compares complete
whitespace-separated native/Latin script runs. It does not split Latin phrases
into individual words, guess translations, remove corporate suffixes, or accept
arbitrary agency IDs. Existing compatible-mode, declared-ref/name, whole supplied
path, minimum distance, section interval, expiry and overlap checks still apply.
No timetable geometry is displayed.

## Held production-input replay

- Input code baseline: `1c786c5a90d9e0e69d9c19a1909b68b023c4a824`.
- [Worldwide run 38231733616](https://github.com/c933103/openrailwaystyle/actions/runs/38231733616),
  shard 6 artifact `11742051073`; ZIP SHA-256
  `bfc8b06474b41ad8026d229026ebe3771c1f6b4693de41ba91577ee817e33e2c`.
- Held `feeds/jp_tokyo-rail.json.gz` SHA-256
  `7d3f21791940cda5085741443a9228855601af635c33ee8e405e1b7c949a2de3`;
  declared original GTFS ZIP SHA-256
  `5b2c2f846189b681ddfaab173e2c669ee0ef88bbb9883ef996aa487c9e04267c`.
- OSM `service-data` commit `01202061332abfb4356e2a9f6657e10a8531f43e`,
  `service-routes.ndjson.gz` SHA-256
  `ec90a91b7f8a433b41c12f48dee7498be0b72e1cfb8fcaa4e24c65d964cc3fd3`.
  The replay selects its 309 Japan-stage relations and their 7,410 associated
  ways, preserving the original records, geometry and membership fields.

The unchanged compiled feed has 127 routes and 34,519 path segments.
Baseline: all 127 fail at `no_osm_service_identity_candidate`.
Correction: 15 routes supply 2,496 section records on 614 ways, with 303 distinct
profile records. One identity remains ambiguous, five fail path corroboration,
and 106 lack a declared identity candidate. This is a single-feed replay, so
other feeds' conflicts and future source/data changes can reduce production
coverage. It does not establish complete Tokyo coverage.

Namboku matches 216 sections and 26 profile records. Rebuilding tile
`12/3637/1611` with the real source gives scheduled morning rates of 7.5, 8 and
9 trains/hour on covered sections, and selected-hour 08 rates of 9 or 11.
An edge lacking uniform section evidence remains unknown. This confirms rates
reach the existing OSM tile builder at Ōji; it is not a live deployment claim.

## Publication and acceptance

Matcher revision 2 is bound to the aggregate's compressed profile bytes.
Existing main-only Service maintenance dispatches a production refresh when the
published revision is older, deduplicates active refreshes, and stops dispatching
after a current revision is published. Malformed or future revisions fail before
mutation. Legacy aggregates remain usable while the refresh runs.

Node 24.19.0, locked dependencies installed without lifecycle scripts.
The bilingual regression fails on the baseline. Focused matching/width/service
tests pass 51/51; revision and publication checks pass 22/22. Five selected new
regressions pass, including the complete GTFS-calendar-to-OSM publication test.
The compiler/browser fixture now declares a bilingual agency too. Build and
whitespace checks pass. Final aggregate tests, hosted browser checks, current-head
review and production refresh/deployment must be recorded in the PR before
claiming those stages complete. Bulky inputs and logs remain outside the source
branch; the immutable input artifacts above preserve their provenance.
