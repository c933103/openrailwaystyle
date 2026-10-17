# PR236 local acceptance evidence

[PR #236](https://github.com/c933103/openrailwaystyle/pull/236), exact head `f3ab73701401cf8a8c5312d07d3e3c028b084cb7`, based on `7defb0ffdd6d6dddb570407369227b9c27f0e657`.

The ZIP preserves the source patch, preparation receipt, baseline negative control, final local 60-test focused and 2,190-test aggregate runs, build output, source verification, and independent 67-test focused / 42-test chunked-stream review. The initial fixture-only resumption failure is retained separately in `focused.log` and explained in the receipt. Final tests pass without skips. The independent exact-limit HTTP-error retry diagnostic remains a distinct pre-existing P2 under active separate repair; the two archived diagnostic logs show it on base and candidate.

All acquisition cases use offline injected fetch. No live provider requests or acquisition dispatch are evidence here. These logs do not substitute for hosted required CI, current-head Codex acceptance, merge or deployment verification. The preparation receipt records the earlier not-yet-published status; the PR linked above is the later published source.

- Archive SHA-256: `80919b417e5124cfe1df48e5c71df98d59666b3cd3e6c48476d626c441411bad`
- Archive bytes: 96782
- `manifest.json` records every uncompressed entry's SHA-256 and byte count.
- Reproduction commands are in `receipt.md`; run the source tests from the pinned repository root. The independently archived test scripts retain their original absolute import paths as evidence; to rerun them in another checkout, point those imports to that exact checkout's `scripts` directory, without altering test assertions.

No runtime files or repository visibility are changed by this evidence branch.
