# PR173: third-round overview marker correction

Source: `569957c3e23b0d28f6fe35316a815c646edd9cfd`, tree `475b514b01bb7acea579a16c8b2525440a66f6b1`.

## Current-main integration

The source tree exactly matches the tested local commit `a5ab40e855d1108737039e2d74b5b0c7c6a5cff0`. Remote parent is `82a1de8174e9cbe5768e941a0a4c0e091bf66825`, whose parent `9f4d256a5fde7c48e56d8957f613f0584e9b8618` has both original PR head `05c9f22eead75ed2c7e21efc4a29bce9ee8ca3f4` and accepted main `caf03eb96f7cb32859c4e522179fbd8abac4f989` as parents. Main ancestry and tree equality were checked after remote fetch. Current-main PR177 work is retained.

## Latest finding

[Duplicate provider/curated circle markers](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4239610203) are deduplicated only by exact vetted OSM identities and aliases in the actually emitted curated geometry. Provider group suffixes are normalized. Labels remain independently eligible. Unrelated identities with the same name/Wikidata, numeric-prefix lookalikes, and candidates omitted from curated geometry remain visible. The provider circle takes over at z7, with z6→7→6→7 exercised by real MapLibre.

## Validation

- Normal parallel Node24.19.0 full suite: 1,044 passed, zero failed/skipped (94.7 s).
- Focused station/map/style/source contracts: 73 passed.
- Build, generated-style reproducibility, syntax and whitespace checks passed.
- Controlled real-renderer fixture passed z3/4/5/6/7/6/7/8/12, including offset coordinates for the same identity, nearby collision-suppressed labels, all independent non-curated circles, and both backbone layers at z4–6. No public provider traffic was allowed.
- Baseline negative control failed on the intended duplicate-circle assertion against the prior generated style. Its raw log is retained.
- One initial focused test incorrectly expected the medium-source large-name layer at z6, despite its pre-existing small-only filter. The final regression correctly checks the existing low-source large-name layer at z6. This harness failure and its corrected passing run are both retained.
- Only two explicitly identified layer hashes were updated in the composition baseline; the rest of the composition guard remains unchanged.

## Prior findings retained on this source

1. [Backbone source contract](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4236120636): both source layers declared and build/source-contract tests pass.
2. [Provider fixture](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4236120640): metadata/tiles fixture-only; first-party assets retain actual served bytes.
3. [Dots before names](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4236120642): anonymous dots publish before provider names/rare-Han waits.
4. [Selected deferred hub names](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4239547535): only selected/otherwise-required requests, tile promise reuse, closed/replaced/language-race guards and name-sensitive departure cache.
5. [Dots without metadata](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4239578246): local geometry publishes without TileJSON/name adapter; selected name recovery after metadata arrival.
6. [Provider disclosure](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4239578249): in-app Re:Earth/Natural Earth source, licence and automatic request disclosure, with a DOM regression.

The first- and second-round evidence remain in the parent evidence directories, including all failed parallel timing runs, isolated controls and the serial diagnostic. The fresh full normal run above does not erase them. Round1 CI38094909997 and round2 CI38095725994 both finished green on their exact source heads.

## Acceptance status when archived

Final-head normal CI38100263380 and fresh Code review comment6103992484 are pending. No merge or deployment is claimed here. Parent coordinates acceptance and deployed-asset verification. Complete worldwide station points remain issue175; curated/regional overview coverage is not a worldwide completeness claim. No regional/IVS font guarantee or authentic Soviet fifth-backdrop delivery is claimed.

The archive is split into parts of at most 50,000 bytes for transport. Concatenate verification.zip.part-* in lexical order, verify the SHA-256 in manifest.json, then unzip. The application source remains its normal generated JSON file; only this evidence archive is split.
