# Missing terrain samples in elevation profiles

Related: #136 (terrain), #112 (availability), #106 (feature audit).

## Confirmed failure

On main `b194d78cd32496489ebfa94ee774620a33f27617`, a failed terrain
tile becomes a `null` height in `createElevation`. The drawn-line profile
then removes unknown samples before making one SVG line and filled polygon.
This joins observations across the missing terrain. Its steepest-gradient
loop also checks only the two endpoints, so a missing intermediate height
does not invalidate the interval.

Executing the actual profile renderer with heights `[0, null, 100]` at
distances `[0, 0.05, 0.1]` km produces one continuous line and fill and a
100% steepest gradient. There is no observed continuous stretch; the former
ascent/descent values are both zero. This is a synthetic failure-path
reproduction, not a claim that a particular public tile currently fails.

## Correction contract

- Partition samples into contiguous observed stretches for both the SVG and
  summary. No stroke, fill or steepest-gradient interval crosses a missing
  sample. An isolated known height remains a visible point.
- Compute ascent and descent only within those stretches. Without any
  connected observations, report unavailable. A genuinely flat observed
  interval still reports zero.
- Keep the existing minimum gradient interval, bounded by the full line's
  length. If no known stretch can establish that interval, report unavailable
  rather than zero. Lowest/highest remain the extrema of available samples.
- Mark a partial profile incomplete and explain the scope of its summary.
  Pointer readout uses the nearest original sample, so a gap reports an
  unavailable height instead of snapping to a distant known elevation.
- Retain the explicitly labelled endpoint difference when both ends are
  known; it does not assert the terrain between them. All-failed responses
  retain the existing unavailable message. Zero-length lines have finite SVG
  positions and no asserted gradient.

The profile regression executes the production controller and SVG renderer
with DOM nodes. It covers internal and edge gaps, isolated observations,
metric/imperial units, flat profiles, all-failed responses, real elevation
loader rejection/retry with synthetic tile bytes, repeated requests, newer
profiles, dismissal and replacement by other details. The cache-version
test includes the immediately preceding search-row-isolation release.

This does not change terrain providers, acquisition, interpolation, repair,
request concurrency or source coverage. The complete #136/#112 audits remain
open. Browser-rendering validation and release gates are recorded separately
in the PR receipt; passing DOM assertions alone is not a browser-rendering
pass. Raw runs and reproduction evidence belong on the separate evidence
branch, not the application branch.
