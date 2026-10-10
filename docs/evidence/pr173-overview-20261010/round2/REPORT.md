# PR173 second review round: provider-independent dots and source disclosure

Source commit [`82a1de8174e9cbe5768e941a0a4c0e091bf66825`](https://github.com/c933103/openrailwaystyle/commit/82a1de8174e9cbe5768e941a0a4c0e091bf66825), tree `41ecb1b92e327b9e8db3dbdaa4882d124fb57b83`, parent `9f4d256a5fde7c48e56d8957f613f0584e9b8618`. The accepted-main ancestry and first-round evidence are preserved. Remote and local source trees match.

## Corrections

1. Review P1 [`4239578246`](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4239578246): local curated dots now publish before the name adapter or station tile template is required. Missing metadata and missing adapter have separate regressions. The already-open selected dot resumes its bounded name lookup when metadata arrives. No eager name requests for all below-tier dots were added.
2. Review P2 [`4239578249`](https://github.com/c933103/openrailwaystyle/pull/173#discussion_r4239578249): Sources/Licences identify the generalized Natural Earth backbone hosted by Re:Earth Papers, automatic TileJSON and zoom-4–6 viewport tile requests, the host and ordinary request information, and data/source links. A DOM regression requires this disclosure. The data rights and hosting conditions remain distinct.

Official references checked: [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) confirm public-domain vector/raster data; the [official Re:Earth Papers README](https://github.com/reearth/reearth-papers) lists `naturalearth_transport`, the endpoint scheme and [provider attribution](https://papers.reearth.land/attribution). The README was readable; direct provider-page retrieval was unavailable in the research tool. No separate hosted-service policy, retention promise or uptime guarantee is claimed. This is a source/disclosure correction, not a legal certification.

## Validation and all observed outcomes

- Build, generated-file reproducibility, syntax and diff checks pass. The generated map style is unchanged in this follow-up.
- Complete startup/disclosure focused run: **68 passed**. New missing-metadata, missing-adapter and disclosure regressions all fail against `9f4d256` before the correction (`round2-baseline-red.log`), then pass with it. The metadata-recovery test also verifies that only the selected deferred dot starts a lookup.
- Real MapLibre seven-zoom marker/backbone check passes again; the prior samples remain in the first-round archive.
- First normal parallel Node24 full run: **1,041/1,042 passed**, with the existing train-schedule test observing zero loader calls after its 20 ms settling wait (`round2-full-tests.log`).
- Second normal parallel Node24 full run: **1,041/1,042 passed**, with the existing globe-drag 500 ms budget measuring 522.3 ms (`round2-full-recheck.log`). This time the train-schedule test passed.
- Isolated unchanged controls: all **9 train-schedule tests passed** and the **globe-drag test passed**. File/blob comparisons prove both test files and their directly exercised UI/globe modules were unchanged (`round2-unchanged-controls.json`). A definitive cause for the two full-run timing failures is not established.
- Full Node22.22.2 diagnostic with one test file at a time: **1,042 passed, zero failures/skips/cancellations**, 197.9 seconds (`round2-node22-serial-tests.log`). Every original assertion and threshold was retained. This different local scheduling mode is a diagnostic, not a substitute for normal hosted CI.

## Hosted acceptance gates

First-round head `9f4d256` completed normal [CI38094909997](https://github.com/c933103/openrailwaystyle/actions/runs/38094909997) successfully. Its hosted merge tree was exactly `a177afcb01765de1a479bd708e86744936b571d8`; run, jobs and merge metadata are archived. Its Code review led to the two corrections above, while its Security review was clean. Those old results do not accept the follow-up source.

Follow-up head `82a1de8` has fresh [Code request6103390388](https://github.com/c933103/openrailwaystyle/pull/173#issuecomment-6103390388), [Security request6103391270](https://github.com/c933103/openrailwaystyle/pull/173#issuecomment-6103391270) and normal [exact-head CI38095725994](https://github.com/c933103/openrailwaystyle/actions/runs/38095725994), pending at publication. The PR thread owns later acceptance results. No merge or deployed verification is claimed here. Complete worldwide station points remain issue175; automated checks use controlled fixtures rather than public ORM tile benchmarking.
