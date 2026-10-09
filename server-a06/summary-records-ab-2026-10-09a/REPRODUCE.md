# Reproduce the bounded A/B experiment

This is a new experiment, separate from both the original 57/83 recovery and `replay-20261009a`. Use its frozen input/reference artifacts; do not fetch provider data or exercise metadata URLs. The candidate patch only guards rich display-record creation in summary-only assembly.

The measured runtime was Node.js 24.19.0. A cached Node.js 22.23.3 was discovered later but was not used here. Another runtime or host must have a distinct cohort ID and its own recorded identities.

Run from a fresh directory:

```sh
git clone --single-branch --branch evidence/atlas-baseline-2026-10-08 https://github.com/c933103/openrailwaystyle.git atlas-evidence
cd atlas-evidence
REPO="$PWD"
REF="$REPO/server-a06/replay-2026-10-09a"
EXPERIMENT="$REPO/server-a06/summary-records-ab-2026-10-09a"
WORK="$REPO/../atlas-paired-replay"
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
python3 -B "$EXPERIMENT/prepare_pair_identity.py" --cohort my-distinct-paired-replay --control "$WORK/control" --candidate "$WORK/candidate" --dependencies "$WORK/control/node_modules" --node "$NODE" --reference "$REF" --experiment "$EXPERIMENT" --output "$WORK/identities"
python3 -B -O "$REF/replay_bundle.py" --bundle "$REF" --fixtures "$REPO/server-a06/2026-10-09/recovered" --destination "$WORK/reconstructed"
for STEP in 01:control 01:candidate 02:candidate 02:control 03:control 03:candidate 04:candidate 04:control; do
  PAIR=${STEP%%:*}
  SIDE=${STEP##*:}
  python3 -B "$REF/measure_replay.py" --identity-manifest "$WORK/identities/$SIDE-identities.json" --source "$WORK/$SIDE" --dependencies "$WORK/control/node_modules" --reconstructed "$WORK/reconstructed" --bundle "$REF" --work "$WORK/runs" --artifacts "$WORK/observations" --node "$NODE" --run-id "pair-$PAIR-$SIDE" || exit 1
done
python3 -B "$EXPERIMENT/analyze_pairs.py" --runs-dir "$WORK/observations" --output-dir "$WORK/analysis"
```

The identity helper verifies both published source digests and locked package versions before recording a new local runtime/dependency identity. It does not overwrite supplied configurations or existing output directories. The measurement harness verifies source/dependencies/runtime/reference manifest and all 121 copied inputs, then requires all 117 output hashes to match. It keeps raw failures rather than silently accepting different outputs.

To recompute only the supplied results, run `analyze_pairs.py` with `--runs-dir "$EXPERIMENT/runs"` and a fresh `--output-dir`.

The four-pair order is AB/BA/AB/BA. Do not pool the earlier baseline, instrumented profiles, or other hosts/runtimes. Preserve shared-host load and memory observations. Fresh process/input copies are warmed by copying and integrity checks; these are not cold-cache measurements. The original `Date.now()` and 250 ms completion polling remain unchanged; expiry-related output differences must stop the comparison.
