# Energy acquisition and candidate builder

This increment separates extract selection and energy candidate construction from
Power-mode presentation. Its base is main `d23c3b2667f2450ea5c87cedbc06f280833016d6`.
It changes no application, style, service worker or deployed dataset branch.
Canonical energy tile tiers live in `scripts/energy-network-schema.mjs` so the
builder can run before its optional client is integrated.

The expanded filter includes lifecycle variants of energy infrastructure,
petroleum wells, coal conveyors, gasometers and water tanks. Descriptors stay
explicit: petroleum wells are fuel infrastructure without an inferred fuel type;
coal conveyors require a coal-family resource; pumps with an unspecified fluid
retain an unknown domain. Raw fuel tags remain available in feature properties.
Tag references: [petroleum wells](https://wiki.openstreetmap.org/wiki/Tag:man_made=petroleum_well),
[goods conveyors](https://wiki.openstreetmap.org/wiki/Tag:man_made=goods_conveyor),
[legacy water tanks](https://wiki.openstreetmap.org/wiki/Tag:man_made=water_tank).

## Refresh sequence and evidence

1. Merge the reviewed filter/builder increment with required CI passing.
2. Dispatch `osm-extract.yml` on main with `gaps_only=false`; leave source date
   unset to use its existing two-day offset. Acquisition retains its existing
   provider, size, request, retry and time limits.
3. Inspect the published index and resume incomplete gap acquisition as needed.
   Assembly requires all entries at the current filter, with no missing regions
   or unresolved geometry references. An older successful index is insufficient.
4. Dispatch `osm-assemble.yml`. The energy builder validates its complete source,
   creates candidates atomically, and refuses oversized bundles. Its optional
   artifact lasts seven days; an energy failure remains visible and other
   independent dataset builders continue. This workflow does not publish an
   energy branch or switch site sources.
5. Validate the actual complete candidate, measure viewport bytes and rendering,
   then publish and integrate the optional client through separate review.

The inspected index from extract run 43841041228 contains 175 inputs: 147 regions
and 28 gap tiles. All require the new filter identity. That run was gaps-only:
09:35:01–12:23:23 UTC on 2026-11-16; its acquisition step lasted 2 h 45 min 1 s.
It is not a measured duration for the full regional refresh. Assembly run
43817960271 lasted 16 min 59 s before the energy builder existed. Neither run
establishes a duration for the new complete pipeline.

Current filter identities:

- Region: `7e451e59edde52cbe7cd5fb40e747dfa6e271a35d0c364922271d588c2028af9`
- Gap: `overpass:958d2e4e6150ae21ec52dc46f79b2f25bed0db9f15ee588f4924bda77c3c74c6`

The per-bundle 350 KB cap is not the viewport budget. The candidate measurement
reports a conservative north-up, flat-view bound; rotated, pitched and globe
views still need actual measurements. A complete world candidate has not yet
been built. Circuit matching and additional shared-loading-rack evidence are
subsequent builder refinements using the same broad selected tag families.

## Local verification

Node 24.22.1: `npm run build` passed with unchanged tracked generated style
outputs. The focused extract, assembly, energy, CI-plan and gap suite passed
142 tests, with 17 explicit skips because local osmium is unavailable; no failures.
The final classifier regression suite passed all 13 tests after the descriptor
cleanup. The full aggregate runs separately on the frozen commit with pinned
Python tzdata; its final result is recorded in the PR rather than anticipated here.
