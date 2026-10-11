# Offline Latin glyph fixture

`0-255.pbf` is a 24 px DejaVu Sans signed-distance-field glyph fixture, generated
locally by `scripts/build-browser-glyph-fixture.py`. It contains printable Latin-1
characters, including platform numbers. It is not provider typography or a
provider download. The real bundled CJK fonts still supply ideographic glyphs.

The generator requires Pillow, NumPy and SciPy and the distribution's DejaVu Sans
font at `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`; ordinary builds/tests
read the checked-in fixture and need none of those generator dependencies.
See `LICENSE.txt` for the DejaVu/Bitstream licence and notices.
