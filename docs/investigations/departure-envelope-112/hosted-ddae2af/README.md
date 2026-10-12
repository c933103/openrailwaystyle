# Hosted acceptance for malformed departure boards

Exact reviewed source head: `ddae2afeea292c91b5720548aa48b84b1e5bb5df` in
[PR #193](https://github.com/c933103/openrailwaystyle/pull/193).
This evidence-only branch does not move that source head.

## Completed gates

- [Site workflow 38186929980](https://github.com/c933103/openrailwaystyle/actions/runs/38186929980): success, attempt 1. Hosted build/reproducibility/syntax and all 1,380 Node tests pass; no skipped/cancelled tests. The separate offline search checker also passes 4/4.
- All six browser groups pass: controls, context, infrastructure, platforms, frequency and rail fixture. Aggregate `browser-checks` and recorded `site/browser-checks` status are successful. PR deployment is intentionally skipped.
- [Reference workflow 38186929979](https://github.com/c933103/openrailwaystyle/actions/runs/38186929979): all eight dated continent jobs, assembly and renderer verification pass. This is the unchanged automatic CI prerequisite; no manual extraction dispatch or workflow/cache change was used.
- [Codex review](https://github.com/c933103/openrailwaystyle/pull/193#issuecomment-6115464179): no major issues for exact head `ddae2afeea`. No inline review threads remained at acceptance readback.

## Departure-browser acceptance

[Controls job 114634796673](https://github.com/c933103/openrailwaystyle/actions/runs/38186929980/job/114634796673)
executes `check-departures-browser.mjs` with the real renderer in Chromium and
WebKit. Both engines pass:

- Existing station board, selectable text, full trip, keyboard, cache/retry and missing-trip-identity checks.
- Existing partial-empty/partial-rows, both source orders, Close/reopen, translated redraw, expiry, all-failed eviction, unmatched-stop cache and malformed lookup recovery.
- New malformed board envelopes with healthy empty/populated siblings in both source orders, retained cached partial warning, normal expiry and all-malformed eviction/recovery. Each engine records 180 intercepted requests for these new cases.
- Close during pending partial results, late settlement staying hidden and cached reopening.

The complete departure browser script passes in 37.3 seconds. The
[controls log](controls-job.log), [timing record](timings-controls.json),
[validation summary](validation-summary.log), and [source/run/artifact receipt](acceptance.json)
are retained here. Original controls ZIP artifact 11722189059 was 4,332,304 bytes;
its downloaded SHA-256 matched GitHub's recorded
`dd5e5a401d4d63f085167c9f4f3e82fa02be6bb975af744c97735e94d996e6ee`.

## Visually inspected screenshots

All six native artifact screenshots were inspected. The partial-empty view keeps
the incomplete-load warning without a false complete-empty claim; partial rows
retain the healthy `G`/`Fixture terminus` row and warning; all-malformed shows the
generic loading failure. Text remains inside the panel in both engines.

- Chromium: [partial empty](screenshots/departures-malformed-empty-chromium.png), [healthy row retained](screenshots/departures-malformed-rows-chromium.png), [all malformed](screenshots/departures-all-malformed-chromium.png)
- WebKit: [partial empty](screenshots/departures-malformed-empty-webkit.png), [healthy row retained](screenshots/departures-malformed-rows-webkit.png), [all malformed](screenshots/departures-all-malformed-webkit.png)

These are synthetic, transport-guarded responses. They do not establish a live
Transitous provider fault or real-world timetable coverage. No local browser
launch or restriction bypass was used. Native browser service-worker network
interception remains outside this fixture's scope. Wider #112/#129 remain open;
ready/merge/deployment decisions are separate from this acceptance record.
