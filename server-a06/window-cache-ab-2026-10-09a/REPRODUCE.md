# Reproduce the lazy window-cache experiment

This independent candidate lazily computes the feed-level window label once per feed. It does not include the earlier rich-record guard. Both measured variants are pinned to the earlier main commit `802062b5c44718e6baf3d36db5010ee42799368c`, not the later preview-server merge. The measured runtime is Node.js 22.23.3. Any new run needs a distinct cohort ID and actual runtime/dependency fingerprints.

The input scope is immutable parsed-JSON feed objects. The first window-label evaluation stays after route/agency validation and segment-profile projection; empty and all-unmapped feeds never evaluate it. A valid empty string remains cached. Arbitrary getters or mutating iterables are outside this scope.

Run from a fresh directory. The package-manager step only acquires locked development dependencies; the experiment never accesses timetable providers or metadata URLs.

```sh
git clone --single-branch --branch evidence/atlas-baseline-2026-10-08 https://github.com/c933103/openrailwaystyle.git atlas-evidence
cd atlas-evidence
REPO="$PWD"
REF="$REPO/server-a06/replay-2026-10-09a"
EXPERIMENT="$REPO/server-a06/window-cache-ab-2026-10-09a"
WORK="$REPO/../atlas-window-cache-replay"
mkdir "$WORK"
git fetch origin 802062b5c44718e6baf3d36db5010ee42799368c
git worktree add --detach "$WORK/control" 802062b5c44718e6baf3d36db5010ee42799368c
git worktree add --detach "$WORK/candidate" 802062b5c44718e6baf3d36db5010ee42799368c
git -C "$WORK/candidate" apply --check "$EXPERIMENT/candidate.patch"
git -C "$WORK/candidate" apply "$EXPERIMENT/candidate.patch"
npm --prefix "$WORK/control" ci --ignore-scripts --no-audit --no-fund
ln -s "$WORK/control/node_modules" "$WORK/candidate/node_modules"
NODE="$(command -v node)"
"$NODE" --version
ATLAS_CONTROL="$WORK/control" ATLAS_CANDIDATE="$WORK/candidate" "$NODE" --test "$EXPERIMENT/equivalence.test.mjs"
python3 -B "$EXPERIMENT/prepare_pair_identity.py" --cohort my-distinct-window-cache-replay --control "$WORK/control" --candidate "$WORK/candidate" --dependencies "$WORK/control/node_modules" --node "$NODE" --reference "$REF" --experiment "$EXPERIMENT" --output "$WORK/identities"
python3 -B -O "$REF/replay_bundle.py" --bundle "$REF" --fixtures "$REPO/server-a06/2026-10-09/recovered" --destination "$WORK/reconstructed"
python3 -B "$EXPERIMENT/test_supervision.py"
python3 -B -O "$EXPERIMENT/test_supervision.py"
for STEP in 01:control 01:candidate 02:candidate 02:control 03:control 03:candidate 04:candidate 04:control; do
  PAIR=${STEP%%:*}
  SIDE=${STEP##*:}
  python3 -B "$EXPERIMENT/measure_replay.py" --identity-manifest "$WORK/identities/$SIDE-identities.json" --source "$WORK/$SIDE" --dependencies "$WORK/control/node_modules" --reconstructed "$WORK/reconstructed" --bundle "$REF" --work "$WORK/runs" --artifacts "$WORK/observations" --node "$NODE" --run-id "pair-$PAIR-$SIDE" || exit 1
done
python3 -B "$EXPERIMENT/analyze_pairs.py" --runs-dir "$WORK/observations" --output-dir "$WORK/analysis"
```

Recompute only the supplied analysis with `--runs-dir "$EXPERIMENT/runs"` and a fresh output directory. The two `*-executed.py` files preserve the original host-specific launch/check scripts as receipts; the portable commands above are the supported replay sequence.

The identity helper checks both published source closures, the measurement-harness hash and locked dependency versions. It records a distinct local runtime/dependency identity and refuses existing output directories. The harness verifies source/dependencies/runtime/reference before each launch, all 121 prepared input identities, all 117 raw output identities and post-run source provenance. An unexpected extra output, any non-null guard termination reason, nonzero exit or capture/cleanup error rejects the run.

Blocking `wait4(pid, 0)` returns direct-child CPU/RSS and defines the wall end timestamp immediately on return. A separate 250 ms sampler monitors memory/load and enforces the same wall/RSS limits for both sides; it never reaps the child. Surviving owned process-group members are killed and flagged before another run may start. Scheduling wakeup latency is still possible. CPU, file-size and Node heap bounds are retained. Optional per-process I/O counters remain unavailable.

Fresh copies and source/input hashing warm filesystem caches. These are not cold-cache or exclusive-host runs. Keep the balanced order, all raw samples and all pairs; do not pool other runtimes, hosts, instrumented profiles or the earlier rich-record experiment. `Date.now()` is unmodified; timestamp/expiry differences must fail the exact-output gate rather than be stripped.
