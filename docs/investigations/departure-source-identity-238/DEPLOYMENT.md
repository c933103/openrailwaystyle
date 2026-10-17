# PR #238 deployment verification

Merged commit: `395f8bc749a555e29b399a4a3cf941692f53517a`.
Reviewed application head: `5b4422cd32e75762e4eedf02bed1a566905e8b06`.

The natural [postmerge site run](https://github.com/c933103/openrailwaystyle/actions/runs/39011496112)
completed successfully. Validation, all six browser groups, the combined gate
and the deployment job passed. The deployment job includes exact published
vector-byte checks and fixture-safe Chromium/WebKit checks of the published
independent reference, plus the synthetic railway rendering check.

A separate first-party HTTP read observed the public site on 2026-10-17 at
07:33–07:34 UTC. The root HTML, app module, departure parser and service worker
were each HTTP 200 and byte-identical to the accepted source. The generated
browser bundle embeds this merge commit, its source URL and asset version
`20261017-source-trip-identity-1`. Their exact URLs, byte sizes and SHA-256
digests are in `published-source.json`.

No external map/timetable provider was requested for these reads. The source
check uses direct first-party reads; it does not claim physical-device or
worldwide data acceptance. Local browser failures remain preserved.

The separate revision-4 frequency refresh finished after this run assembled its
data. Its later site run `39012834349` was still in progress at this observation;
this PR's source deployment does not by itself establish refreshed-data delivery.
