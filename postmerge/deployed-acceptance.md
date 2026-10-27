# Deployed and verified

The dirty-history fix is deployed at https://c933103.github.io/openrailwaystyle/.
Actual merge `c53f80dc1043f39a2666fc0f3f77b04cbe87d889` has tree
`915749402711b586bd95723a1f76ea544f67d757`, identical to the reviewed/PR-tested tree.

The original merge-push [site run 40462211289](https://github.com/c933103/openrailwaystyle/actions/runs/40462211289)
completed successfully. It passed 2,744/2,744 unit tests with zero
failures/skips/cancellations, all six fixture-browser groups and their aggregate.
[Deploy job 122112899926](https://github.com/c933103/openrailwaystyle/actions/runs/40462211289/job/122112899926)
also passed live vector-byte verification, published independent-OSM geometry
checks and the published-map local railway fixture. Existing browser oracles
and timeouts were not weakened.

Read-only live HTTP verification at 09:37:55 UTC matched all 13 app/module/index/
SW/CSS files byte-for-byte to the merge commit. The served bundle embeds that
exact source commit/link and release `20261027-clean-history-3d-3`.
See `live-source.json` and its reproducible `verify-live-source.py`.
No local browser or public map-provider requests were used for this source check.

Reference attempt 1 timed out in the isolated Safari-profile portion; its
original evidence remains in this folder and the exact stall cause is still
unknown. A single targeted retry passed all 840 isolated-renderer samples and
actual-app acceptance. It reused the pinned generation without reacquiring
provider data. The original site subsequently passed and deployed normally.

The existing reference workflow also queued a redundant same-head site run
40473786023, which was validating at 09:41 UTC. It is monitored separately for
regressions, not a missing gate for the completed, verified original deployment.

The earlier local aggregate remains incomplete (146 observed passes, clean
interruption exit 130); no full local aggregate or native local browser pass is
claimed. Earlier source revisions retain historical rather than current-head
acceptance. Source/race limits and all negative-control evidence remain intact.
