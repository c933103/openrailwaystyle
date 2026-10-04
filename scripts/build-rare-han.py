"""Deploy-time slices of rare Han characters (styles/rare-han.mjs).

Cuts Jigmo's Plane 2 and Plane 3 fonts (CJK Unified Ideographs Extensions B
to J and the compatibility supplement, U+20000-U+3FFFF) into one WOFF2 file
per 256 code points, so a browser downloads only the slice holding a rare
character in a label it shows. Jigmo is CC0; its glyphs come from GlyphWiki.
Slice names are immutable: a new release or a changed cut needs a new
directory name (rare-han-v2) in this script, the app and the service worker.

    pip install fonttools brotli
    python scripts/build-rare-han.py [Jigmo zip] [output directory]

Without a zip argument the pinned release is downloaded. Its SHA-256 is
checked either way, so a changed upstream file stops the build.
"""
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen

from fontTools import subset
from fontTools.ttLib import TTFont

RELEASE = "20250912"
URL = f"https://kamichikoichi.github.io/jigmo/Jigmo-{RELEASE}.zip"
SHA256 = "5744c7386d129475d87607ca66d043c8793c65448adeaedc921b6931890e5d0b"
FIRST, LAST = 0x20000, 0x3FFFF
FILES = ("Jigmo2.ttf", "Jigmo3.ttf")


def slices(font_bytes):
    """(block, woff2 bytes) for every 256-code-point block with glyphs."""
    cmap = TTFont(io.BytesIO(font_bytes), lazy=True).getBestCmap()
    blocks = {}
    for code in cmap:
        if FIRST <= code <= LAST:
            blocks.setdefault(code >> 8, []).append(code)
    for block, codes in sorted(blocks.items()):
        font = TTFont(io.BytesIO(font_bytes), lazy=True)
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = []
        options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        options.name_languages = [0x409]
        options.hinting = False
        options.notdef_outline = False
        options.drop_tables += ["FFTM"]
        selected = subset.Subsetter(options=options)
        selected.populate(unicodes=codes)
        selected.subset(font)
        out = io.BytesIO()
        font.flavor = "woff2"
        font.save(out)
        yield block, len(codes), out.getvalue()


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "styles/fonts/rare-han-v1"
    archive = source.read_bytes() if source else urlopen(URL, timeout=120).read()
    digest = hashlib.sha256(archive).hexdigest()
    if digest != SHA256:
        sys.exit(f"Jigmo {RELEASE} archive has SHA-256 {digest}, expected {SHA256}")
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        fonts = {name: zipped.read(name) for name in FILES}
    index, total, characters = [], 0, 0
    for name in FILES:
        for block, count, data in slices(fonts[name]):
            (output / f"{block:03x}.woff2").write_bytes(data)
            index.append(block)
            total += len(data)
            characters += count
    (output / "index.json").write_text(json.dumps({
        "family": "Jigmo",
        "release": RELEASE,
        "license": "CC0-1.0",
        "source": URL,
        "range": [FIRST, LAST],
        "characters": characters,
        "bytes": total,
        "blocks": index,
    }, separators=(",", ":")) + "\n")
    print(f"{len(index)} slices, {characters} characters, {total / 1e6:.1f} MB in {output}")


if __name__ == "__main__":
    main()
