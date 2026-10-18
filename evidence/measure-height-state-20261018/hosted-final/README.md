# PR244 final-head hosted acceptance

Captured 18 October 2026 at 12:50 UTC. Source `82495d1bdc2d113c8fef740e1346db123e8ff2c4`, tree `e2a746da4ccfff8588a61a507cdfd390e10d98d9`, asset token `20261018-measure-height-state-2`.

## Outcomes

- Compare run39127062619, reference run39127062636 and site run39127062681 completed successfully on this exact head.
- Hosted validation passed 2,445 Node tests with zero failures/skips and the four offline search/CORS checks. Normal build, source integrity and style checks passed.
- All six browser groups ran freshly and passed: context, controls, infrastructure, frequency, platforms and rail-fixture. The aggregate browser-checks and record jobs passed. PR deploy correctly skipped.
- Result binding: tree `e2a746da4ccfff8588a61a507cdfd390e10d98d9`, data `214bfabb9dd7d11cc99d83e1bcc64be1`. Browser result reuse was false in this PR run.
- Reference generation `8b430e70e32c08a25a1c4aac` was reused without new extraction. Fresh renderer acceptance passed 840 controlled samples and 18 actual-app samples with zero provider requests. Median345ms/p951299ms are this fixture run's measurements, not production performance claims.
- Current-head Codex Code completed clean: https://github.com/c933103/openrailwaystyle/pull/244#issuecomment-6249886022 . Both earlier P2 threads are addressed and resolved.
- Security remains clean only at historical `c9b70df212e65ab2c88c3aa4f542ae8c40c88388`. Explicit requests have not produced current-head Security completion. No current-head Security completion is claimed. The summary explicitly reports `mergeGateEnabled:false`; no separate mandatory Security requirement was identified in repository acceptance documents or current checks. Exact-head Code satisfies the current-head review requirement. No merge or deployment is claimed.

## Contents and limits

`logs.zip` preserves decoded validation, reference, all six browser-group, aggregate and recording job logs plus the GitHub status/review/artifact metadata snapshot. `reference-diagnostics.zip` is the exact downloaded reference diagnostics artifact12136771837, including JSON and captures, SHA256 `e6bf1bd3f7b5cb5ca9749c54f9017904f59978517723caf8a85ea0713da65fd0`.

The large assembled-site, reference-data and six browser screenshot artifacts remain at their original GitHub Actions locations; their IDs, hashes and expiry metadata are recorded in the snapshot. Those additional binaries are not copied into this archive. Local source/reproduction/healthy-comparison evidence remains preserved in the parent evidence commits.

Current-head Code and applicable CI are successful; authorized merge/deployment remain separate. Existing domain/source/provider holds and wider #136/#112 scope remain unchanged.

