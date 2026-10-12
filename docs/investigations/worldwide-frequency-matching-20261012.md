# Worldwide timetable-to-OSM frequency audit — 12 October 2026

Status: **partial matching, incomplete coverage**. Issues: [#111](https://github.com/c933103/openrailwaystyle/issues/111) and [#112](https://github.com/c933103/openrailwaystyle/issues/112). This is an observation record, **not** a declaration that these issues are fixed.

## Provenance and meaning of the counts

- [Worldwide frequency workflow #38231733616](https://github.com/c933103/openrailwaystyle/actions/runs/38231733616), input commit `50b8063813909067343fd3b1eb778104aa32f324`, all eight compilation shards, assembly and publication successful.
- [Data release](https://github.com/c933103/openrailwaystyle/releases/tag/service-frequency-data) updated 2026-10-12 11:53 UTC.
- Audit input: the **worldwide-frequency-snapshot** artifact (ID `11744801485`) from the same run, using its `manifest.json`, `inventory.json` and digest-verified `profiles.json.gz`. All rate/expiry counts refer to that immutable run, not to an arbitrarily newer release.
- Follow-up [site run #38245521829](https://github.com/c933103/openrailwaystyle/actions/runs/38245521829) succeeded, including OSM tile rebuild and deployment. Its browser frequency checks use local fixtures, not a live Tokyo-to-OSM assertion.

| Unit | Count | What it establishes |
| --- | ---: | --- |
| Catalogue entries | 5,489 | Registry entries scanned |
| Successfully compiled timetable feeds | 363 | Parsed timetable source availability, **not OSM matches** |
| Feeds with GTFS mapped railway paths | 303 | Acquired path geometry, **not OSM matches** |
| Feeds with at least one OSM identity candidate accepted by the existing matching pipeline | 54 | Candidate-level identity and path coverage, not necessarily current rates |
| Feeds supplying current, usable OSM section rates | 38 | Applied aggregate frequency evidence |
| Section rows in published profile aggregate | 6,951 | Includes unavailable/empty profiles |
| Rows with nonempty, unexpired timetable profiles | **4,887** | Current usable OSM section memberships in published aggregate |
| Distinct OSM ways carrying those profiles | **2,327** | Unique OSM way IDs; not routes or train trips |
| Distinct OSM route relation IDs carrying those profiles | **76** | Distinct relation identities; not feed routes or stop patterns |
| Conflicting section observations withheld | 3,291 | Unresolved conflicting sources/route overlaps; **not** an assertion that no train runs |
| Section rows lacking usable profiles | 2,064 | Unavailable rate evidence, **not** zero trains |

Count each service/way/section separately; do not substitute `mappedFeeds` or `matching.mappedRoutes` for `matching.appliedWays`. Existence of rates in a published aggregate is *not* proof that every binding remained current at final site assembly, or that every route identity has independently reviewed station evidence.

### Geographically varied usable section records

Country membership is attributed through contributing feed IDs. These are *section rows*, not number of route services or unique trains.

| Feed country | Usable section rows | Distinct OSM ways in this country group |
| --- | ---: | ---: |
| France | 1,525 | 859 |
| United States | 1,311 | 578 |
| Germany | 649 | 338 |
| Estonia | 489 | 116 |
| Portugal | 286 | 133 |
| Italy | 157 | 67 |
| Spain | 143 | 73 |
| Canada | 124 | 64 |
| Latvia | 96 | 55 |
| Japan | 91 | 28 |
| Luxembourg | 16 | 16 |
| **Total across these groups** | **4,887** | **2,327** |

This does **not** establish complete coverage within any of these countries. Coverage outside the eleven listed countries is not necessarily absent railway service; it may be a missing OSM service snapshot, unmatched identity, an incomplete archive, or unavailable timetable data.

## Japan and Ōji regression

- `jp_tokyo-rail` was **compiled**: **127** GTFS routes and **34,519** mapped timetable path segments.
- It yielded **0** candidate OSM service routes accepted by the current production matcher and consequently **0** applied timetable section rates.
- The reported Ōji contradiction therefore persists in the published snapshot: departure-board observations do not independently establish an OSM Service-view frequency association.
- Kumamoto City Tram was the sole usable Japanese contributing feed in this snapshot: **2 OSM route relations, 28 OSM ways, 91 section records**.
- The `service-data` branch's `state.json` records Japan's service acquisition stage completed on **2026-10-01**, with **309** route records. It is **not established** that the Tokyo failure is simply an unattempted Japan acquisition.
- No operator/ref/GTFS-route-ID/station crosswalk mismatch is yet individually proven for Ōji. It would be incorrect to attribute all 127 route failures to one particular operator alias without per-route evidence.

The production matcher (`scripts/timetable-frequency.mjs`) uses feed-scoped route IDs or operator and ref/name with **complete spatial-path coverage**. It does *not* currently apply the reviewed per-stop identity crosswalk from the separate `scripts/timetable-matching.mjs` contract during worldwide assembly. Thus even a geometrically plausible route selection does not establish the full served-stop identity requirement of #111; do not relax these checks to increase counts.

## Unresolved worldwide coverage

The acquired `service-data/state.json` still shows `europe-g` unfinished (download byte budget), and `americas` and `world` without completed stage records as inspected on 2026-10-12. The newer India, Asia and North America stages are present but have explicitly incomplete member-eligibility evidence (19, 42 and 27 affected relations respectively). Coverage cannot be inferred from one successful nationwide feed or branch snapshot.

## PR #199: instrumentation and counter correction

The previous site rebuild set `matching.appliedWays = bound.sections.size`. This included OSM ways whose valid bindings carried **only empty/expired rate profiles**, which overstated usable coverage.

The proposed correction distinguishes:

- `boundWays` / `boundSections`: evidence that passed the current OSM binding checks, including missing profile rates.
- `appliedWays` / `appliedSections`: current bound OSM records containing at least one *finite, nonnegative rate* in a supported period. A verified **zero** is included; unavailable or expired records are excluded.
- `appliedRelations`: distinct route-relation IDs with such records.
- `staleSections`: bindings withheld when OSM geometry, identity or memberships changed.
- `matchingReasons` and bounded `unmatchedExamples` per GTFS feed, separating missing path data, path below spatial threshold, no identity candidate, failed path corroboration and multiple path-corroborated OSM candidates.

The site build logs `[frequency-matching]` with these **post-binding** values. The log must be read on an actual build using the published OSM/timetable data; local browser fixtures cannot substitute for it.

## #111 acceptance work still required

Verify actual GTFS route IDs, agencies/operators, route refs, directions and served-stop sequences against OSM service relation IDs, OSM station identities and complete eligible way membership. Classify unmatched Tokyo routes individually from the new evidence; repeat with geographically diverse positives and negatives. Resolve genuinely duplicated feeds using source/trip identity rather than matching equal frequency counts. Test partial workings, opposing directions, splits/merges, DST, overnight service days and stale OSM bindings. **Never add GTFS geometry or assign frequencies where service identity remains unresolved.** Connect the resulting truthful reasons to route-level UI messaging through #112.

Reproduce the *published-aggregate* audit by downloading the 2026-10-12 snapshot artifact, verifying `manifest.applied_profiles.sha256` against the compressed profile bytes, validating `profiles.json.gz`, selecting records with an unexpired rate in one of `FREQUENCY_PROFILES`, then counting unique `section.way` and `section.relation` values. Reproduce *deployed applied* counts from the corresponding site build's `[frequency-matching]` log or the published `data/service-routes/frequency-manifest.json` after the correction is deployed. These two measurements must be compared, not conflated.
