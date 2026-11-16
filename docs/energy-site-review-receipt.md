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
variants at zoom 8. Extract filters and their identities are unchanged.

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
