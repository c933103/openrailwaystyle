# Energy relationship evidence follow-up

This builder refinement uses the existing energy extract filter unchanged.
A present railway loading rack intersecting a mapped site's actual polygon establishes
recorded servicing evidence; a rack merely nearby, or inside a polygon hole,
does not. Existing 35 m track adjacency remains separately labelled with its
connection unverified. Civil plants default to zoom 9; rail-served plants appear
at zoom 6. A major-plant capacity threshold remains unspecified, so capacity
alone currently does not promote a civil plant.

Circuit evidence requires a shared OSM node with an explicitly traction-tagged
facility and matching voltage/frequency pairs, or an explicitly traction-tagged
line. Continuation requires a shared endpoint and the same electrical pair.
Semicolon pairs remain aligned; a scalar can apply across a multivalue list.
Missing or ambiguous values establish no matching pair. Parallel circuits sharing
only interior tower nodes and inactive facilities do not establish connectivity.
Only present circuits are traced; lifecycle networks retain their own tags.
This is mapped topology evidence, not a promise of usable or dedicated supply.
Mapped 16.6/16.7/25 Hz lines and explicitly traction-tagged lines appear from zoom 5.
Inferred connectivity retains separate circuit properties; it does not promote
a civil line's style or zoom level. Empty multivalue slots invalidate pairing.

Tests exercise mismatched pairs, missing values, shared endpoints, interior
crossings, inactive seeds, actual rack intersection, holes and visibility.
World data, memory limits and viewport bytes remain downstream rollout gates.
