# Reuse verified reference data for current renderer acceptance

Related: [resource issue #150](https://github.com/c933103/openrailwaystyle/issues/150#issuecomment-6135853044).
Base source: `d8b70d02adf9babf72eb33c9d4ce2ba16ec9d3f0`.
This receipt describes the simplified repair after Codex reviewed PR #201's first
head `0e76eaa7ccae97df34b9a3d32aa0217aa31d0d17`.

## Observed cost and final contract

The departure-only PR #200 changed the full reference acceptance digest, as it
should, but its normal workflow also chose a new source date and planned
85,528,380,471 bytes of source PBF acquisition. The completed checkpoints had a
different source date/checksum and correctly could not substitute. That PR and
its existing run were left unchanged.

This patch separates dataset-generation identity from current-app acceptance.
On a push or PR, the planner reads a complete published manifest at an immutable
Git commit. Matching generation inputs select that dataset and skip source
budget requests, checkpoint discovery and all continent extraction jobs. Assembly
verifies its retained data, runs all current-head renderer checks, records both
identities, re-verifies, then publishes normally. Site readiness still requires
the full current reference input digest.

Generation identity directly includes acquisition/compiler files, recursive
local transform dependencies, the **whole package manifest/lock and whole
reference workflow file**. Every workflow change invalidates reuse, including
plan date/preflight policy, tool versions, inherited configuration, aliases and
future YAML syntax. Renderer-only JavaScript/application changes can reuse;
renderer-only workflow or dependency-lock changes conservatively rebuild.
There is no custom YAML parser, projection or inferred legacy equivalence.
A legacy manifest without an independently recorded generator identity takes
the normal fresh path once. Failed metadata/API reads still fail closed.

Verified reuse retains source date, checksums, generation, coverage and geometry.
Missing/incompatible generation identity uses the existing fresh two-days-ago
policy, avoiding expired dated source URLs. Explicit/scheduled refresh remains
available. Assembly uses `!cancelled()` with explicit dependency results, so
skipped extraction permits reuse while owner/concurrency cancellation works.
Reuse still transfers published data from GitHub and performs full renderer work.

## Review repair and final local validation

Codex found two P2 issues in the first head: plan-stage acquisition policy was
omitted from the projection, and valid digit/hyphen-start YAML aliases escaped
its rejection pattern. Both reproduced. Rather than extend a partial YAML
interpreter, the final repair includes the entire workflow and removes projection,
legacy Git reads and metadata-string equivalence code. Regression mutations
cover both findings plus quoted/spaced/explicit mapping keys, inherited settings
and comment placement. Workflow-only renderer edits intentionally invalidate.

Linux, Node v24.19.0, npm 11.9.0 locally; hosted CI uses Node 22:
- `npm test`: **1,523 passed**, zero failures, skips or cancellations.
- `node --experimental-vm-modules --test tests/mainline*.test.mjs`: **93 passed**.
- Build, generated style equality, changed script syntax, workflow YAML parsing
  and `git diff --check`: passed.
- Independent final review: **33 focused checks passed**, no remaining blocker.
- Current data key: `d89f5bc2b5f33bc95a9bf982b732d1ef80284751fabf34a3d2c501e916996779`.
- Current full acceptance key: `80d1b7f90cd4f60d2601e4a26de22196cc334f3e9c49456e7fc264ef384d0293`.

[Immutable repair logs, source hashes and old-head regression proof](https://github.com/c933103/openrailwaystyle/tree/ca8c466cedc70ec009e9cb1f6bbbc3b0ec5e6398/evidence/mainline-reference-reuse-20261013/codex-repair)
are separate from source. The manifest binds the eight final tested files before
this compact receipt was updated. [Initial evidence](https://github.com/c933103/openrailwaystyle/tree/af360f82fa7e20ba35c655a52af9f3e4f0e4b2dc/evidence/mainline-reference-reuse-20261013)
remains preserved, not overwritten.

## Hosted status at repaired-head publication

The **superseded first head** completed its reference run
[38332904541](https://github.com/c933103/openrailwaystyle/actions/runs/38332904541):
SHA-pinned legacy reuse, skipped acquisition/extraction, and fresh 840 renderer
plus 18 dark app observations. Its preview commit was
`df4116119e80ad3ef9bd24e9a8879e4a9f8ba712`, retaining generation
`d3ee80fd77568ab00e5071f8` from source date `2026-10-10`. Those results prove
only that historical head; Codex's findings prevented treating it as ready.
Historical manifest download metrics are original provenance, not new traffic.

The simplified head intentionally needs a bootstrap rebuild for legacy data;
existing same-date verified continent checkpoints can still be used. New-head
hosted bootstrap acceptance, exact-head Codex and required CI remain pending.
No manual provider acquisition, new-head hosted reuse, measured savings, merge
or deployment is claimed. The full 840+18 gate remains required.
