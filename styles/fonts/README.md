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
