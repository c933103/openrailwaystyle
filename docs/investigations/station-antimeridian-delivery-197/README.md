# PR #197 delivery verification

Date: 2026-10-12. This records delivery of the bounded runtime station-proximity correction related to #112 and #130. Neither broader issue is complete.

## Terminal outcome

- Reviewed PR head: `2bde50d1f468aed520dffd234fcd37d89d031f80`.
- Merged production commit: `85e7c7bfcd8c561f21ee9b000572b559c4928641`.
- Asset version: `20261012-station-antimeridian-1`.
- [Premerge site CI](https://github.com/c933103/openrailwaystyle/actions/runs/38235973797) and [reference CI](https://github.com/c933103/openrailwaystyle/actions/runs/38235973712) succeeded. Hosted Chromium and WebKit departure checks passed.
- [Codex code and security reviews](https://github.com/c933103/openrailwaystyle/pull/197#issuecomment-6122351186) completed on the exact reviewed head, with no reported findings, no inline review threads, and the Codex bot's thumbs-up reaction at 10:54:48 UTC.
- [Postmerge reference build](https://github.com/c933103/openrailwaystyle/actions/runs/38239117609) succeeded. Its successor deployment replaced the original queued push deployment, which was cancelled by normal concurrency replacement.
- [Successor production deployment](https://github.com/c933103/openrailwaystyle/actions/runs/38240453480) completed successfully. All six browser groups and their aggregate passed. Pages publication finished at 11:32:29 UTC; deployed vector-byte checks, 840 independent reference samples, and the published railway-fixture check all passed. The fixture check finished at 11:42:12 UTC.

See [the structured CI snapshot and exact post-deploy pass lines](ci-results.json).

## Actual delivered application bytes

At 11:34 UTC, a bounded check read 11 first-party assets from `https://c933103.github.io/openrailwaystyle/`. Every decoded response was HTTP 200 and byte-identical to the clean merged-commit build. Redirects were rejected. The checked assets include the HTML entrypoint, application module, both corrected modules, all seven version-bearing source files, CSS, service worker and generated label bundle. The bundle's exported build identity contains the exact merge commit, source link and asset token.

The received reference manifest is complete and carries input digest `70b3cdb7166621badb3fa94e9d4406d467d860615c91c75cceb5e8be01dc5699`, matching the merged source. Its generation is `d3ee80fd77568ab00e5071f8` and its retained renderer acceptance is complete.

- [Served assets, hashes, headers and build identity](served-assets.json)
- [Verification output](served-assets.log)
- [Reproducible verifier](verify-served-assets.mjs)

Run the verifier against a clean checkout of the merge, built with `GITHUB_SHA=85e7c7bfcd8c561f21ee9b000572b559c4928641`, `GITHUB_REPOSITORY=c933103/openrailwaystyle` and `GITHUB_SERVER_URL=https://github.com`. It reads the canonical first-party deployment only and accepts the clean repository and output directory as arguments.

## Bounded replay on received bytes

The verifier placed the actual received application bytes into the verified temporary checkout, then these tests executed those bytes:

- [144/144 focused tests passed](focused.log): antimeridian directions, ±180 equivalence, ordinary parity, distance/name/numeric/OSM guards, two-board request cap, controlled departure DOM, availability and cache behavior.
- [30/30 service-worker tests passed](sw-install.log): existing installation/migration and cache regression checks. These use the simulated cache/fetch harness; they do not assert a native browser service-worker upgrade.

No live Transitous requests were made by the replay; timetable responses were explicitly injected. The bounded first-party byte reads and synthetic replay do not certify live timetable coverage or provider availability.

## Remaining scope

This correction is merged, reviewed, tested and delivered. Broader availability/search audit work in #112/#130 remains open. The custom-domain PR #157 remains on hold. This evidence-only branch does not modify production code or the merged PR head.
