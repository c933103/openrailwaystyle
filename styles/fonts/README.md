# Chinese label fonts

`atlas-cjk-tc-v1.woff2` and `atlas-cjk-sc-v1.woff2` derive from Noto Sans CJK
version 2.004, [source commit f8d1575](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF),
under the [SIL Open Font License](OFL.txt).

They retain the source's complete Han and CJK punctuation coverage, including
Simplified and Traditional characters in both regional designs. Each has 31,883
code points. These use the full `NotoSansCJKtc/sc-VF.ttf` files: the smaller
Taiwan-only `Subset/NotoSansTC-VF.ttf` lacks Simplified glyphs such as 岛 and 顿.

The files are instantiated at weight 400 and subset to CJK ranges. MapLibre can
synthesize label weight as it does for local fonts. Latin glyphs retain the
existing remote Noto Sans glyph source. Regenerate with
`python scripts/build-cjk-fonts.py` after installing Python `fonttools` and
`brotli`. Font version names are immutable; bump the filename and corresponding
loader/cache names when changing their contents.

MapLibre 5.24 gives explicit layer font stacks precedence over its global local
ideograph font option. The loaded regional family is therefore added to each
explicit stack too. `atlasglyph://` removes that local family from remote glyph
requests, preserving the provider's original Latin glyphs and their shared cache.
Browser checks inspect the actual TinySDF canvas font and distinct bitmaps for
Simplified and Traditional Han characters, rather than only the global option.

Neither file is downloaded when the device's own Chinese font is complete.
`styles/cjk-font.mjs` probes the installed candidates for the label script
with a few characters from each set: Simplified (GB 2312), Traditional (Big5),
Hong Kong (HKSCS), Macao (MSCS), Japanese (JIS), compatibility ideographs and
Extensions A and B. A 676-byte probe font, which maps every Han code point to
an empty glyph, follows each candidate so a missing character measures zero
wide. The first candidate covering every set is used. When the best installed
Chinese font is partial (for example Microsoft JhengHei, which has no
Simplified forms), the matching file is fetched once Han labels are actually
drawn; until then and if it fails, the installed font stays in use. With no
named candidate installed (Android exposes none) the system's own fallback
draws the labels. Japanese and Korean keep their installed fonts, since these
files are Chinese designs. Characters beyond these files' coverage (such as
some Macao and later-extension characters) are not yet fetched on demand.
The service worker caches fonts separately, so neither file enlarges or
blocks mandatory app installation.

## Rare Han characters

Characters in CJK Unified Ideographs Extensions B to J and the compatibility
supplement (U+20000–U+3FFFF) that the packaged or installed Chinese font lacks
come from [Jigmo](https://kamichikoichi.github.io/jigmo/) release 20250912
(CC0; glyphs from GlyphWiki). `scripts/build-rare-han.py` checks the release's
SHA-256 and cuts its `Jigmo2.ttf` and `Jigmo3.ttf` into one WOFF2 file per 256
code points: 295 slices, 74,942 characters, about 20 MB in all, about 60 kB
each. The site workflow builds them into `rare-han-v1/` at deploy time (cached
on the script's hash); they are not committed. It takes the archive from this
repository's own copy, the `font-sources` release, which `font-sources.yml`
keeps (run it by hand after changing the pinned release); only without that
copy does it download from the Jigmo site, with a warning. So the site can be
built while the Jigmo site is unavailable and the Actions cache has expired. Slice names are immutable: a new
release or a different cut needs a new directory name in the script, in
`styles/app.mjs` and in `styles/sw.js`.

`styles/rare-han.mjs` registers each slice as an `Atlas Rare Han` font face
with its `unicode-range`, and that family follows the Chinese family in every
label font stack, so an installed or packaged glyph still wins. MapLibre draws
each Han glyph once, with the layer's stack, and keeps the bitmap, and a canvas
does not wait for a font it has not loaded. So the label protocols collect the
blocks of the names they write (`writeLabels`, or the bytes of railway tiles
whose names are drawn as stored) and hand a tile to the map only once its slices
have loaded, or after 8 seconds. A browser downloads only the slices of rare
characters in labels it shows; a failed slice is retried after a minute, and
the service worker keeps loaded slices for offline use.

Names in these planes also depend on `styles/pbf-utf8.mjs`: pbf's own UTF-8
writer turned U+20000–U+2FFFF into U+10000–U+1FFFF when tiles were re-encoded.

## World label fonts

The remote glyph source serves only some Unicode ranges, so the glyphs it
lacks are generated on the device from packaged fonts for the local scripts
of common languages: the Noto designs for Arabic (the Sans design, Naskh and
the Urdu Nastaliq as separate families), Hebrew, Armenian, Georgian,
Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada,
Malayalam, Sinhala, Thai, Lao, Myanmar, Tibetan (the Serif design; Noto has
no Sans Tibetan), Khmer, Ethiopic, Mongolian, Syriac, Tifinagh, Thaana, NKo,
Canadian Aboriginal and Cherokee, a base design (Latin, Greek, Cyrillic and
their extensions), and symbol and math designs — all under the
[SIL Open Font License](OFL.txt). `scripts/build-world-fonts.py` cuts the
system Noto fonts (the site workflow installs the fonts-noto-core and
fonts-noto-extra packages, which between them ship every listed family, and
the build fails if one is missing) into `world-v1/`: one WOFF2 slice per
family, weight and 256 code points — 515 slices, about 3.1 MB in all — plus
an `index.json` of the slices published. The slices are built at deploy
time (cached on the script's hash) and are not committed. Slice and
directory names are immutable: a changed family list or cut needs a new
directory name in the script, in `styles/app.mjs` and in `styles/sw.js`.
Regenerate with `python scripts/build-world-fonts.py` after installing
Python `fonttools` and `brotli` (`ATLAS_FONT_DIRS` overrides the font
search directories). Noto Sans Mongolian, Syriac, Tifinagh, NKo and the
symbol designs ship no static Bold in the source packages; their Bold
labels are synthesised from the Regular slices, as MapLibre synthesises
weight for local fonts.

`styles/world-font.mjs` registers each slice as an `Atlas …` font face with
its `unicode-range`, one family per regional design. `styles/glyph-fallback.mjs`
routes each missing code point to its script's families, loads the slices
for its block, and draws the glyph with TinySDF from those families only —
no system or generic family is ever in the drawing stack — so a device with
no font for a script renders the same glyphs as any other. A slice that
arrives after its glyphs were drawn without it drops the cached range and
redraws the labels; the service worker keeps loaded slices for offline use.
