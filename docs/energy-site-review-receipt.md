# Energy site and frequency-converter review correction

Addresses PR #468 review threads r4587702876 and r4587702890. A later clean
review summary does not supersede these concrete earlier findings.

Power-site relations use their recursively resolved actual members, including
positioned nodes and nested relations. They produce a geometry collection,
without inventing an enclosing polygon or a rail-served site boundary. The
subset uses the existing osmium getid add-referenced path; this performs no
additional network acquisition. Missing members, invalid member geometry and
cyclic memberships remain explicit failures. The shared facility shaper remains
unchanged for its other consumers.

The energy classifier includes power=frequency_converter and its lifecycle
variants at zoom 8. Circuit evidence also accepts explicitly traction-tagged
frequency converters, subject to the same current-state and electrical-pair
requirements. Extract filters and their identities are unchanged.

Regression coverage includes direct nodes, nested node sites, vector-tile
encoding, missing/cyclic references, lifecycle converters and successful complete
candidate construction from a node-only nested site. This correction is separate
from browser cartography and can land before the data refresh finishes.

Review r4588127277 additionally identified historical/planned tracks incorrectly
establishing current rail-served evidence. The relationship index now requires
an explicit current railway type and excludes lifecycle yes flags. Proposed,
construction, removed, razed, demolished, abandoned and disused cases are covered;
a current mapped siding still establishes intersection evidence. Extraction
selection and historical energy-feature visibility are unchanged.

Review r4588203396 extends the explicit non-area rule to standalone features.
The shared line/non-area predicate now honors area=no before either geometry
conversion or site relationship indexing. Closed plant/refinery ways keep their
line geometry, and a track inside their ring establishes no area intersection.
Present and lifecycle-tagged non-area features have regression coverage.

The same geometry audit found antimeridian track edges falsely intersecting
Greenwich sites under planar geometry. Relationship checks now split ordinary
runs at longitude discontinuities and exclude the ambiguous crossing edge.
Nearby sites in its dateline longitude band retain an explicit unverified
relationship; ordinary runs can still establish actual mapped intersections.
No dateline path, site footprint or supply connection is fabricated.

Review r4588373038 identified the converse dateline case: ordinary tracks just
across ±180° were omitted by spatial bins before metric adjacency could run.
Longitude bins now wrap canonically on insertion and query. The query's longitude
width also uses the actual limiting latitude cosine, capped at a half-world,
rather than under-searching near the poles. The metric relationship calculation
and its 35 m threshold remain unchanged. Ninety-six indexed-versus-direct cases
exercise both directions, same-side and dateline coordinates, latitudes through
89.99°, and 20/34.9/35.1/40 m offsets. Separate cases cover longitude 180,
polygon holes, ambiguous crossing exclusion and ordinary retained runs.
