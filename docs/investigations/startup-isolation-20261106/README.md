# Bounded startup fixture processes

## Finding and scope

On Node 24.22.1, the unchanged startup test file repeatedly ended with SIGKILL.
One normal-heap isolated run passed 165 cases before termination, with peak
child RSS 1,948,672 KiB. The identity of the process that sent SIGKILL and the
operating-system reason have not been established. Hosted Node 26.13 passed the
same assertions. This is not evidence of a production application memory leak.

A small fixture-only reproduction separates closed JSDOM windows from evaluated
VM modules. After 120 iterations, with explicit GC between iterations:

- JSDOM alone returns to one native context, about 39 MB live heap.
- Adding an evaluated `vm.SourceTextModule` retains 121 native contexts and
  about 175 MB live heap.
- Adding an unused dynamic-import callback gives the same retention pattern.

The actual startup file, with diagnostic GC after each test, grew from about
59.9 MB live heap / two native contexts to 1.65 GB / 164 contexts and was killed
after 88.4 seconds. CPU, address-space, data and RSS resource limits were
unlimited, and no Node heap/test-timeout override was set. A map-remove-before-
window-close probe did not fix it. Restricted 512 MiB and 1,024 MiB old-space
experiments exhausted those heaps; neither is an adopted fix or proof of the
normal-heap signal's cause.

## Repair

Keep the existing cases in three ordinary Node test files, so each process ends
before retaining the entire suite's VM contexts. Shared setup and the seven
previously interspersed helpers live in `tests/startup-harness.mjs`. That module
preserves the existing unmocked-network denial and exit/after hooks in every
process. No test runner, production code, dependency, CI gate or acceptance
assertion is changed.

`case-audit.json` records the baseline commit/source hash, all 157 top-level
registration names and SHA-256 hashes of every registration statement. Every
statement, including nested subtests and assertions, is byte-identical after
moving it. The three ordered groups contain 53, 52 and 52 registrations, with
an exact ordered name match, no omission and no duplicate. The only ordering
change is normal test-file scheduling; each case keeps its original body.

The serial startup suite passes all 169 cases, zero failures/skips. Normal
parallel execution also passes all 169. No forced GC, heap restriction,
name-based sharding, skipped cases, timeout increase or reduced checks is used.
Separate normal-heap runs measured peak child RSS of 909,552, 818,096 and
849,868 KiB, all below 889 MiB. See `measurements.json` for the actual results.
Full-suite and hosted final-head qualification are recorded in the PR receipts.

## Reproduce

Run the complete current suite, including any targeted name pattern, against
the full glob:

```sh
node --experimental-vm-modules --test tests/startup*.test.mjs
node --experimental-vm-modules --test --test-concurrency=1 tests/*.test.mjs
```

The unchanged `npm test` command already discovers every `tests/*.test.mjs`.
Keep future startup fixtures in bounded sibling test files rather than growing
one VM-heavy process again. Historical investigation logs/manifests continue to
refer to the source layout at their original commits and are not rewritten.

The manual diagnostic below uses synthetic HTML and makes no network requests.
It is not a normal test or a CI gate:

```sh
for mode in dom module dynamic; do
  node --expose-gc --experimental-vm-modules \
    docs/investigations/startup-isolation-20261106/reproduce-vm-retention.mjs "$mode"
done
```

The default-heap, teardown and restricted-heap investigation receipts are
[recorded on #374](https://github.com/c933103/openrailwaystyle/pull/374#issuecomment-6696996424).
The failed hypotheses were removed, not silently adopted.
