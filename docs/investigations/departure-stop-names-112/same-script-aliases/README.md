# Codex P2: explicitly supplied same-script aliases

Predecessor: `d252a702de3cdd322e2f5c0a9bb4e5db3a37d079` in PR #196.

[Codex finding](https://github.com/c933103/openrailwaystyle/pull/196#discussion_r4245569333):
with map aliases `['München Hbf', 'Munich']`, a provider stop named
`München Hbf / Munich` or `München (Munich)` was discarded when another
exact-name operator stop was present. This could drop the second operator's
board. The finding was reproduced against that exact predecessor.

## Bounded correction

Recognize two complete names separated by an explicit slash or trailing
parenthesized alias. Accept the composite only when **every component** is
independently present among the map's complete supplied aliases after the
existing normalization. Inferred operator fragments are not evidence.

This preserves both Munich composites, including reversed alias order, when
both aliases are supplied. With the second alias absent, the composite remains
ineligible whenever another compatible stop exists. `Central (North)`,
`Central / Park`, `Terminal 1 / Terminal 10`, a partial `Munich Park` alias,
and `JR (神田)` remain negative controls. No same-script substring matching or
blanket suffix removal has been restored.

The original radius, mode, distance, cap, fallback, request, cache and row
behavior remain unchanged. The release asset token is unchanged because this
is a revision of the same unmerged release.

## Final validation

- New complete stop-name suite: **44 passed**.
- Focused departure unit/DOM suite: **194 passed**, zero failed/skipped
  ([log](focused.log)).
- Full `npm test`: **1,483 passed**, zero failed/skipped
  ([log](full-suite.log), [exit](full-suite.exit)).
- Build, syntax, whitespace and generated-style consistency: passed
  ([build log](build.log)).
- Chromium: complete departure fixture passed, including all 18 original
  substring permutations and all **24** supplied/absent-alias composite
  permutations, both planner directions and cached reopening
  ([browser log](browser.log)).
- Local WebKit still cannot launch because the host libraries listed in the
  initial report are missing. The combined browser command exits 1 after
  Chromium passes ([exit](browser.exit)); hosted WebKit CI remains required.
- Negative control on the exact predecessor: **5 expected failures, 39 passing
  controls** ([log](baseline.log), [exit](baseline.exit)).

[Independent follow-on review](independent-review.md) passes: **155** focused
tests, **1,062** composite/absent-alias permutation checks, and the previous
**1,050** numeric-boundary checks plus five repaired findings. Its portable
[reproducer](independent-adversarial.mjs) and [log](independent-adversarial.log)
are included here. [Source hashes](source-manifest.json) identify the validated
bytes. All responses are synthetic; these checks made no live provider requests.

To rerun the negative control without changing production files:

```sh
node docs/investigations/departure-stop-names-112/same-script-aliases/run-baseline.mjs
```

Exit 1 is expected on `d252a702`; the five failing tests pass with the correction.
The runner requires that predecessor commit in the local Git object database.
The normal build, full-suite and browser commands remain those in the parent
report. CI and review acceptance must be checked against the new PR head,
not the predecessor.
