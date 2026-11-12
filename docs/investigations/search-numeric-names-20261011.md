# Numeric station-name reconciliation

This is a bounded correction under [issue #130](https://github.com/c933103/openrailwaystyle/issues/130).
The verified baseline is `79162dff6808b18461e4c8e33e177ca39effb146`, tree
`3fbe3aefc4964325c3146cb40e62ac20ccc984a2`. All 443 baseline blobs were checked
against the GitHub tree before the patch was applied.

## Reproduction and cause

`samePlaceName()` previously treated any residual text without letters from the
matched script as a possible translation. Digits alone therefore qualified:
`Terminal 1` / `Terminal 10`, `Central` / `Central 2`, and `中央` / `中央2`
all compared equal. With different OSM objects approximately 76 metres apart,
`searchResults()` dropped the second geocoder station and `tileStations()`
dropped the second tile station. An exact `Terminal 1` query could also rank
nearer `Terminal 10` ahead of the actual exact-name result.

The [before/after observations](search-numeric-names-20261011/reproduction.json)
use deterministic synthetic records. They do not make public-provider requests
or claim that these synthetic records correspond to particular real stations.

## Correction and preserved behavior

- Reject matches that consume only part of a numeric run or a directly joined
  numeric component separated by a dash, minus sign, dot or slash.
- A residual side containing numbers must contain letters from the other script
  and repeat the matched name's ordered numeric tokens. A residual digit alone
  is not a translation; a contradictory number is not an alias.
- Normalize only numeric tokens with Unicode NFKC, preserving compatibility-width
  aliases such as `第１航廈 Terminal 1` without changing whole-name normalization.
- Preserve legitimate unnumbered aliases, including `大埔墟 Tai Po Market` /
  `Tai Po Market`, and numbered aliases such as `第1航廈 Terminal 1` /
  either component.
- Preserve same-OSM-object deduplication, node/way type separation, duplicate tile
  identity handling, and the existing strict coordinate-distance controls.

This remains a conservative name heuristic, not a general numeral translator.
Numeric tokens from unrelated numeral scripts are not inferred to be equivalent:
for example, Arabic-Indic `١` and Latin `1` are not NFKC equivalents. Such a mixed
alias can remain as two nearby results unless stable OSM identity already proves
it is the same object. Spelled-out numerals are not interpreted. Directly joined
numeric punctuation is treated conservatively; spaced or parenthesized bilingual
separators retain their existing behavior.

## Installed-app delivery

The seven versioned source/page files move together from
`20261011-departure-availability-2` to `20261011-search-numeric-1`. Outside
`map-model.mjs`, these production-file changes are token replacements only.
The service-worker source, cache generation, retention policy and provider URLs are
unchanged.

`tests/fixtures/search-numeric-predecessor.json.gz` contains the exact UTF-8
`app.mjs` and `map-model.mjs` files from the baseline commit, with SHA-256 digests
and the predecessor asset token. It is gzip-compressed JSON, not executable test
setup. `tests/sw-install.test.mjs` loads those historical bytes into the actual
worker with synthetic fetch/cache implementations, admits the new shell, and
checks byte-for-byte delivery of the new modules and retention of previous
modules for old tabs, including offline reads. This is deterministic worker
logic coverage, not native browser network-interception coverage.

## Validation

- New numeric-name regressions on exact-main code: 8 tests, 3 pass / 5 fail.
  Failing cases cover name equality, both reconciliation paths, type separation
  with distinct numbered names, and exact-name ranking.
- Final numeric-name plus service-worker focused tests: 27/27 pass.
- Final `npm run build`: pass. Generated world style and major-station data
  are byte-identical to baseline. JavaScript syntax checks: pass.
- Final `npm test`: 1334/1334 pass, zero skipped or failed tests.
- Independent challenge: 508/508 assertions pass; the identical expanded matrix
  fails 293/508 assertions on baseline. Both paths, Unicode-number boundaries,
  valid aliases, exact-name ordering, OSM identity and distance controls are covered.
- Independent nonnumeric compatibility matrix: 119,025 comparisons, zero changes.
- The independent source review found no remaining blockers. Reviewed source
  SHA-256 digests, the portable challenge scripts, baseline/candidate results,
  full-suite log and [validation summary](search-numeric-names-20261011/validation.json)
  are preserved beside this record. All tests use synthetic/local inputs.

Reproduce the focused checks with:

```sh
node --test tests/search-numeric-names.test.mjs tests/sw-install.test.mjs
npm run build
npm test
node --check styles/app.mjs
node --check styles/map-model.mjs
```

No provider acquisition, identity redesign, label-language-selection change, domain
change, or cache-policy change is included. The broader issue remains open.
