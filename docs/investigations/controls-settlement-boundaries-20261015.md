# Observe the actual controls settlement boundary

The intermittent controls timeout remains unresolved. This is a bounded harness
correction and diagnostic capture, not a production rendering fix.

## Verified failure

[PR214's controls job](https://github.com/c933103/openrailwaystyle/actions/runs/38807776095/job/116679974603)
tested merge `b5db4cad594a075cf287e191f0fa0df7963cc96e`, combining head
`589f38cc2edc617826adb35cfa31a4ca9df0459d` with main
`4d44db85a61d956d81d51549ffb5310085f2265c`.
The [49-file artifact](https://github.com/c933103/openrailwaystyle/actions/runs/38807776095/artifacts/12008650975)
has ZIP SHA-256
`9e91b69130c26f2c513c3d6a743243543593a2c9094a149611462a26215ebf8f`.

- `map-controls-settlement.json`: the first desktop detail-1 to detail-2
  settlement failed after 60,001 ms with four requests pending. Fixture handlers
  took at most 37 ms. The post-timeout, document-lifetime timing snapshot contains
  56 long tasks totaling 61,069 ms, with repeated roughly 1.2-second tasks.
  That cumulative sum is not an exactly deadline-aligned measurement.
- `map-controls-requests.json`: all 497 requests eventually finished, with zero
  failures. The final retained 128 distinct URLs have median fixture-fulfill to
  browser-response delay of 1,197 ms. This final snapshot is later than failure.
- `map-controls-source-state.json`: the post-failure observation has 86 station
  tiles loaded and ten loading, while all 88 railway tiles are loaded. This is
  continued incomplete work, not proof of a permanently deadlocked pool.
- `map-controls-cpu-profile.json`: collection hit the 2-second diagnostic
  protocol bound. No usable sampled stack identifies the slow work in this run.

These observations support page-thread delay while fixture requests progress.
They do not identify stencil work, provider behavior, the GPU, or a host defect.
The prior isolated painter comparison did not include this actual failed
execution's frame/body timeline and did not establish timeout causation.

## Bounded change

CPU sampling is now opt-in with `ATLAS_CONTROLS_CPU_PROFILE=1`; ordinary controls
acceptance does not start a CDP profiler. Sampling perturbs scheduling, and the
latest failed capture provided no usable stack. The timeout predates that
collector, so removing sampling does not explain or establish a fix for it.
An explicit profiling run still executes the same acceptance checks and cannot
replace their result. The existing sampling and operation bounds are unchanged.

The actual controls script installs the existing baseline frame/mask observer
and page fetch/body observer immediately before its first desktop detail-2
pointer action. It never enables the experimental visibility guard. The new
`map-controls-transition.json` contains:

- Node start/end and returned/threw outcomes for setup, real pointer input,
  detail-state acceptance, cookie checks, and real-idle acceptance
- The independent request snapshot immediately when acceptance ends, before
  any failure diagnostics can allow additional requests to finish
- Page-clock frame start/end, synchronous mask time/count, and fetch/header/
  body boundaries, including explicit unavailable or truncated observations

An idle failure freezes that snapshot in the idle wait's `finally`. A pointer,
detail or cookie failure before idle freezes it synchronously at the start of
the outer error handler, before source-state, geometry or screenshot awaits.
The original error is rethrown. Regression tests execute that actual error and
cleanup path, finish a pending request during mocked diagnostics, and remove
the early freeze as a sensitivity control that reproduces the late-snapshot gap.

Node operations and request `timeOrigin` use Unix milliseconds. Browser frame
and fetch records share document `performance.now()` and `timeOrigin`; the
setup operation brackets the browser arm for alignment. Treat cross-clock
alignment as bounded by that operation, not exact clock synchronization. CDP
profile times remain a separate monotonic microsecond clock.

The observation window is one transition, with a 60-second page timer, at most
128 retained frames, 512 fetch records, 2,048 visible-dispatch entries and 16
operation records. Setup and final page reads each have a 2-second diagnostic
bound. The page timer can run late on a stalled thread; actual timestamps and
stop reason remain visible. An already-started body read may finish after stop;
its timestamp must not be misreported as within acceptance. Late setup cannot
arm a new capture after its bound. Observers are restored after collection.

Wrappers, clock reads and active-window fetch promise continuations can perturb
timing. Outside the capture, the fetch wrapper returns the original promise.
The probe is not a CPU/GPU or MapLibre-worker profiler; mask time includes only
synchronous submission observed inside map frames. Missing evidence stays
inconclusive. No request is repeated, fetched live, consumed twice or altered.

The original 60,000 ms idle deadline, all loaded/tile/motion/backing-size gates,
pointer hit tests, UI cases, cookie assertions, renderer and fixture bytes,
provider concurrency, network guard and failure outcome remain intact.

## Next decision

Inspect one natural fixture-safe controls run on the exact reviewed head. Align
long tasks, frames, fetch/body progress and operation boundaries from that same
run. If frame/mask time overlaps the delayed bodies, it supports a focused
reproduction; if long tasks fall outside frames, investigate that other work.
A pass, unavailable capture or correlation alone does not close the bug. Do not
rerun until green or raise acceptance timeouts. Local Chromium remains unrun
here because the existing environment cannot create its required socket.
