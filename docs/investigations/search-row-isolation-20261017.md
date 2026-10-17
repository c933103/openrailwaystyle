# Search response row isolation

Related open requirements: #130 search, #112 availability, #138 provider failures,
within the #105/#106 scope. This is a bounded correction, not worldwide search or
source-coverage acceptance.

## Reproduction and cause

Base `6aa700ac4ed39647c5026a4bad96e46d63e4e1a6` accepts an HTTP-success array without
validating its individual rows. A null facility throws when reading longitude;
a null geocoder row throws when reading namedetails. In the actual search
submission/rendering block, either error replaces healthy results from both
sources with “Search is unavailable.” Separately, `Number(null)` and `Number('')`
convert missing geocoder coordinates into a false location at zero.

These are controlled synthetic-response reproductions. They are not evidence of
a current live provider outage, malformed real response, or geographic omission.
The initial regression run reproduced 26 failing checks, with 20 controls passing.

## Correction and boundaries

- Validate remote rows before reconciliation and caching. Keep valid siblings and
  carry each source's invalid-row count to the incomplete-search status.
- Require finite numeric facility coordinates. Accept finite decimal-string or
  numeric geocoder coordinates in latitude ±90 and longitude ±180. Null, blank,
  booleans, arrays and nondecimal coercions do not become map locations.
- Check geocoder fields consumed as strings or objects. Unknown categories remain
  ordinary places rather than indexing inherited object members.
- Invalid optional bounding boxes fall back to a valid point. Drawn local stations
  retain valid world-copy longitudes; remote coordinate validation does not remove
  this existing map behavior.
- Do not cache partial-invalid geocoder responses. Recovery happens only on a
  later explicit submission, under the existing one-request-per-second limit.
- Preserve valid-row identity, names/localization, source classification, ordinary
  cache hits, facility cooldown, timeouts and stale-query cancellation. Update the
  help, user guide and coherent installed-app release token.

No provider acquisitions, public tile downloads, performance benchmarks, data
refreshes, deployment/domain actions or source-policy changes are part of this
correction. PR157 and PR185 remain held. Broader parent and child issues stay open.

## Acceptance

The compact automated regressions cover malformed rows in each source, healthy
siblings, missing and boundary coordinates, valid zero, decimal strings, unknown
categories, optional bounds, drawn fallback/world copies, incomplete versus
unavailable status, explicit recovery, cached healthy responses, stale queries,
selection/dismissal and same-generation service-worker release isolation.

Build/style equality and syntax/diff checks are required alongside the focused and
aggregate tests. Fixture-only browser execution was attempted with installed
Chromium, but the runtime denied its local process socket (`Operation not
permitted`), including the supported escalation path. This is an execution limit;
real-browser and hosted CI acceptance remain review gates.

The pull request's immutable evidence receipt records exact source, final counts,
commands, retained failed attempts and a separate evidence-branch archive. Bulky
logs are intentionally excluded from the application branch.
