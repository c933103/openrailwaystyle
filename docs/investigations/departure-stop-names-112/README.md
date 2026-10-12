# Departure stop-name compatibility (#112)

Base: `b5a73c3aa03498259c2fd531b9644d52ae94db69` (main including PRs #193,
#194 and #195). The only open PRs at preparation were the independent #185
and paused domain PR #157. Neither is changed here.

The [published reproduction](https://github.com/c933103/openrailwaystyle/issues/112#issuecomment-6119264172)
shows a nearer, unrelated substring name consuming one of the two requested
departure boards: Terminal 10 for Terminal 1, Central Park for Central, and
中央公園 for 中央. The same selected stop ID supplied both planner links.
These are synthetic application reproductions, not verified live-station
incidents or evidence of provider faults.

## Change and boundaries

- Score complete normalized station names and supplied aliases before distance
  ordering and the two-stop cap. Do not turn arbitrary same-script prefixes,
  suffixes or numeric extensions into aliases.
- Preserve complete native/Latin bilingual components in either order, including
  東京 Tōkyō, Москва Moskva and Αθήνα Athína. Conflicting native components
  prevent operator-only matches such as JR 東京 / JR 神田; complete normalized
  equality takes precedence over inferred component boundaries. Whitespace, slash and parenthesized
  separators are recognized; native scripts remain together. This is bounded
  name compatibility, not proof of translation or a global station resolver.
- Preserve station-word, case, punctuation and NFKC normalization. Explicitly
  labelled trailing platform/track metadata (numbers, letters, combined/range
  labels) is removable; bare numbers and
  arbitrary parenthesized station suffixes are retained.
- Multiple operators or platforms with compatible names still supply two
  boards. The rail-mode filter, 400 m radius, distance ordering, caller limit,
  and nearest-rail fallback when **no** names match are unchanged. Thus an
  unknown name can still use the existing geographic fallback; this change
  does not claim to establish every station identity worldwide.
- No departure-row merging, envelope parsing, time/platform resolution, cache
  identity/expiry, request limits, retry policy or planner rendering changes.
- Advance the shared asset token to `20261012-departure-stop-names-1`, including
  all versioned imports, so cache-first installed clients receive the change.
  Keep the service-worker logic and cache generation unchanged.

## Independent review

[Independent review and corrected findings](independent-review.md) passed on the
final matcher bytes. It independently ran 148 focused tests, all five review
reproducers, and 1,050 numeric-boundary comparisons. Its portable
[reproducer](independent-review.mjs) and [output](independent-adversarial.log)
are retained alongside the final validation evidence.

## Validation

All provider responses in these checks are injected fixtures. No automated
requests to Transitous, map providers, or bulk data services were made.

| Check | Result | Evidence |
| --- | --- | --- |
| New stop-name suite against unchanged base module | Expected failure: 19 failures, 19 controls pass | [baseline log](baseline-regressions.log), [exit](baseline-regressions.exit) |
| All departure unit/DOM tests | 187 passed, zero failed | [focused log](focused.log), [exit](focused.exit) |
| Full `npm test` | 1,476 passed, zero failed/skipped | [full log](full-suite.log), [exit](full-suite.exit) |
| `npm run build` | Passed | [build log](build.log) |
| Generated style and major-stations files | Unchanged | [log](generated-style.log), [exit](generated-style.exit) |
| Syntax and whitespace | Passed | [syntax exit](syntax.exit), [diff exit](diff-check.exit) |
| Actual application in Chromium | Passed all departure scenarios, including 18 candidate permutations, both journey links and reopening cache | [browser log](browser.log) |
| Local WebKit | Launch blocked by missing host libraries; no WebKit scenarios ran locally | [browser log](browser.log), [combined exit](browser.exit) |

The combined browser command exits 1 solely after Chromium completes and WebKit
cannot launch. Missing libraries: `libgtk-4.so.1`, `libgraphene-1.0.so.0`,
`libwoff2dec.so.1.0.2`, `libharfbuzz-icu.so.0`, `libhyphen.so.0`,
`libmanette-0.2.so.0`, and `libGLESv2.so.2`. The existing hosted fixture workflow
installs WebKit dependencies and must pass on the PR head before readiness.

Commands (Node 24.19.0, pinned lockfile dependencies, install scripts disabled):

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node --experimental-vm-modules --test tests/departures.test.mjs tests/departure-*.test.mjs
npm test
node --check styles/departures.mjs
node --check styles/app.mjs
node --check scripts/check-departures-browser.mjs
git diff --check
git diff --exit-code -- styles/world.style.json styles/major-stations.geojson
node scripts/check-departures-browser.mjs
```

The [negative-control runner](run-baseline.mjs) executes a temporary copy of
the new stop-name suite with the pinned base module loaded by a data URL,
without changing the working implementation. Run it with
`node docs/investigations/departure-stop-names-112/run-baseline.mjs`; exit 1 is
expected. It covers the reproduced defects and extended compatibility checks. [The source manifest](source-manifest.json) records
the exact validated source bytes; test logs include timings and temporary paths.
Broader #112/#129 audits remain open.
