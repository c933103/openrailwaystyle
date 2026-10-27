# Latest requested view during cold startup

Source `5818dda595a4a6ff64480fa04ac7d4000bced808`, tree
`915749402711b586bd95723a1f76ea544f67d757`, parent
`807b1e09d34f6649e048020130fd5c8989847e92`.

Addresses the reviewed cold-navigation P2. The app remembers the latest valid
fragment before normalization and throughout library/label loading. Cold Copy map
link, initialization and late style readiness use that view, not an older startup
snapshot. Routine movement still does not rewrite history.

All six new cases fail on the parent and pass on this source: loading libraries
or labels, initial/no initial link, immediate sharing before queued hashchange,
invalid/empty fragments and later explicit navigation. The harness only adds
recording of existing jumpTo and once calls; original semantics/assertions stay.

Final focused checks: 19/19 startup tests and 86/86 SW/terrain/globe tests pass,
with zero skips/cancellations. Build, generated-style equality, syntax and
whitespace pass. All 41 references use `20261027-clean-history-3d-3`, shell 54.
Legend-state fixes, visible terrain behavior and browser timing/oracles remain.

Fresh exact-head Code review completed with no findings. All three hosted
workflows succeeded: site 40459480652, reference 40459480641 and painter
40459480553. The tested merge 25ab3d85c807a36550cd3ac61075903a134ff5f1 has
exactly the source tree above. Hosted validation passed 2,744/2,744 unit tests
and 4/4 search tests, zero failures/skips/cancellations. All six fixture-browser
groups and their aggregate passed, including unchanged service-status and
visible-terrain pixel oracles. See `hosted-acceptance.json` and the two log
excerpts for job identities and results. PR deployment was skipped as expected.

Earlier-head outcomes remain historical; no new full local aggregate or native-
browser pass is claimed. This receipt does not claim production deployment.
Commands/source hashes are in `manifest.json`. Logs redact only the local
checkout path to `<checkout>`.
