# PR 272 terrain CI repair evidence

This evidence branch records the bounded repair of the seven verified failures in
Railway Atlas PR 272. It is not an application branch or a claim of deployment.

## Exact source

- Original head: `3a2dc68051b27b7dab16a3fbc30cdcad09dd00f7`
- Original base: `5d729533f5eef9a2e110cc6da1e8809b8b9769a6`
- Local reviewed repair: `b2aa41e2912fffc81aa75e225392c5239a7e66f4`
- Published repair: `1e2958d7a1a27220cee3a568215a23b7f0cc1b9d`
- Identical source tree: `1a79a317b6b51ae7ab4ff3a44c4f30f0c1288fc0`

Commit metadata differs between the local and published repair. All 818 remote
file modes and blob identities match the reviewed local tree. The original head
is the sole parent of the published repair. No other application files changed.
`source-binding.json` records SHA-256 values for the ten changed files.

## Repair and preserved behavior

Nine transitive main-page imports still used the imagery release identity;
the separately checked data-check page/module also needed the same release
alignment. These stale imports broke release-isolated offline graphs.

The terrain PR added an unconditional `isStyleLoaded() === true` startup mock.
That forced production initialization before the fixture supplied its cold-load
bounds and prevented its early-source test from exercising a cold style. The
mock now models cold and already-loaded styles explicitly, with new assertions.
The original visible-hub and early recovery assertions remain intact. No
production readiness/station-visibility guard or terrain semantics were relaxed.

A separate browser-fixture callback referenced the module-local `syncTerrain3D`
from Playwright's evaluation realm. Its own dynamic import now supplies the
production helper. An exact-callback VM check reproduces the old ReferenceError
and verifies pitch-zero terrain removal afterward; it is not a WebGL check.

## Local validation and limits

Commands ran in the exact source checkout. Node 24.22.1 (supported by the package)
was used for initial/targeted/build checks; the final isolated full attempt used
CI-line Node 26.12.1. Package installation used `npm ci --ignore-scripts`.

| Check | Outcome |
| --- | --- |
| Original hosted run 40349706002, job 121666595605 | 2,724 tests: 2,717 pass, 7 fail, 0 skipped |
| Original local focused reproductions | All seven failures reproduced across `original-focused.log` and `original-two.log` |
| Repaired three startup regressions plus two new cold/warm cases | 5 pass, 0 fail, 0 skipped |
| Complete service-worker and terrain unit suites | Pass in `repaired-focused.log`; its startup child was killed, so that combined run is not an aggregate pass |
| `npm run build` | Pass |
| `git diff --exit-code -- styles/world.style.json styles/major-stations.geojson` | Pass |
| `node --check` for app and every modified module; `git diff --check` | Pass |
| Exact browser callback in fresh VM realm | Old callback raises ReferenceError; repaired callback imports production helper and removes terrain at pitch zero |
| Final isolated Node 26.12.1 full suite | 2,705 reported, 2,704 pass, 1 startup-file SIGKILL, 0 skips/cancellations; 249,541.549514 ms |

The final command was `node --experimental-vm-modules --test
--test-concurrency=1 --test-reporter=tap tests/*.test.mjs`, using Node 26.12.1 and
a workspace-backed TMPDIR. No assertion failure was emitted, but SIGKILL and the
undercount mean full aggregate acceptance is **not established**.

Earlier attempts are retained, not hidden: an initial full run overlapped the
build and had missing generated assets/child failures; a supported-Node startup
attempt ended in SIGKILL; a 384 MB heap experiment ended in explicit JavaScript
heap exhaustion; an older bounded-heap full run was stopped before the isolated
CI-line attempt. These are incomplete diagnostic runs, not passes. SIGKILL's
cause was not established. No threshold, skip or weakened oracle was introduced.

Local Chromium could not launch because UNIX-socket creation was restricted;
the permitted escalation attempt failed in runtime filesystem setup before
browser launch. No security/network workaround or further launch retry was used.
No local browser/worker/WebGL acceptance is claimed.

## Hosted acceptance remains separate

Exact-head review was requested in PR comment 6430021088. At evidence preparation,
controls diagnostic run 40421738335 passed. Site run 40421738303, reference build
40421738302 and independent rendering run 40421738282 were still running. These
statuses are a timestamped checkpoint, not future acceptance. Required full hosted
Node/browser/worker/WebGL checks, artifact inspection and exact-head review remain
binding before any merge/deployment.

The archive contains project test logs and the bounded repair patch only. Source
and logs retain natural-scale terrain, ocean-mask/island-hole behavior, inland
depressions, independent polar rendering and coarse-seabed limitations. Coarse
seabed relief is not hydrographic measurement. No provider acquisition was added.
