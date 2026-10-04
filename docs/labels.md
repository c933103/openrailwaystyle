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

## Provider handling

`styles/tile-labels.mjs` preserves vector tile geometry and attaches the selected display name. The station provider exposes one translation per request, so the client requests fallback languages only while current-view stations remain unresolved and retains a bounded cache. Missing translations are distinguished from the provider's native-name substitution. Failed optional translation lookups retain already loaded stations. Snapshot line names retain OSM `name:*` tags. The operating-line provider generally exposes **only local names**, so translations omitted from those tiles cannot be recovered by the selector. Search results depend on the separate search API. Railway names appear along tracks from zoom 9; speed labels retain source units.

Curated overview metadata contains no display-name fields. Its plain `name` in `styles/data-src/major-stations.json` is only a maintenance note and is not emitted to GeoJSON. The curated list decides which station is shown at zooms 3–6; its name comes, like every other station label, from the provider's station tiles through the same language and fallback handling. For each curated hub in view the client reads the zoom-8 station tile holding it (and, where the provider groups the hub under a metro station shown only from zoom 10, that zoom's tile), and takes the entry whose OSM identity is the curated object or one of its `osmAliases`. Names therefore follow the provider's data as normal station labels do; nothing is requested from the OpenStreetMap API. A hub appears once its tile has been read, and changing Language reads the tiles again in that language. Curated local search uses the same names as the labels, never maintenance notes.
