# PR #192 delivery acceptance

The merged correction is [f9bd326c6a2a3738daafd36a58a16f9a2251c5a8](https://github.com/c933103/openrailwaystyle/commit/f9bd326c6a2a3738daafd36a58a16f9a2251c5a8),
with accepted tree `64dd028fe4229f942f7ddca564955278aad1a7ef` and asset token
`20261011-departure-match-1`. Broader issues #112 and #129 remain open.

## Acceptance sequence

- Exact-head Codex review found no major issues. Local final aggregate was
  1354/1354; independent focused tests were 183/183 and contract controls 36/36.
- [Premerge site workflow 38178813786](https://github.com/c933103/openrailwaystyle/actions/runs/38178813786)
  passed all six browser groups. The departures checker explicitly passed both
  Chromium and WebKit, including unmatched-cache/translated redraw and malformed
  lookup recovery. See [premerge receipt](premerge-acceptance-receipt.json).
- [Direct postmerge reference 38180813331](https://github.com/c933103/openrailwaystyle/actions/runs/38180813331)
  succeeded. Its reviewed workflow automatically dispatched the pinned successor
  at 22:45:02 UTC; no manual dispatch was used.
- [Direct site deployment 38180813330](https://github.com/c933103/openrailwaystyle/actions/runs/38180813330)
  succeeded, including exact deployed vector-tile reads, published independent
  geometry checks and the published synthetic railway fixture. See
  [direct workflow receipt](direct-workflow-receipt.json).
- [Pinned automatic successor 38181652817](https://github.com/c933103/openrailwaystyle/actions/runs/38181652817)
  succeeded, including all six browser groups and its final published checks.
  See [final workflow receipt](final-workflow-receipt.json),
  [successor departure excerpt](successor-departures-excerpt.log) and
  [published-fixture excerpt](successor-published-excerpt.log). The bounded gate
  is complete.

The bounded delivery gate includes only that direct merge deployment and its
[direct reference-completion successor](successor-lineage.json). Later scheduled
runs are excluded.

## Actual first-party delivery

[Direct served-byte observation](direct-served-verification.json) was recorded at
2026-10-11 23:02:18 UTC; the [successor observation](successor-served-verification.json)
was recorded at 23:28:18 UTC after the successor's Pages deployment step passed.
All ten shell/assets returned HTTP 200 and exactly matched the accepted merge:
index, app, departures, departures UI, map model, CJK font module, elevation,
layer semantics, CSS and service worker. The build bundle identified the exact
merge commit and corrected version. Direct and successor hashes were identical.

The actual fetched departures parser passed the independent 36-case synthetic
contract in both observations. The served app contains the corrected no-match
wording and excludes the old no-timetable-coverage claim. Hashes and byte counts
are included in each machine-readable observation.

These checks used ordinary Node first-party HTTP reads with the existing platform
proxy environment, redirects rejected and per-request timeouts. No proxy or
network-setting changes, escalation, live timetable-provider requests or browser
workaround was used.

Local browser execution remains **not run past launch** due to the verified
Unix-socket restriction. Hosted Chromium/WebKit and published-map fixture evidence
supply browser acceptance; they do not rewrite the blocked local stage as a pass.
Native browser service-worker interception and live worldwide timetable coverage
were not claimed. Exact-version worker logic is covered by the committed tests.

## Reproduce this release's served-byte check

With the accepted source checked out and this evidence directory available:

```sh
node --use-env-proxy docs/investigations/departure-match-112/delivery/check-served-departure-match.mjs . browser-review/departure-match-served
```

The script uses the already configured environment and does not configure a proxy.
It is pinned to the accepted historical release; later deployments may correctly
fail its exact-byte checks. It saves fetched files and a JSON report in the chosen
temporary output directory. The independent contract supplies synthetic lookup
and board responses only.
