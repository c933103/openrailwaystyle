# Exact scheduled instants as a final departure merge veto

Bounded follow-up to [#113](https://github.com/c933103/openrailwaystyle/issues/113),
coordinated with [#129](https://github.com/c933103/openrailwaystyle/issues/129).
Baseline: `f9bd326c6a2a3738daafd36a58a16f9a2251c5a8`; every baseline source blob
was verified against the GitHub tree before editing ([verification](baseline-verification.json)).
Both broader issues remain open.

## Reproduced defect and bounded correction

Two otherwise compatible selected boards containing services scheduled at
12:00:00 and 12:00:30 were merged into one row. The same could happen for
subsecond differences. A minute bucket loses an available time distinction;
it can hide a departure and combine its cancellation, live platform or trip link
with another observation. The evidence here uses synthetic provider-shaped
responses, not a claim about a particular live Transitous response.

Keep the existing minute-level candidate graph, mutual-uniqueness checks and
same-list group veto. Add one final condition: a candidate group merges only
when every member has the same finite parsed scheduled instant. Equivalent
UTC-offset spellings agree; different seconds/milliseconds do not. `Date.parse`
provides millisecond precision. Existing arrival and absent-schedule actual-time
fallbacks remain unchanged; invalid explicit schedules do not justify a merge.

This is a monotonic restriction of the previous merge groups. It does not use
exact time to choose among previously ambiguous trains. A baseline group either
merges as before or remains as its original member rows; no new pair is merged.
Consequently, an unequal-time member also blocks a possible equal-time subset.

No provider/station exceptions, destination normalization changes, substring-only
matching, source-authority assumptions, extra network requests, stop-selection
changes or malformed-response handling are introduced. The original #131 Ōji
positive, mode families, named-line distinctions, simultaneous ambiguity,
real-time/platform retention and numeric-name guard are retained.

## Original contract and precision tradeoff

[PR #131](https://github.com/c933103/openrailwaystyle/pull/131) explicitly used
scheduled-minute matching. This change intentionally narrows that historical
policy; it is not a claim that the old algorithm promised exact time. The issue's
same-time and train-preservation requirements motivate the new veto.

Two feeds may round the same train's schedule differently. With no verified
precision metadata or shared boarding-occurrence proof, those observations now
remain separate. Duplicate-looking rows are a known conservative tradeoff.
Identical raw trip/stop IDs also do not override conflicting times: trips can
serve nearby or repeated stops, and raw IDs alone do not establish the same
boarding event. IDs and their scheduled/event context remain in the separate
rows for expansion and future reconciliation. A stronger, source-aware shared
identity model remains outside this correction.

The [original highlight fixture](original-highlight-fixture.txt), introduced in
[594f6f5](https://github.com/c933103/openrailwaystyle/commit/594f6f555d59e9681b29b222b7dbe627a2dade87),
intentionally merged :00 and :30 observations to expose a linked-trip time
highlighting bug. The relevant [original commit patch](highlight-original-commit.json)
is retained. It supplied a trip ID on only one observation and distinct stop
IDs; it did not establish shared train identity. Its previous expectation is
now split into three explicit contracts:

- Equivalent-instant observations may merge while keeping the linked stop.
- The original unequal-time observations remain separate and the linked row
  highlights its own repeated stop, in either board order.
- Direct schedule rendering still prefers an explicit `tripScheduled` over a
  different presentation `scheduled` value. This retains the old downstream
  regression even though the new merge gate no longer creates that state.

## Rejected first approach and review correction

The first attempt changed positive pair eligibility to exact time. Independent
review found that this could remove a same-minute competitor and unlock a new,
wrong merge. Example: board A has trip a at :00 and trip b at :30; board B has
trip b at :00 with cancellation. The narrowed eligibility transferred b's
cancellation to a, whereas the baseline kept all three observations ambiguous.
The defect also occurs when b genuinely visits two nearby/repeated stops, so it
does not require a bad provider timestamp.

A three-board chain additionally showed that narrowing edges could split an
ambiguous original group and newly merge a component. The accepted implementation
therefore keeps the original graph and applies the exact-instant condition only
after whole-group ambiguity is resolved. Both counterexamples are permanent
regressions. The rejected source, diff and manifest remain under
[rejected-first-approach](rejected-first-approach/); its passing old suite was not
accepted as proof of correctness.

## Validation and limits

Node v24.19.0. All tests are fixture-only; no live provider bulk queries.

- [Same 30 cases on baseline](baseline-regressions.log): 20 failures, 10 passes.
- [Rejected first approach](rejected-first-approach.log): 2 failures, 28 passes.
- [Final instant cases](successor-regressions.log): 30/30 pass.
- [Baseline cache regression](baseline-cache.log): 2/2 fail with the old token.
- [Focused parser/DOM/cache suite](focused-final.log): 158/158 pass.
- [Full unit aggregate](full-suite-final.log): 1,388/1,388 pass, none skipped or cancelled.
- [Build](build-final.log), generated style, syntax and whitespace checks are
  recorded beside this report. The generated style is unchanged.
- [Independent review](independent-review.md): no remaining blocker;
  [12,000 seeded multi-board cases](monotonicity-successor.json) found zero newly
  formed merge groups (8,267 baseline groups versus 2,664 successor groups).
  Reproduce with `node docs/investigations/departure-instant-113/monotonicity-check.mjs`.
- [Frozen source manifest](frozen-source-manifest.json) identifies the reviewed
  source/test/fixture bytes; [source diff](frozen-source.diff) records changes.

The coherent asset token is `20261012-departure-instant-1`. Exact predecessor
app/parser bytes are saved in `tests/fixtures/departure-instant-predecessor.json.gz`
for the cache upgrade regression; existing tabs retain their version.

No new browser rendering is introduced. Parser, acquisition, JSDOM schedule and
simulated service-worker cache tests cover this correction. Native browser
launch is not attempted in the current Unix-socket-restricted environment;
existing hosted browser gates and exact-head Codex review remain publication
acceptance gates, not implied by local unit results. This work does not certify
live timetable coverage, full cross-feed identity, public route refs or source
lineage reconciliation.

Reproduce from the repository root:

```sh
npm run build
node --test tests/departure-instant.test.mjs
node --experimental-vm-modules --test tests/departure*.test.mjs tests/train-schedule.test.mjs tests/sw-install.test.mjs
npm test
node --check styles/app.mjs
git diff --check
```
