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

Only the selected Chinese font is downloaded. It loads alongside the map;
when ready, the application replaces cached label glyphs. A failed font download
retains the system-font fallback. The service worker caches fonts separately,
so neither file enlarges or blocks mandatory app installation.
