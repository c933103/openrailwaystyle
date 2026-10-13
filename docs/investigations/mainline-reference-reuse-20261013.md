# Reuse verified reference data for current renderer acceptance

Related: [resource issue #150](https://github.com/c933103/openrailwaystyle/issues/150#issuecomment-6135853044).
Base source: `d8b70d02adf9babf72eb33c9d4ce2ba16ec9d3f0`.

## Observed cost and bounded change

The departure-only PR #200 changed the full reference acceptance digest, as it
should, but its normal reference workflow also chose a new source date and
planned 85,528,380,471 bytes of source PBF acquisition. The existing completed
continent checkpoints had a different source date/checksum and correctly could
not substitute for those newly requested source bytes. That run is unchanged.

This patch separates dataset-generation identity from current-app acceptance.
On a push or PR, the planner reads a complete published manifest at an immutable
Git commit. Matching generation inputs select that exact dataset and skip source
budget requests, checkpoint discovery and all continent extraction jobs. Assembly
verifies its retained data, runs the existing complete current-head renderer
checks, records both identities, re-verifies, then publishes normally. Site
readiness still requires the full current reference input digest.

The data identity includes the acquisition scripts, generator and recursive local
transform dependencies, whole package manifest/lock, and execution-affecting
workflow recipe. The recipe includes global env/defaults, extraction config and
assembly generation steps (runner, Node, tools, invocations and environment).
Unsupported relevant YAML aliases/anchors or unknown boundaries fail closed.
Renderer-only workflow acceptance steps do not invalidate data identity.

Existing manifests are accepted for one bounded migration only when the trusted
base source reproduces their entire accepted legacy input digest and the current
generator bytes match after removing exactly the old metadata import/field.
No old source code is executed, and no generation dependency is ignored.

## Review corrections and limits

- Verified reuse retains source date, source checksums, generation, coverage and
  tile/index/audit bytes. A generator mismatch uses the existing fresh two-days-ago
  policy, avoiding expired dated source URLs. Explicit/scheduled refresh retains
  the original fresh-date behavior.
- Global execution config is bound; relevant YAML aliases are rejected rather
  than partially interpreted.
- Assembly uses `!cancelled()` and explicit dependency results: skipped extraction
  permits reuse, while normal owner/concurrency cancellation is respected.
- Whole-lock invalidation is intentionally conservative: even a renderer-only
  package dependency update still regenerates. This patch does not attempt a new
  dependency-lock slicing or cross-run source cache system.
- Reuse still transfers published data from GitHub and runs full renderer checks.
  It does not mean zero network, zero CI cost or weakened data/acceptance gates.

## Final local validation

Environment: Linux, Node v24.19.0, npm 11.9.0; hosted CI uses Node 22.

- `npm test`: **1,525 passed**, zero failures, skips or cancellations.
- `node --experimental-vm-modules --test tests/mainline*.test.mjs`:
  **95 passed**, including failed metadata/API paths, immutable planning, legacy
  proof, fresh-date fallback, generation config mutations, cancellation, actual
  recorder/verifier CLI checks and changed tile/current-acceptance rejection.
- `npm run build`, generated style equality, changed script syntax, workflow YAML
  parsing and `git diff --check`: passed.
- Independent final source review: **35 focused checks passed**, no remaining
  blocker in the intended workflow after the three corrections above.

An offline replay used published commit
`407544ae5aaebdcdddcbe759e3e7a790010a513a`, source date `2026-10-10`, generation
`d3ee80fd77568ab00e5071f8`. The trusted base reproduced the accepted legacy digest
`70b3cdb7166621badb3fa94e9d4406d467d860615c91c75cceb5e8be01dc5699`;
old/current normalized generator digests both equalled
`2d6245d127969dd5b3f9d0c1d6d488e8399d6199758a56950095d535d5374d09`, so the
planner selected reuse of that exact commit. This is planner evidence only.

[Immutable raw logs, source manifest, patch and offline proof](https://github.com/c933103/openrailwaystyle/tree/af360f82fa7e20ba35c655a52af9f3e4f0e4b2dc/evidence/mainline-reference-reuse-20261013)
are separate from this source branch. The source manifest binds the eight tested
implementation/test/documentation files before this compact receipt was added.

Hosted full reference browser acceptance (840 observations plus 18 dark
observations), actual skipped-acquisition execution, current-head Codex and
required CI are still pending at publication. No provider acquisition was
initiated locally. No merge/deployment or measured hosted savings is claimed.
