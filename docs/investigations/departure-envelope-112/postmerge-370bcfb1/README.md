# Completed #193 merge and deployment verification

The malformed stop-board increment in [PR #193](https://github.com/c933103/openrailwaystyle/pull/193)
was merged as `370bcfb1db684d80520ea43430e1cbb5bdb360dd`. GitHub's Git objects
confirm its tree is exactly the independently reviewed source-head tree
`e8367857d070314eed9c061857077b5118b94c5e` from
`ddae2afeea292c91b5720548aa48b84b1e5bb5df`.

## Bounded completion

- [Direct merge site run 38195488586](https://github.com/c933103/openrailwaystyle/actions/runs/38195488586): success, attempt 1, exact merge head. Validation, all six browser groups, deployment, deployed tile equality and both deployed map/reference checks pass.
- [Merge reference run 38195488851](https://github.com/c933103/openrailwaystyle/actions/runs/38195488851): success. It reused the completed dated extracts, verified/published the production reference and invoked the existing production redeploy step.
- [That direct successor, site run 38196178426](https://github.com/c933103/openrailwaystyle/actions/runs/38196178426): success, attempt 1, same merge head. All validation/browser/deployment and deployed-map checks pass again.
- The relevant departure script passes in both Chromium and WebKit in each site run: 37.5 seconds in the direct run and 45.4 seconds in the successor. Each engine records all 180 intercepted requests for malformed-board partial/recovery cases; existing repeated, interrupted, translated and cache flows also pass.

The exact run/job receipt is [workflow-receipt.json](workflow-receipt.json).
The retained [reference publication excerpt](reference-publish-summary.log) binds
the normal redeploy call to the successful reference workflow. No manual retry,
extraction dispatch, browser workaround or workflow/cache change was used.

## Actual production bytes and behavior

First-party reads after each deployment returned HTTP 200 and byte-for-byte
equality with the accepted merge for all 12 checked files: the page, app,
departure parser/renderer, map-model and its two direct imports, the remaining
versioned dependency entry points, CSS and service worker. The generated bundle
identified exact merge `370bcfb1` and version `20261011-departure-envelope-1`.

- [Direct deployment readback](direct-served-verification.json), observed 2026-10-12 at 02:49 UTC: 366/366 parser/DOM/cache checks pass against actual fetched production bytes.
- [Successor readback](successor-served-verification.json), observed 2026-10-12 at 03:13 UTC: the same 12 files and build identity still match; 366/366 checks pass again.

The independent probe covers 26 malformed body/envelope shapes, both selection
and completion orders, valid empty/populated siblings, preserved healthy rows,
bounded requests/signals, translated partial caching, expiry, all-invalid
eviction and normal recovery. It uses synthetic response bodies only.

Reproduce the first-party readback from this evidence branch, whose application
sources exactly match merge `370bcfb1`, with the project dependencies installed:

```sh
node docs/investigations/departure-envelope-112/postmerge-370bcfb1/check-served-envelope.mjs "$PWD" /tmp/served-envelope-check
```

This command intentionally requires that historical exact release. A newer
production release may legitimately have different bytes; the recorded timestamp,
commit/version and hashes state what was actually observed at acceptance.

## Retained evidence and limits

- [Direct controls log excerpt](direct-controls-summary.log) and [direct deployed checks](direct-deploy-summary.log)
- [Successor controls log excerpt](successor-controls-summary.log) and [successor deployed checks](successor-deploy-summary.log)
- [Premerge exact-head log and six visually inspected malformed-state screenshots](../hosted-ddae2af/README.md)
- [Checksums](SHA256SUMS)

Hosted browser fixtures use controlled responses; the local served-byte probe
executes the fetched parser/DOM/cache and is not a native browser session. No live
Transitous fault or geographical/timetable coverage claim follows from this
evidence. Wider #112 and #129 remain open. This completion ends with these two
linked deployment runs; later PR delivery and unrelated scheduled runs are
separate work.
