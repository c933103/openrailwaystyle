# Lazy window-cache code PR #164: validation receipts

[PR #164](https://github.com/c933103/openrailwaystyle/pull/164) applies only the previously measured lazy feed-window cache plus six focused regression tests. Code head: `a313a22babd444ec93069234ca769f438b083ffc`; original PR base: `9ce43b0f93dadebdf3206429a6485691caf85d27`.

- 841 local tests pass with Node 22.23.3; 38 control/candidate equivalence cases pass.
- Build, app syntax and committed style/station output reproduction pass.
- A new correctness-only replay verifies all 121 prepared inputs and matches all 117 expected sanitized outputs, including 2,039 inventory / 106 compiled / 86 mapped coverage.
- The combined tree with later main `6c5fbb21ed86b0437f1bf2d6caca8819781e67f2` also passes all 848 tests, build and tracked generated-output reproduction. Both PR files and the current package manifests retain their intended identities. This compatibility check did not change the PR head.
- [Hosted frequency CI](https://github.com/c933103/openrailwaystyle/actions/runs/37897297337) passed all 53 fixtures. Its catalogue, compile, publish and assemble jobs were skipped on the PR event.

[Validation summary](validation-summary.json), [new-base output comparison](output-comparison.json), [exact output identities](output-identity.json), [combined-tree receipt](combined-compatibility.json), and raw test/build/assembly logs accompany this snapshot. `check_frozen_outputs.py` preserves the exact host-specific correctness-check script; its absolute paths are an execution receipt, not a portable installer. Use the frozen input extraction instructions in the [durable replay bundle](../replay-2026-10-09a/REPRODUCE.md) to obtain local inputs for independent checks.

Ordinary code checks can be reproduced by checking out the exact PR commit, installing the locked dependencies, and running `npm run build`, `npm test` and `node --check styles/app.mjs` under Node 22. The published source and test hashes are in [code-manifest.json](code-manifest.json). Generated style/station files must match the committed revision.

The [earlier performance cohort](../window-cache-ab-2026-10-09a/report.md) stays frozen on base `802062b5`, with its own Node 22.23.3/shared-host conditions. None of these new-base or combined-tree checks are relabelled performance samples. Original recovery remains **57/83, with 26 originals missing**.

The source patch introduces no acquisition behavior. Prerequisite #163 supplies fixture-only PR validation; production refresh behavior remains a separate existing workflow. Code/security review and full CI status remain live on the PR rather than being implied by this frozen local-validation snapshot.
