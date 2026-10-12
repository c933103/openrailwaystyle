# Postmerge served-search checker review

Reviewed 2026-10-12 UTC. Checker SHA-256:
`44d56599c517be98737fed5d92ed4ad1bddb7ca9056fb8b7f9b69828be8fc704`.

## Disposition

No blocking finding in the final checker for its stated bounded use after deployment.

- Eleven application assets are fetched from the fixed first-party Pages origin with redirects rejected and compared as raw buffers against the supplied accepted source before behavioral replay.
- The additional `tile-labels.js` request uses the exact application version query. Its raw response bytes must equal a bundle rebuilt from the copied accepted source with the exact merge commit, repository and server metadata.
- Metadata evaluation was replaced with exact accepted-build byte comparison. The report labels this `matchesAcceptedBuild` and records expected build metadata; it does not claim to inspect a runtime export.
- Reported hashes and lengths use original response buffers.
- Output must be newly created, preventing stale success reports or pre-existing dependency links from being reused.
- The selected 57 focused and three full-app tests use synthetic provider responses and DOM/VM/cache fixtures. They do not perform live searches, launch a browser or demonstrate interception by a real client service worker.

## Preconditions and execution limits

The supplied source root must independently be verified as the accepted merge source, with the documented pinned dependencies installed. The checker compares against that root; it does not itself establish the root's Git provenance. Use a new output location outside the copied source directories. A failed attempt requires a different new output directory.

The accepted merge is `b5a73c3aa03498259c2fd531b9644d52ae94db69`; the expected asset version is `20261012-search-availability-1`. Exact bundle comparison also requires the local build dependencies to reproduce the deployment build.

This final review read the checker and relevant build/test code and passed `node --check`. It did not run the checker against the deployed site, make live requests, install packages, launch a browser or modify production source. A successful checker run would establish the fetched-byte comparisons and synthetic behavioral results at its recorded observation time. It would not establish live-provider coverage, visual rendering, real-client caching or universal propagation to all clients.
