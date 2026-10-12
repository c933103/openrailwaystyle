# Independent review: search availability wording

Reviewed 2026-10-12 UTC against the isolated candidate for `c933103/openrailwaystyle` issues #130/#112.

## Verdict

No blocking correctness, regression, or test-fidelity finding in the bounded wording correction. The existing source outcomes are preserved. The partial-empty status no longer claims a completed no-match search, usable remote/local rows remain visible, total outage without local matches remains unavailable, and complete-empty wording is unchanged.

One optional documentation precision was raised and resolved during review: `docs/user-guide.md:115` now says responses are reused “while cached in this page session (up to 50 query-and-language combinations).” This accurately reflects the existing 50-key cache. No remaining review finding requires a change.

## Reviewed identity and scope

- Supplied remote main baseline: `dea9f68e9d4c585c29ff225c4c052e689dac849b`.
- Local exact-main snapshot: `b014724e0ca75021807f5f36ccbc3781bc929172`. This is a temporary snapshot, not the original Git history.
- Independently computed Git blob hashes for all 587 baseline files and matched them against the supplied `base-tree.json` manifest, with zero differences. See `independent-base-verification.json`. This review did not independently fetch the remote manifest.
- `initial-reviewed-files.sha256` freezes the 13 changed/new source, documentation, fixture and test files at review start. The only subsequent change was the reviewed documentation precision above, recorded in `docs-amendment-hash-check.log`. `reviewed-files.sha256` is the final reviewed manifest; all 13 files match. The source, fixture and tests are byte-identical to the independently tested candidate. Candidate `styles/app.mjs` SHA-256: `4c39ad3d8f0dc2bad265e2a51bb5f9e0e6a54b1566f550d6c36856495614e3dd`.
- The predecessor fixture's uncompressed application text exactly matches the baseline Git blob. Its SHA-256 is `6858cbe795e0e21c563224727c4ca5fff817a7983fdedec22e9d25559bb43837`.
- Outside cache-token updates, the only application logic change is the final status composition at `styles/app.mjs:2071-2076`. The request/cache, cancellation, reconciliation, local-fallback and row-selection code is unchanged.
- `styles/sw.js` is byte-identical to the predecessor. Its SHA-256 is `bae6f897ca776163b097b00e6210ff35932aa073b19ad49b0788d2066e8a910c`. Testing predecessor/current asset bytes with the same service-worker code is therefore appropriate.

## Independently executed checks

Runtime: Node.js v24.19.0, using the existing installed dependencies. No package install or external provider request was performed.

| Check | Command | Result | Evidence |
| --- | --- | --- | --- |
| Candidate focused | `node --experimental-vm-modules --test tests/search-availability.test.mjs tests/startup.test.mjs tests/sw-install.test.mjs` | 114 passed, 0 failed/skipped/cancelled | `candidate-focused.log`, `.exit` |
| Predecessor search behavior | `node --experimental-vm-modules --test tests/search-availability.test.mjs` | 3 passed, 14 failed, total 17; exit 1 expected | `predecessor-search.log`, `.exit` |
| Predecessor full-app DOM regression | `node --experimental-vm-modules --test --test-name-pattern='full app search distinguishes' tests/startup.test.mjs` | 1 failed; exit 1 expected | `predecessor-full-app.log`, `.exit` |
| Predecessor cache-token regression | `node --experimental-vm-modules --test --test-name-pattern='search availability wording refreshes' tests/sw-install.test.mjs` | 1 failed; exit 1 expected | `predecessor-sw.log`, `.exit` |
| Independent outcome matrix | `node independent-matrix.mjs --candidate-root <candidate-root> --predecessor-root <predecessor-root>` | 8 predecessor and 8 candidate observations, assertions passed; exit 0 | `independent-matrix.mjs`, `.json`, `.log`, `.exit` |
| Whitespace | `git diff --check` | exit 0 | `diff-check.log`, `.exit` |
| Frozen file identity | `sha256sum -c ../review/reviewed-files.sha256` | 13/13 matched, exit 0 | `final-hash-check.log`, `.exit` |

The predecessor tree was made with `git archive HEAD` from the exact-main snapshot. Only the new candidate tests/helper/fixture were copied into that tree; production source remained the predecessor. Dependencies were linked to the candidate's existing installation. The isolated reproduction tree is temporary review workspace, not a deliverable that needs publication.

### Reproducing the independent matrix

The matrix takes explicit candidate and predecessor repository roots; it does not depend on its own publication directory or the current working directory. Both roots need the tested helper under `tests/helpers/search-ui-harness.mjs` and access to the documented dependencies. It writes `independent-matrix.json` beside the script and prints the same observations to standard output.

From a checkout of this candidate, with dependencies installed and the original baseline commit available locally:

```sh
candidate_root="$(pwd)"
predecessor_root="$(mktemp -d)"
git archive dea9f68e9d4c585c29ff225c4c052e689dac849b | tar -x -C "$predecessor_root"
mkdir -p "$predecessor_root/tests/helpers"
cp "$candidate_root/tests/helpers/search-ui-harness.mjs" "$predecessor_root/tests/helpers/"
ln -s "$candidate_root/node_modules" "$predecessor_root/node_modules"
node "$candidate_root/docs/investigations/search-availability-130/review/independent-matrix.mjs" \
  --candidate-root "$candidate_root" \
  --predecessor-root "$predecessor_root"
```

Copying the helper adds test instrumentation only; the predecessor production files remain the exact baseline. The CLI-parameterized script was rerun against the reviewed candidate and the original isolated exact-predecessor tree, with the same 16 observations and a successful exit. The 13-file reviewed source/test manifest was unchanged.

The predecessor partial-empty cases emitted the blanket statement followed by `(station search unavailable)` or `(place search unavailable)`. The candidate matrix emits:

- Station failed, healthy place source empty: `No matches from the available sources. Search incomplete: station search unavailable.`
- Place failed, healthy station source empty: `No matches from the available sources. Search incomplete: place search unavailable.`
- Healthy station row with an 8-second place-only timeout: `1 railway result, 0 places. Search incomplete: place search unavailable.` The row remains visible.
- Both failed with a matching drawn station: the local row remains visible and both remote sources are explicitly unavailable.
- Both failed without local matches, and complete-empty: their previous statuses are preserved.

The 14 failing predecessor assertions are regression evidence for this shared status change, not 14 independent product defects. Some lifecycle tests intentionally fail first on the new wording; preservation of request/cache logic is additionally supported by the unchanged production code and passing candidate lifecycle assertions.

## Test fidelity and limits

The focused helper slices and executes the actual application submission/request/cache/rendering block. It supplies JSDOM nodes, production model functions, controlled fetches and a deterministic clock. It does not reimplement the status expression. The helper calls the captured submission handler directly; the full-app startup regression complements this by dispatching an actual DOM submit event through the application wiring.

The new search tests cover both provider identities for HTTP, transport, JSON and non-array-envelope errors; surviving rows; complete-empty and total outage; drawn-station fallback; timeout; the existing ten-minute facility cooldown; successful empty and language-keyed place caching; non-caching of failures; and old/queued request replacement. The extra review matrix covers place-only timeout with a healthy station row.

The exact-byte service-worker test exercises installation/navigation/cache serving with actual predecessor and candidate `app.mjs` bytes. It proves the tested VM cache flow can retain old-version bytes and serve new-version bytes offline. It does not prove a deployed browser has updated or that any live service worker is controlling a particular user session.

These are DOM/VM checks with mocked renderer/dependencies and synthetic provider results. No visual screenshot, real renderer, live-provider coverage, hosted CI, deployment or exact served-asset check was performed by this review. The author separately reports a full aggregate and build; those are not recast here as reviewer-run checks.

Malformed individual row redesign, broader search/source coverage, language changes during an already-submitted lookup, and PR #157 URL/domain work remain outside this review.

## Author report review

Reviewed `docs/investigations/search-availability-130/README.md` after it was added. No material overclaim was found: it distinguishes synthetic/DOM/VM evidence from live coverage, leaves broader issue scope open, and keeps hosted CI, merge, deployment and served-asset checks as separate gates. The 50-entry cache boundary is correctly explicit there.
