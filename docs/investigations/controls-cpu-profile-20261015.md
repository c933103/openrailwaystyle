# First detail-2 controls CPU experiment

Current controls acceptance leaves CPU sampling off unless explicitly requested
with `ATLAS_CONTROLS_CPU_PROFILE=1`. See the
[actual-path settlement capture](controls-settlement-boundaries-20261015.md)
for the later failure and bounded diagnostic change. The original experiment
below is retained as historical context.

The intermittent 60-second controls settlement failure remains unresolved.
PR #212 added bounded timing observations, not a runtime repair. Its accepted
head was `29e06a435020c7e7af24322827b366d873818c95`, merged as
`3f7aed56bbb84484181f0d06bcc13d8aaadd3eb6`. Postmerge site run 38745100640
reused that accepted PR browser result: its browser matrix was skipped. Its
successful deployment checks are not a fresh controls timing measurement.

## Question and retained evidence

The [original failure](https://github.com/c933103/openrailwaystyle/actions/runs/38723466393/job/116397579843)
left five station tiles loading and four browser requests pending when the
existing real-idle gate expired. All intercepted fixture handlers had completed
within 25 ms. The final retained 128 request records have median fixture-fulfilled
to browser-response latency of 1,195 ms, and median fixture-fulfilled to finished
latency of 1,292.5 ms. They eventually completed after the gate. This does not
establish a deadlocked request pool or identify the source of scheduling delay.
The [original immutable JSON evidence](https://github.com/c933103/openrailwaystyle/tree/e62125dd09787d56c3ae829e765e6ec5a2accad1/evidence/controls-settlement-20261015)
is unchanged.

The experiment asks whether page-thread JavaScript, garbage collection or native
work dominates the first desktop transition to detail level 2. It captures one
Chromium CPU profile at 10,000 microseconds per sample. Setup finishes before the
actual pointer action at 1365 x 900, menu open, readout enabled, detail 1 to 2.
The next real-idle settlement requests the capture's stop. A separate 60-second
watchdog also requests a stop if that transition, click or wait stalls. It does not accept,
cancel, retry or extend the readiness wait. Setup and collection each have a
2-second diagnostic bound; collection overlaps the existing bounded timing read.
Late setup/collection cannot restart a retired capture or replace its result.
The collector detaches its session after failure or timeout. If Chromium does
not answer a stop/detach command, actual sampling termination is unverified;
the UI wait still ends on its original deadline and browser teardown follows.

## Scope and artifact

No app, renderer, fixture, provider budget, URL hold, assertion, case or existing
deadline changes. The CPU session uses only `Profiler` commands and detachment;
it never evaluates page code or starts a request. It observes the page thread,
not MapLibre workers, the GPU process, operating-system scheduling or provider
performance. Sampling itself can change timing, so this is diagnostic evidence.

The ordinary controls CI artifact gains one `map-controls-cpu-profile.json`.
It retains only sample/node IDs, frame function names, script IDs and line/column
locations, HTTP(S) origins/paths, and CPU/wall-clock timings. URL credentials,
queries and fragments, non-HTTP URL payloads, source text, heap data, arguments,
request/response bodies, headers and arbitrary protocol error text are excluded.
Profiles exceeding 4,096 nodes/edges or 12,000 samples are reported unavailable,
not silently truncated. No raw capture or bulk run evidence belongs on the
application branch. Existing CI uploads `browser-review/` even after failure.

Node `requestedAt`/`startedAt`/`stoppedAt`/`receivedAt` are Unix milliseconds.
Profile `startTime`/`endTime`/`timeDeltas` are CDP monotonic microseconds; do not
directly subtract these clocks or equate them to the document's performance
origin. The nested `profile` is a sanitized CPU-profile structure for inspection.

## Stopping and interpretation

Run the normal fixture-safe controls CI once on the exact reviewed experiment
head. Stop sampling after this one transition or its watchdog; do not start
profiles for other viewports or automatically retry to manufacture a failure.
Inspect the existing settlement, request-lifecycle and browser-timing JSON beside
the CPU profile, recording the exact source and natural CI result.

- A reproduced timeout plus a dominant application stack supports a focused
  deterministic reproduction of that stack. Implement a fix only after that
  reproduction demonstrates causation and preserves output/readiness contracts.
- A passing transition characterizes that run only. It does not close the bug
  or prove that the failure's cause is absent.
- A low sampled JavaScript cost, native/idle-heavy profile, capture-limit stop,
  unavailable/oversized profile, or mismatch with timing/lifecycle evidence is
  inconclusive. Do not infer a provider, browser, GPU or host defect from it.
- Further tracing or a runtime change requires a separate evidence-backed
  decision. Provider request counts and readiness deadlines remain unchanged.

Local Chromium currently fails before application execution with
`socket() failed: Operation not permitted`; there is no local browser pass.
Unit tests cover one-shot capture, setup/stop failures and timeouts, late
completion, early exit, the watchdog, redaction, size limits and unchanged
fixture/acceptance integration. Hosted capture remains pending.
