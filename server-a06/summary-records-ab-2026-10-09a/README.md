# Atlas A06: bounded summary-record experiment

**Decision: keep the patch unmerged. These four shared-host pairs suggest a small benefit but do not establish a robust, broadly applicable speedup.**

All eight executions matched all 117 reference outputs. Candidate wall and CPU time were lower in all four pairs; median paired changes were **−2.06% wall** and **−2.22% CPU**. The wall effect depended strongly on order: **−3.80%** for control-first pairs versus **−0.72%** for candidate-first pairs. Both latter differences were about one 250 ms completion-poll interval. Peak RSS improved in two pairs and worsened in two.

Other local tests ran concurrently on this shared host. The fixed AB/BA/AB/BA plan was not changed, and no pair was discarded. Treat the result as modest, uncertain evidence; no production code was changed or optimization merged.

- [Full report](report.md), [paired results](analysis/pairs.json), [summary](analysis/summary.json), [CSV](analysis/metrics.csv)
- [Contention and order effects](analysis/contention-and-order.json)
- [Exact candidate patch](candidate.patch) and [frozen experiment plan](experiment-plan.json)
- [Raw eight-run observations and identities](runs/)
- [Equivalence tests](equivalence.test.mjs), [test results](equivalence-tests.log), [control source tests](control-source-tests.log), [candidate source tests](candidate-source-tests.log)
- [Reproduction](REPRODUCE.md), [environment](environment.json), [payload hashes](publication-manifest.json)

This experiment uses Node.js 24.19.0 and pinned main `802062b5c44718e6baf3d36db5010ee42799368c`, plus the separately hashed candidate patch. It does not compare against Node.js 22 or the earlier host. Original evidence recovery remains **57/83**, with 26 missing originals. The [complete new replay cohort](../replay-2026-10-09a/README.md) and its durable sanitized inputs/reference are reused without duplicate data archives.
