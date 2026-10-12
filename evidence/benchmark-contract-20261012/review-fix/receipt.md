# Default-cohort review fix receipt

Date: 2026-10-12. Tested and published source: `9b4b1ca835388dad9f8eb6ebd85062fa00db92aa`; tree `7ba8e4766777dfd88b0b278b5d332bab04ba7893`. This follow-up addresses [the default-cohort P2](https://github.com/c933103/openrailwaystyle/pull/198#discussion_r4249991437). Hosted CI and current-head re-review remain separate stages; no merge or deployment claimed.

The harness's `--describe` prints the same default trips/calls/repeats configuration consumed by a no-argument benchmark. CI asserts 10,000 trips, 24 calls and three repetitions independently of the smoke run. It also rejects extra describe arguments. This mode generates no fixtures, measurements or performance claims.

## Final-source checks

Linux 6.18.44 x86_64; Node 24.19.0, npm 11.9.0, Python 3.12.14; lockfile dependencies. No live-provider requests.

- `node --test tests/timetable-matching.test.mjs`: 116/116 pass, no skips.
- `npm test`: 1,501/1,501 pass, no skips, 109.989 seconds.
- `npm run build`, committed generated-style/station-byte equality, app/harness syntax, `git diff --check` and changed relative documentation links: pass.
- Full no-argument benchmark: unchanged 10,000-trip/24-call/28-profile cohort, two patterns, 10,000 observations and all 12 outcomes; all six source digests independently verified against final files.
- `python3 negative-controls.py` from the tested checkout: clean and harmless-edited sources pass without historical reports; false hashes, omitted negative output, broken work-limit reasons and separate changes to each of the three defaults fail. Nine controls in total; complete output retained beside this receipt.
- Only benchmark harness, regression tests and contract documentation changed since the prior head. The existing browser planner remains applicable: no affected browser inputs.

The [original migration receipt](../receipt.md) and its raw runs remain unchanged on this evidence branch. Earlier site CI passed on `5b1f1e1`; that result is not claimed for this new head. Original historical reports, application code, fixture archives, workflows and repository visibility remain unchanged.
