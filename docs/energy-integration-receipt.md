# Energy cartography and data alignment

This integration combines cartography/click-selection `e7f93ed`, data-first
`b39b59b` and reviewed circuit/rack refinement `500f1bd`. It retains the final
regional and gap selection fingerprints and performs no extraction or publication.
The data-first PR remains independently deployable before this client change.

The builder, validator and measurement code use the canonical tier contract in
`scripts/energy-network-schema.mjs`. Style generation imports that contract
directly. The browser build copies it into the deployed shell; a byte-equality
regression prevents its browser copy drifting. The schema is precached with
shell 75 and the `20261116-energy-aligned-1` asset graph.

The real generated-bundle/client protocol round-trip is retained. Coal conveyors
have a named line style and are covered by the actual map-click regression.
The inspector distinguishes circuit connectivity from explicit traction evidence.
No inferred civil-grid connection changes its traction classification.

Local integration checks: Node 24.22.1, build passed; 259 focused energy, Power,
startup, resource, service-worker and CI-plan tests passed with no skips or
failures. The generated 377-layer style passes MapLibre validation. Hosted
fixture-browser verification remains required on the published integration head.
The complete real-world snapshot, viewport budgets and publication gates remain
as documented in the data-first receipt.

The successor incorporates reviewed site-member geometry, frequency converters
and canonical locomotive hydrogen offerings without changing extract selection.
Its additive coal-conveyor layers are explicitly registered in the composition
contract and separately checked for brown dotted paint and actual click selection.
The prior aggregate exposed that missing registration (one failure); baseline
source/layer digests remain unchanged. After correction, all 101 focused
composition, energy and startup-detail tests pass. Final full-suite evidence is
recorded against the published successor rather than attributed to its predecessor.
