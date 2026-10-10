# Atlas CJK Extensions H, I and J font audit

Checked 10 October 2026. Source baseline: `74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3`.

## Result

The deployed fallback contains a nonempty mapped outline for all 4,192 assigned Extension H characters, all 622 Extension I characters and all 4,298 Extension J characters. The corresponding 38 live WOFF2 slices and their index returned HTTP 200 and exactly matched the audited CI artifact by SHA-256. The shared fallback does not provide automatic region-specific glyph selection or preserve source ideographic variation sequences (IVS).

This establishes scalar coverage, font-table contents and the current selection mechanism. It does not establish that every glyph matches every region's convention, nor imply that every shared glyph is incorrect or needs separate SC/TC/HK/JP/KR variants.

## Exact fonts and coverage

| Assigned repertoire | Source font | Assigned range | Present / assigned | Slice files |
| --- | --- | --- | --- | --- |
| Extension H | Jigmo3 Regular, 2025-09-12 | U+31350–U+323AF | 4,192 / 4,192 | `313.woff2` through `323.woff2` |
| Extension I | Jigmo2 Regular, 2025-09-12 | U+2EBF0–U+2EE5D | 622 / 622 | `2eb.woff2` through `2ee.woff2` |
| Extension J | Jigmo3 Regular, 2025-09-12 | U+323B0–U+33479 | 4,298 / 4,298 | `323.woff2` through `334.woff2` |

The H and J ranges share slice `323`, so the union is 38 files. The final unassigned positions within the I/J Unicode blocks are excluded from assigned-character counts. No mapped H/I/J glyph has `glyf.numberOfContours == 0`; this is an outline-presence check, not a visual audit of every glyph.

Atlas registers these files under the CSS family `Atlas Rare Han`. H/J come from `Jigmo3.ttf`; I comes from `Jigmo2.ttf`. The [pinned builder](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/scripts/build-rare-han.py#L27-L57) verifies the source archive and produces one WOFF2 slice per 256 code points. The [site workflow](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/.github/workflows/site.yml#L114-L127) builds or restores these generated files. They are not committed application assets.

The separately committed `atlas-cjk-sc-v1.woff2` and `atlas-cjk-tc-v1.woff2`, derived from Noto Sans CJK 2.004, each map 31,883 scalars and zero H/I/J characters. Their local Git blob hashes match the corresponding main-branch blobs:

- SC: `7f4b24cde1119cdd4432462ffba62afb6392f1b6`
- TC: `fe88072cc5f8c429d02df86bb3174faf599cd979`

## Regional selection and variation-sequence limits

1. An installed or packaged regional family may win before `Atlas Rare Han` when it actually has the character. Otherwise every region uses the same rare slice and default scalar glyph. [Fallback ordering](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/styles/app.mjs#L166-L175), [explicit layer stacks](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/styles/app.mjs#L1108-L1117).
2. The app chooses one map-label script family from the selected label language, or a browser-language fallback for other settings. Its available named families are SC, TC, JP and KR. Browser preferences for HK and MO fold into Hant, and Hant's canvas language becomes `zh-TW`; there is no distinct HK font path. A feature's geographic region helps name selection but is not a separate per-glyph regional font choice. [Script routing](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/styles/app.mjs#L149-L157), [canvas language](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/styles/app.mjs#L228-L248), [font candidates](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/styles/cjk-font.mjs#L23-L28).
3. All 295 rare slices in the retained CI artifact map 74,942 scalars. They have zero cmap format-14 UVS entries and zero GSUB/GPOS feature records. H/I/J slices have only cmap format 12; empty GSUB tables may still be present. Thus `locl` switching and source IVS are unavailable in these bytes. The builder explicitly sets `layout_features = []` and selects base scalar code points only. These are separate facts: clearing layout features removes layout substitutions, while the resulting subset also has no variation-sequence cmap.
4. [Jigmo's source documentation](https://kamichikoichi.github.io/jigmo/) advertises IVS data, including one for U+31350 in Jigmo3. That source-font capability does not survive into the audited Atlas slice. The audit does not claim the original Jigmo fonts lack IVS.
5. Atlas's pinned MapLibre 5.24 renderer gathers glyph dependencies as individual scalar values, caches by font stack and scalar ID, and calls TinySDF with `String.fromCodePoint(id)`. A Han character and its variation selector do not reach this map-label rasterizer as one sequence. Preserving font IVS data alone would therefore be insufficient for map-label IVS support. [Glyph collection](https://github.com/maplibre/maplibre-gl-js/blob/v5.24.0/src/data/bucket/symbol_bucket.ts#L414-L428), [cache](https://github.com/maplibre/maplibre-gl-js/blob/v5.24.0/src/render/glyph_manager.ts#L93-L107), [scalar draw](https://github.com/maplibre/maplibre-gl-js/blob/v5.24.0/src/render/glyph_manager.ts#L157-L164). Atlas's distribution backport is an unrelated DOM-attribute iteration fix.
6. Installed-font probing uses a small selection of characters, including Extensions A/B, not an exhaustive H/I/J regional audit. Its `complete` flag does not establish complete later-extension coverage. [Probe sets](https://github.com/c933103/openrailwaystyle/blob/74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3/styles/cjk-font.mjs#L8-L17).

DOM detail text uses browser text shaping and language-marked CJK runs, a different rendering path from map labels. It still cannot obtain IVS alternatives from the audited Atlas font bytes, which contain no UVS mappings. Installed-font behavior and visual correctness on every client were not tested.

## Live evidence and provenance

Live reads occurred between 15:19:13 and 15:20:14 UTC on 10 October 2026, using ordinary HTTPS GETs without credentials, account state or site changes:

- Base: `https://c933103.github.io/openrailwaystyle/`
- Index: [`fonts/rare-han-v1/index.json`](https://c933103.github.io/openrailwaystyle/fonts/rare-han-v1/index.json)
- H/I/J: all 38 individual font paths listed in `live-receipt.json`, relative to that base
- Index SHA-256: `fb67ad1cb5a5ec293b3307156768b9decdd35f5b2eb4d6134f0baac225b2a505`
- The live `app.mjs` also returned HTTP 200. SHA-256 `559883954f8b02d4285ad4d7616c23b83703e02e7a1b66a5ae5a270cf08bae1c` equals the inspected main-source bytes; their Git blob SHA is `fd585a819ddc48402606ada162886d4eb3eb646e`.

The full-font table audit used retained `railway-world-site` artifact **11672435802** from [run 38058389835](https://github.com/c933103/openrailwaystyle/actions/runs/38058389835), tested-site commit `a38098c1d459238f62bc113c7d5845e38b07cf79`. Archive size: 423,921,725 bytes; SHA-256: `3062ce7007f000704240cd0849dd7e0c4fb3a9479696b167bd8fe0fc1c24ff74`. This was a CI artifact, not presumed live by its name: live H/I/J font equality was checked separately as above. The remaining 257 rare slices were table-audited in the CI artifact but not individually fetched from live hosting during this audit.

## Reproduction and retained files

Use Python with `fonttools` and Brotli support. This audit used the already installed `/usr/bin/python3`; no packages were installed. Obtain the identified site artifact and a checkout with the matching committed SC/TC font hashes, then run:

```sh
python3 audit.py --archive railway-world-site.zip --source /path/to/checkout > local-audit.json
python3 audit.py --archive railway-world-site.zip --source /path/to/checkout --live > repeated-live-audit.json
```

`audit.py` reads files and public font endpoints only; it makes no repository or service changes. Recorded baseline identifiers refer to this investigation and should be reassessed if auditing a later build. `local-audit.json` contains each font's hashes, names, cmap formats, feature tags, UVS counts and H/I/J outline-presence checks. `live-receipt.json` contains all 38 slice responses, the index comparison and the app fingerprint. `manifest.json` binds these evidence files.

No runtime remediation, font change, settings change, PR, merge or deployment was performed for this investigation. Any future correction should distinguish character availability, regional glyph selection and IVS behavior, and verify them separately against concrete expected glyphs and the actual renderer.
