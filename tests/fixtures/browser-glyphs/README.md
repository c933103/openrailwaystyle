# Offline Latin glyph fixture

`0-255.pbf` is a 24 px DejaVu Sans signed-distance-field glyph fixture, generated
locally by `scripts/build-browser-glyph-fixture.py`. It contains printable Latin-1
characters, including platform numbers. It is not provider typography or a
provider download. The real bundled CJK fonts still supply ideographic glyphs.

The generator requires Pillow, NumPy and SciPy and the distribution's DejaVu Sans
font at `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`; ordinary builds/tests
read the checked-in fixture and need none of those generator dependencies.
See `LICENSE.txt` for the DejaVu/Bitstream licence and notices.

## Vertical metric convention

Pillow's `anchor='ls'` reports ink bounds relative to the alphabetic baseline.
The PBF bearing instead follows [fontnik's serialization](https://github.com/mapbox/node-fontnik/blob/dd14aa539c4888d557f1eb0d9ce6a530b5a18567/src/glyphs.cpp#L264-L270):
`bitmap_top - ascender`. Fontnik reads the [scaled FreeType ascender](https://github.com/mapbox/node-fontnik/blob/dd14aa539c4888d557f1eb0d9ce6a530b5a18567/include/mapbox/glyph_foundry_impl.hpp#L247-L250);
[Pillow exposes the same metric](https://github.com/python-pillow/Pillow/blob/bc7e6f59a2497cedae736f0d2a52f105ae3299b1/src/_imagingft.c#L1518-L1521)
through `font.getmetrics()[0]`. At 24 px this DejaVu Sans ascent is 23.
The generator therefore serializes `-top - ascent`, while rasterization
remains baseline-relative.

The origin correction changes only field 6 for all 224 glyphs, leaving every
SDF bitmap, dimension, advance and horizontal bearing unchanged. The unit
fixture test checks those preserved bytes and representative bearings, including
U+00D7 (×) top −9. The browser overlap check separately requires real ink
intersection before asserting circle/symbol paint order. This fixture does
not reproduce a provider's typography or change production font assets.
