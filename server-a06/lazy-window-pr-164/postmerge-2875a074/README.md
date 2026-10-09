# PR 164 post-merge verification

The lazy per-feed window cache is merged at `2875a0744912633f35cd6faba25e3260dae09d89`. Its tree `022a4b8cdc6d42ecb96da5969fe27217e4932fde` equals the exact reviewed and tested PR tree at `4d34da8a3d06e83b7c979bd882c4725d3cebbd7a`.

The automatic [frequency refresh](https://github.com/c933103/openrailwaystyle/actions/runs/37900129169) passed its catalogue, eight compilation shards, assembly and publication. The [initial merge site run](https://github.com/c933103/openrailwaystyle/actions/runs/37900129119) passed at 07:55:43 UTC. The refresh explicitly dispatched [site run 37901259820](https://github.com/c933103/openrailwaystyle/actions/runs/37901259820), which passed at 08:08:58 UTC on the same merged source. Both site runs passed all six browser groups, aggregate, Pages deployment, six deployed vector-tile byte comparisons and the deployed local-fixture renderer. These are bounded deployment checks, not exhaustive map verification.

The [live site](https://c933103.github.io/openrailwaystyle/) was deployed by these automatic workflows. No manual provider run or local provider acquisition was triggered for this verification. The other worker's earlier run 37899340677 at source 6c5fbb21 is separate and is not counted here.

`workflow-receipts.json` preserves selected GitHub run/job fields and complete deployment-step outcomes. `postmerge-verification.json` records exact identities, source log hashes and scope. The three labelled log excerpts preserve original complete selected lines byte-for-byte; the two full deployment logs are over 7 MB each and are not duplicated in this small checkpoint. Their original Actions links remain subject to Actions retention. The excerpts are the durable proof included here, not a claim that all original job logs are retained. `extract_deployment_evidence.py SOURCE OUTPUT` reproduces each deployment excerpt from its corresponding full UTF-8 log; the one-line dispatch filter is recorded in the JSON receipt. No secret values, input archives, working outputs, dependency copies, runtime binaries or private approval metadata are included.

## Performance and evidence boundaries

The [frozen paired report](../../window-cache-ab-2026-10-09a/report.md) measured the isolated change on earlier base 802062b5 with Node 22.23.3: median paired wall time -9.66% and CPU -7.23%, with all four pairs lower; RSS was mixed. Those numbers are not new-main, production or cross-host measurements. The exact two-file implementation admission, integrated correctness checks and accepted-head reviews are recorded in the neighbouring PR 164 packages. The prior font timeout remains recorded with its unresolved cause; later accepted-head and post-merge checks passed without weakening that check.

Original A06 recovery remains 57/83, with 26 missing original artifacts. This post-merge package is new evidence and does not repair or relabel those missing originals.
