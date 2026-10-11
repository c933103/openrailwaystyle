# Partial departure-board status (#112, #129)

## Current reviewed source and Codex correction

[PR #190](https://github.com/c933103/openrailwaystyle/pull/190) now has source head
`6f18de8225aa936aa9b1d229812a139e8ae65a2e`, tree
`3fbe3aefc4964325c3146cb40e62ac20ccc984a2`. All 443 remote source file modes and
blob hashes match the frozen candidate. The PR remains draft pending exact-head
Codex re-review and hosted CI.

[Codex identified](https://github.com/c933103/openrailwaystyle/pull/190#discussion_r4242802242)
a cache-key gap in the first published head: translated display names changed the
key, causing a new stop lookup and two selected-board requests within the minute.
A recovered response could remove the cached partial warning. The original
name-only fixture did not exercise a real heading translation; this was a real
verification gap, not evidence that the original finding was harmless.

The correction separates station identity from translated presentation:

- Known OSM objects use a canonical type/ID tuple across source representations
  and coordinate quantization. Other identifiers are source/source-layer scoped
  and include exact coordinates; ID zero is valid. Stable raw names are the
  fallback when IDs are absent.
- Named/unnamed state remains separate so deferred hub enrichment can request its
  first useful named board without an old unnamed rejection evicting it.
- Matching names, row identity, request bounds and ordinary cache expiry are
  unchanged. Headings and journey-link names still translate.
- The coherent asset token advances to `20261011-departure-availability-2`.
  Exact app and departure module bytes are checked online/offline for upgrades
  from both `20261011-power-legend-1` and the first published availability token.

Frozen 11-file corrective patch SHA-256:
`7b88c2c6dd91671220f34667b3e64bc4f89bff82103cbb37b5b2961bb09c2237`.
The earlier integration history, failure log and accepted repeat are retained below.

### Corrective verification

- Final full suite: **1324/1324 passed**, zero failures/cancellations/skips,
  96.771 seconds. No assertion or timeout relaxation.
- Build/style reproducibility passed. Expanded implementation-focused tests passed
  167/167; the final cache/availability subset passed 44/44 after the additional
  predecessor-byte and canonical-OSM checks.
- Independent focused verification passed 121/121, including actual deferred
  startup naming, identity/race cases and both prior-release cache upgrades.
- The same strengthened Chromium fixture fails on exact published baseline
  `1ad2a047832936cdec511c99dc78463af4a675ef` at the translated cached-warning
  assertion, then passes on the frozen successor. Actual station heading and
  journey-link name changes are asserted, recovered fixtures are available,
  request count remains bounded, and ordinary expiry still establishes recovery.
- Both translation directions and partial result shapes pass in the production
  renderer/DOM tests. Distinct IDs at the same coordinates, node/way namespaces,
  source/layer scopes, ID zero, nearby points, fallback raw names and late unnamed
  rejection after named success are covered.
- Independent source review found no blocker. The production app differs from the
  earlier reviewed version only in the cache-key helper/use and release token;
  merged Power behavior and the partial-status correction are preserved.

WebKit remains unavailable locally; the committed checker remains dual-engine for
hosted CI. No live departure requests or native browser service-worker
interception were used. Broader #112/#129 work remains open.

### Corrective evidence

- [Independent corrective review](independent-translated-cache-review.md)
- [Full 1324-test aggregate](translated-redraw-full-suite.log)
- [167 implementation-focused tests](translated-redraw-expanded.log)
- [Final 44 cache/availability tests](translated-redraw-cache.log)
- [121 independent focused tests](review-translated-focused.log)
- [Expected baseline browser failure](review-translated-baseline-browser.log)
- [Successor browser pass](review-translated-successor-browser.log)
- [Original two-case DOM reproduction](translated-redraw-baseline.log)
- [Reviewed successor file hashes](review-translated-source-manifest.json)
- [Static source/version comparison](review-translated-static.json)
- [Exact corrective source patch](translated-redraw-source.patch)
- [Corrective build log](translated-redraw-build.log)

# Initial partial departure-board correction and integration history

## Scope and reproduced failure

The fault was reproduced on main `8c1d2607068f0f3c0cce7e9e721fca1deaa07ee0` after #188.
Its departure-module Git blob is `092b3e9c580e0bad06c7b15922574df9d7b72e62`.
The [offline baseline reproduction](baseline-repro.mjs) runs against the exact
[baseline module](baseline-departures.mjs), using synthetic injected responses.
[Recorded results](baseline-result-verified.json) show that one empty successful
board plus one failed board is indistinguishable from two successful empty
boards. Usable rows plus a failed board similarly lose the failure status.
All boards failing already throws. Each case makes exactly one stop lookup and
two selected-stop requests; no live departure service is called.

The correction is integrated onto merged #189 main
`5f44f5525c0467466f68fdba56a40b48d1249aa6`, exact accepted tree
`e370563398815d9eb05d9aceb44f9af848047161`. All 429 files outside the
14-file change set match that accepted tree; the three overlapping files preserve
its Power implementation and tests. The immediate-prior asset release in the
departure cache-upgrade regression is `20261011-power-legend-1`.

Initial published source: [PR #190](https://github.com/c933103/openrailwaystyle/pull/190),
head `1ad2a047832936cdec511c99dc78463af4a675ef`, tree
`63585398781bce8c59ae1bd353563101503ca6bc`. All 443 remote source-tree file
modes and blob hashes were verified against the frozen local candidate.

Frozen integrated source patch SHA-256:
`6ce4571f556931296807b0cb4051d78b07bc5c89d5e8bb6ffb3cbad35f678295`.

## Correction and limits

- `stationDepartures` adds `stopResults`, containing only `{stopId, status}` for
  each selected stop, with `fulfilled` or `rejected` request outcomes. It does not
  pass raw exception strings, response bodies or diagnostic URLs into the result.
- The UI derives partial status from the outcomes. It keeps usable rows and shows
  “Some departures could not load. The board may be incomplete.” Partial-empty
  results show that warning rather than a complete-empty claim.
- Fully successful empty boards, no selected stops and all-failed requests retain
  their existing behavior. Success only describes the requested selected boards;
  it does not establish complete timetable coverage for the station or area.
- Raw observations, row reconciliation/identity, mode filtering, the two-stop
  selection bound and `n=30` per request remain unchanged.
- Partial results stay in the existing one-minute cache, including their warning.
  A normal opening after expiry requests the selected boards afresh and can
  establish recovery. There is no new automatic retry, polling, Retry button or
  manual source-acquisition workflow. Entirely failed results remain evicted.
- The existing versioned asset graph gets a new token,
  `20261011-departure-availability-1`; service-worker policy is unchanged.

This is a bounded correction, not completion of #112 or #129. Broader source
coverage, missing or stale snapshots, ingestion and processing status, the
Ōji departures-versus-map-frequency contradiction, and frequency matching remain
open. No live provider coverage or timetable accuracy claim is made here.

## Initial integration verification

- Build passed; generated `world.style.json` stays byte-identical to the base.
- Unchanged final full-suite repeat: **1306 passed, 0 failed, 0 cancelled, 0 skipped** (94.537 s).
- Injected-fetch tests cover both source orders, partial-empty/rows, HTTP/network/
  JSON/abort failures, all-success-empty/populated, no matching stop, all-failed,
  safe outcomes, unchanged raw observations and request limits.
- Production renderer/cache tests use a real DOM, covering cached partial results,
  the exact cache-expiry boundary, normal recovery, in-flight sharing, all-failed
  eviction, detached sections and a late partial result after a newer selection.
- Controlled Chromium runs the real built app, renderer and click handler with
  synthetic provider responses under the repository's unchanged loopback-only
  transport guard. Both source orders and partial result shapes pass, along with
  close/reopen, settings redraw, expiry recovery, all-failed eviction and no match.
  Closing while either partial shape is still loading also stays closed on late
  settlement and reopens using the cached warning. Existing schedule, selection,
  keyboard and lazy trip-loading checks continue to pass. No page errors occurred.
- Independent integration review found no blocker. Its 116-test focused run and
  integrated Chromium departure and Power desktop/mobile checks passed. All four
  Power legend screenshots are byte-identical to the accepted #189 screenshots.
  The implementation focused integration run also passed all 165 tests.
- Syntax and whitespace checks passed.

The first pre-integration aggregate identified two test fixtures returning the old
board shape; all three startup mocks were updated and that aggregate then passed
1303/1303. The first integrated aggregate had 1305/1306 passing, with the unchanged
full-train lazy-expansion test observing zero loader calls at its assertion after
a fixed 20 ms wait. Its test and expansion logic are unchanged. It passed in the
165-test and independent 116-test focused runs. The original failure log is
retained; its cause has not been established. The unchanged aggregate repeat passed
1306/1306. A passing repeat does not establish the initial failure’s cause. No
timeout or assertion was relaxed.

### Browser environment limit

The unmodified dual-engine checker passed Chromium and then could not launch
WebKit because the installed browser directory has no `webkit-2215/pw_run.sh`.
No new browser was downloaded. The independent clean local run used a temporary
copy changing only the engine loop to Chromium; the committed checker still runs
both Chromium and WebKit in the existing hosted CI job. **WebKit has not passed
locally**. See [launch log](browser.log) and [Chromium results](review-integrated-departures-chromium.log).

## Inspectable evidence

- [Integrated aggregate log](integrated-full-suite.log)
- [First integrated aggregate failure](integrated-full-suite-first.log)
- [165 focused integration tests](integrated-focused.log)
- [116 independent focused tests](review-integrated-focused.log)
- [Independent integration review](independent-integration-review.md)
- [Reviewed integrated source hashes](review-integrated-source-manifest.json)
- [Exact integrated source patch](integrated-source.patch)
- [Accepted-base preservation](review-integration-static.json)
- [Power integration results](review-integrated-power-chromium.log)
- [Power screenshot parity](review-integrated-power/screenshot-parity.json)
- [Build log](integrated-build.log)
- [Partial-empty screenshot](departures-partial-empty-chromium.png)
- [Partial-with-rows screenshot](departures-partial-rows-chromium.png)

The screenshots deliberately use an empty map-provider fixture; they verify
production board rendering, not live map or timetable coverage. Absolute scratch
paths in logs are replaced with descriptive placeholders.

[Artifact hashes and sizes](manifest.json) identify the published evidence bytes.
