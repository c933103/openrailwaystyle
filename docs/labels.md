# Label languages and fallback rules

[Documentation index](README.md) · [Project overview](../README.md)

## Shared selector

One shared language selector controls map, station and railway labels. Western languages fall back to English and recorded Latin names before native names. Russian prefers recorded Cyrillic names, then English. Chinese tries Chinese variants and available ideographic names, including ordinary Japanese, Korean Hanja (`name:ko-Hani`) and Vietnamese Chữ Nôm (`name:vi-Hani`), before English; a Japanese name recorded as “kana (kanji)” or “kanji (kana)” shows only the kanji. Japanese prioritizes ideographic names over kana-only names.

## Chinese tag selection

Chinese keys are read by area, and the script of a name is never guessed from its characters. `name:zh-Hant`/`name:zh-Hans` state a script; untagged `name:zh` is in whichever script its editor chose; `name:zh-TW`, `name:zh-HK` and `name:zh-CN` carry regional wording; `name` is the local Chinese name in mainland China and Taiwan but multilingual in Hong Kong and Macau, where `name:zh` holds the local Chinese name.

The following sequences are tried from left to right. Except for `name`, each
entry is the suffix of an OSM `name:*` tag.

| Area | Traditional Chinese | Simplified Chinese |
| --- | --- | --- |
| Taiwan | `name` | `zh-Hans` → `zh-CN` → `zh` → `name` |
| Hong Kong and Macau | `zh` → `zh-Hant` → `zh-HK` → `zh-TW` → `name` | `zh-Hans` → `zh-CN` → `zh` → `zh-Hant` → `zh-HK` → `zh-TW` → `name` |
| Mainland China | `zh-Hant` → `zh-TW` → `zh-HK` → `zh` → `name` | `name` |
| Elsewhere | `zh-Hant` → `zh` → `zh-TW` → `zh-HK` → `zh-Hans` → `zh-CN` | `zh-Hans` → `zh` → `zh-CN` → `zh-Hant` → `zh-TW` → `zh-HK` |

In those four areas the local `name` is used as recorded, even when it is not Chinese (KFC, K11), and ends the list; elsewhere the other script always comes before borrowed names and English, so a name recorded only in the other script is shown. Taiwan wording ranks before Hong Kong wording; `zh-SG`, `zh-MY` and `zh-MO` are too rare to consult.

Operating-line names come from OpenRailwayMap's line tiles, which carry only the `name` tag, so they show the recorded name in every language.

## Geographic regions and boundary sources

The four areas are the time zones Asia/Shanghai with Asia/Urumqi, Asia/Taipei, Asia/Hong_Kong and Asia/Macau from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) (as packaged by the geo-tz npm module; © OpenStreetMap contributors, ODbL), which follow OSM land and territorial-sea boundaries and include every outlying island, such as Matsu, Kinmen, Pratas and Taiping.

Their outlines keep about 30 m of detail around Hong Kong and Macau, 200 m along the Vietnam and North Korea borders and 1 km elsewhere; islands far from Natural Earth's land, such as Pratas, Taiping and the Paracels, join the Han-character region with their territorial sea.

## Borrowing names from other languages

Borrowing Han-character names from other languages is separate and applies by location: for Chinese within China, Taiwan, Hong Kong, Macau, Japan, the Koreas, Vietnam, Singapore, Malaysia, the Russian Far East (the Far Eastern Federal District as constituted since 2018, including Buryatia and Zabaykalsky Krai) and the Chinese-speaking areas of Myanmar and Thailand: Wa State as it is governed, both its northern part and its southern region along the Thai border (Mandarin is its working language), Mong La (Special Region 4), Kokang (Laukkaing and Konkyan townships) and Thailand's Mae Fa Luang district (Santikhiri/Mae Salong, Thoet Thai).

Scattered Chinese-speaking villages and town communities elsewhere in northern Thailand, eastern Myanmar and northern Laos are not covered; their recorded `name:zh` names show anyway, since Chinese tags are read everywhere. For Japanese, borrowing is limited to China, Taiwan, Hong Kong, Macau, Japan, the Koreas and Vietnam.

Elsewhere Chinese uses its recorded Chinese variants and Japanese its recorded Japanese name, then English, then the native name, so no place outside those areas is given a borrowed Han name.

## Region assignment and precision

Each label tile records the region and Chinese area at every feature's centre (`atlas_han`, `atlas_zh`); clicked operating lines and search results use their own coordinates.

Regions come from Natural Earth 1:10m admin-0 and admin-1 de facto boundaries, plus OpenStreetMap boundary relations for Wa State and Mong La (ODbL), geoBoundaries Myanmar townships for Kokang (Myanmar Analytics Project, CC BY 4.0) and Thai districts (Royal Thai Survey Department / OCHA ROAP, CC BY 3.0 IGO) (`scripts/build-han-region.mjs`); these finer outlines take precedence over Natural Earth's borders, bundled with the label code rather than fetched separately.

Coasts are simplified to about 1 km. Sea within 12 nautical miles goes to the nearest land, so piers, bridges and undersea tunnels such as Seikan count with the coast they leave, while land in another country never counts; land borders keep about 200 m detail, but Natural Earth itself can be a kilometre or more off in places (for example at Padang Besar on the Malaysia–Thailand border), so a place that close to a border can be assigned to the neighbouring area.

Unicode script checks include supplementary-plane Han characters; names are never automatically translated, transliterated or converted between character standards. If no preferred name exists, the native name remains visible.

Chinese labels load a packaged regional CJK font with coverage of both Chinese
scripts, so a name drawn in either script, or mixing both, uses one consistent
font. A Simplified name shown in the Traditional view (and the reverse) is drawn
as recorded. Fonts load alongside the map and replace cached glyphs
when ready; each selected script's font is cached for later offline use. Neither
font is part of mandatory app installation. Source, coverage and regeneration
instructions are in [the font reference](../styles/fonts/README.md).

## Glyphs the remote source does not serve

Labels draw their glyphs from the remote source the style names, which
serves only some Unicode ranges: at the last audit 28 of the 256
basic-plane ranges had any glyphs, and Arabic, Thai, Lao, Tibetan,
Khmer, Ethiopic, most Indic scripts and Mongolian were empty, so those
characters were dropped from basemap and railway labels alike. The
`atlasglyph` protocol completes each downloaded range on the device
instead: code points the range lacks are generated from the packaged
world fonts (below) before the map sees the range, and a range that
cannot be completed is used as downloaded.

The packaged fonts are the Noto designs for the local scripts of common
languages, cut at deploy time into one WOFF2 slice per family, weight
and 256 code points, and downloaded only for characters in labels about
to be drawn, like the rare Han slices. Glyph generation uses only these
packaged families — never a system or generic family — so a device with
no font for a script still renders its names, and renders the same
glyphs as any other device. CJK ideographs, kana and Hangul keep their
own routes above, and rare Han keeps its slices.

Regional designs stay separate families, because one region's forms
must not be shipped as universal. The Arabic script has three packaged
designs: the Sans design (whose letterforms are also the Persian ones),
Naskh, and the Urdu Nastaliq, which draws Urdu's own letters. An
Arabic-script label language selects its design; in local names, a
name's Urdu or Persian letters select theirs. Scripts whose regional
conventions are code points or variants within one design share a
family: Assamese names use the Bengali design, Hindi and Marathi names
the Devanagari design, and the base design carries the Serbian and
Bulgarian Cyrillic forms as OpenType language variants. Generated
Cyrillic glyphs use that design's default forms, as the remote source
also serves them: a glyph request carries no language for its name, so
this one case stays approximate. Shaping proper — Arabic joining beyond
the presentation forms recorded in tiles — is separate from glyph
coverage and unchanged by it. Mongolian vertical layout on the map is
handled inside the renderer's shaping, per script run like the Arabic
path; see the next section.

## Vertical Mongolian in detail panels and search results

Traditional Mongolian is written vertically — top to bottom, columns
progressing left to right. Where a name is text — the detail panel
(feature and station details, departures and nearby names, all of which
render into that one container) and search results — Mongolian runs are
wrapped in a span that stands them vertically (`writing-mode:
vertical-lr`, never `text-orientation: upright`, which collapses the
glyphs in Blink), and the browser's own text engine joins the letters
properly (`styles/mongolian-text.mjs`). The span draws in the packaged
Atlas Mongolian design, requested for the name's blocks when the panel
or results render and swapped in when it loads, so a device with no
Mongolian font still renders the name correctly. A mixed name keeps its
other scripts horizontal: the vertical run is an inline block aligned
to the line's top, capped at about nine lines' height, beyond which it
wraps into further columns to the right.

Map labels get the same treatment inside the renderer's shaping layer,
per script run — not through its per-layer writing-mode switch. The
patched distribution (`docs/maplibre-backport.md`, atlas.3) substitutes
each Mongolian letter in a word with a private-use code point naming
its contextual form and variation-selector variant, and restacks the
run vertically at the end of point-label shaping; the glyph fallback
generates those forms from the same packaged design, drawn in joining
context and rotated into the vertical orientation. A mixed
Cyrillic–Mongolian label therefore keeps its Cyrillic horizontal and
stands its Mongolian run as a joined column beside it. Line-path labels
and layers in vertical writing mode keep the horizontal layout for a
Mongolian run.

## Provider handling

`styles/tile-labels.mjs` preserves vector tile geometry and attaches the selected display name. The station provider exposes one translation per request, so the client requests fallback languages only while current-view stations remain unresolved and retains a bounded cache. Missing translations are distinguished from the provider's native-name substitution. Failed optional translation lookups retain already loaded stations. Snapshot line names retain OSM `name:*` tags. The operating-line provider generally exposes **only local names**, so translations omitted from those tiles cannot be recovered by the selector. Search results depend on the separate search API. Railway names appear along tracks from zoom 9; speed labels retain source units.

Curated overview metadata contains no display-name fields. Its plain `name` in `styles/data-src/major-stations.json` is only a maintenance note and is not emitted to GeoJSON. The curated list decides which station is shown at zooms 3–6; its name comes, like every other station label, from the provider's station tiles through the same language and fallback handling. For each curated hub in view the client reads the zoom-8 station tile holding it, and takes the entry whose OSM identity is the curated object or one of its `osmAliases`. Names therefore follow the provider's data as normal station labels do; nothing is requested from the OpenStreetMap API. A hub appears once its tile has been read, and changing Language reads the tiles again in that language. Curated local search uses the same names as the labels, never maintenance notes.
