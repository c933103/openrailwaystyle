# Deployed-page fixture correction after PR #145

The deployment in [run 37834295077, job 113508606005](https://github.com/c933103/openrailwaystyle/actions/runs/37834295077/job/113508606005) succeeded, and the published lifecycle tile byte checks passed. The subsequent fixture failed its final 30-second no-error wait. The historical log does not contain final status/events. Artifact 11575940152 materialization returned HTTP 403; no alternate route or retry was used. The exact historical combination of faults remains unknown.

## Two controlled reproductions on unchanged main

All provider responses were intercepted locally, with the real MapLibre renderer and installed Chromium. These are synthetic reproduction results, not recovered historical CI events.

1. **Archive contract:** first-party-network mode uses the real PMTiles client. Its `Range: bytes=0-16383` request received HTTP 200 with 93 bytes of TileJSON from the generic provider fallback. The client emitted `openmaptiles: Wrong magic number for PMTiles archive`. Rail tiles `7/104/52` and `7/105/52` recovered at 7.39 and 8.38 seconds. At 37.69 seconds the final assertion failed with `Some map data could not load. Check your connection or reload to retry.` The unrelated pending source remained pending; no idle or movement event occurred. This focused reproduction supplied empty first-party data; it was not a full published-data acceptance run.
2. **Timing:** with the existing PMTiles shim, delaying observer setup by 3.5 seconds alone passed. Adding a controlled 1.5-second capture delay reproduced the final timeout: the first tile recovered at 23.70 seconds, the second failed again at 24.70 seconds, and the warning remained at 55.43 seconds. The next controller round was due around 68.7 seconds, outside the unchanged 30-second final wait. The initial error round had occurred before observation. The request pool's one-second internal retry explains why setup delay alone could still pass.

## Fixture-only correction

- Provide a deterministic 172-byte PMTiles v3 archive: a root entry, JSON metadata and one gzip-compressed empty MVT. Range requests return exact HTTP 206 slices, Content-Range/Length, a stable ETag and 416 for unsupported or unsatisfiable ranges. The real client reads header, metadata and tile data and reports a missing tile normally. A separate negative control still rejects the old TileJSON body with the original magic-number error.
- Hold initial controlled rail requests until the observer and pending source exist, then explicitly release them into the outage. Let the initial request and its one internal retry fail. Gate subsequent synthetic recovery responses until each screenshot phase completes. The real production recovery timer still initiates the requests; the fixture does not call recovery, clear application errors, or change its backoff.
- Retain partial-error and full-error assertions, rendered rail geometry, pending-source, no-idle/no-movement assertions, existing request ceilings and all wait limits. Save status/events on failure as well as the request ledger.
- Add a safe rail-fixture CI wrapper that serves checkout files over loopback HTTP at both `/` and `/atlas-project/`, with synthetic first-party data and the real PMTiles client. Both cases inject 3.5-second late setup and 1.5-second captures. Dependency planning follows the delegated checker. The browser-launch policy test explicitly checks this delegation to the existing guarded checker.

No production application, provider recovery, service-worker, redirect/cache policy or data-acquisition code changes.

## Validation and workflow effects

Local Node 24.19.0, Playwright 1.56.1, installed Chromium 151.0.7922.173; pinned MapLibre 5.24.0 and PMTiles 4.2.1 distribution hashes were verified by the existing fixture.

- Focused archive, browser-policy and CI-planning tests: 21/21 passed.
- Full unit suite: 582/582 passed.
- Build, modified-module syntax, generated style/station reproducibility and whitespace checks passed. No lint script is defined.
- The ordinary local/shim browser check also passed. Root and project-subpath real-client browser checks passed, including delayed setup/capture, rejected malformed archive control, range decoding, two-tile partial/full recovery and unknown-endpoint fallback. Each retained 61 initial z14 requests and 11 added after panning (ceilings 65/13).

Raw browser output is saved in `browser-review/deployed-root/` and `browser-review/deployed-project/`: assertion/event JSON, request/Range ledger and five screenshots each. CI uploads these under the ordinary rail-fixture browser artifact. Local before-repair diagnostics remain separate from these after-repair results.

The CI-plan change selects all six existing safe browser groups, adding the two URL cases to rail-fixture. Existing job timeouts, provider isolation and service-worker exclusion are unchanged. PR CI builds/assembles user-owned data artifacts; a merge triggers the ordinary main site workflow and deployment. No heritage workflow paths changed, so this correction does not trigger a heritage rebuild. No manual workflow dispatch, real Overpass acquisition or public ORM tile traffic was used. Local checks establish the synthetic renderer/client contract, not whole-world basemap or published-data completeness. Exact-head CI and automatic code/security reviews remain separate acceptance gates owned by the parent.
