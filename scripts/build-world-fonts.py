"""Deploy-time slices of the packaged world label fonts (styles/world-font.mjs).

The remote glyph source behind the map style serves only some Unicode
ranges; the rest (Arabic, Thai, most Indic scripts, Mongolian, ...) come
back empty and MapLibre drops those characters from every label, basemap
and railway alike. The site therefore packages its own fonts for the local
scripts of common languages, generalising the packaged CJK fonts: one
WOFF2 slice per family, weight and 256-code-point block, so a browser
downloads only the slices holding characters in labels it draws, and a
device with no font for a script still renders its names. Regional designs
stay separate families (Noto Sans Arabic, Noto Naskh Arabic and Noto
Nastaliq Urdu are different fonts, not one Arabic font), because a name
must be drawn in its own region's forms.

Sources are the system Noto fonts (Debian/Ubuntu packages fonts-noto-core
and fonts-noto-extra in the site workflow; ATLAS_FONT_DIRS, a
path-separator list, overrides the search directories). All are under the
SIL Open Font License (styles/fonts/OFL.txt). Slice names are immutable: a
changed family list or cut needs a new directory name (world-v2) in this
script, the app and the service worker.

    pip install fonttools brotli
    python scripts/build-world-fonts.py [output directory]
"""
import io
import json
import os
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

# Family id -> (Regular file, Bold file or None). One id per regional
# design Noto ships separately; scripts whose regional conventions are
# code points or OpenType variants of one design share a family (the base
# Noto Sans carries the Serbian and Bulgarian Cyrillic locl forms; Noto
# Sans Devanagari carries the Hindi and Marathi conventions). CJK designs
# are packaged separately (scripts/build-cjk-fonts.py) and rare Han comes
# from Jigmo (scripts/build-rare-han.py), so neither is repeated here.
FAMILIES = {
    "base": ("NotoSans-Regular.ttf", "NotoSans-Bold.ttf"),
    "arabic": ("NotoSansArabic-Regular.ttf", "NotoSansArabic-Bold.ttf"),
    "naskh": ("NotoNaskhArabic-Regular.ttf", "NotoNaskhArabic-Bold.ttf"),
    "nastaliq": ("NotoNastaliqUrdu-Regular.ttf", "NotoNastaliqUrdu-Bold.ttf"),
    "hebrew": ("NotoSansHebrew-Regular.ttf", "NotoSansHebrew-Bold.ttf"),
    "armenian": ("NotoSansArmenian-Regular.ttf", "NotoSansArmenian-Bold.ttf"),
    "georgian": ("NotoSansGeorgian-Regular.ttf", "NotoSansGeorgian-Bold.ttf"),
    "devanagari": ("NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari-Bold.ttf"),
    "bengali": ("NotoSansBengali-Regular.ttf", "NotoSansBengali-Bold.ttf"),
    "gurmukhi": ("NotoSansGurmukhi-Regular.ttf", "NotoSansGurmukhi-Bold.ttf"),
    "gujarati": ("NotoSansGujarati-Regular.ttf", "NotoSansGujarati-Bold.ttf"),
    "oriya": ("NotoSansOriya-Regular.ttf", "NotoSansOriya-Bold.ttf"),
    "tamil": ("NotoSansTamil-Regular.ttf", "NotoSansTamil-Bold.ttf"),
    "telugu": ("NotoSansTelugu-Regular.ttf", "NotoSansTelugu-Bold.ttf"),
    "kannada": ("NotoSansKannada-Regular.ttf", "NotoSansKannada-Bold.ttf"),
    "malayalam": ("NotoSansMalayalam-Regular.ttf", "NotoSansMalayalam-Bold.ttf"),
    "sinhala": ("NotoSansSinhala-Regular.ttf", "NotoSansSinhala-Bold.ttf"),
    "thai": ("NotoSansThai-Regular.ttf", "NotoSansThai-Bold.ttf"),
    "lao": ("NotoSansLao-Regular.ttf", "NotoSansLao-Bold.ttf"),
    "myanmar": ("NotoSansMyanmar-Regular.ttf", "NotoSansMyanmar-Bold.ttf"),
    # Noto has no Sans Tibetan; the Serif design is the packaged one.
    "tibetan": ("NotoSerifTibetan-Regular.ttf", "NotoSerifTibetan-Bold.ttf"),
    "khmer": ("NotoSansKhmer-Regular.ttf", "NotoSansKhmer-Bold.ttf"),
    "ethiopic": ("NotoSansEthiopic-Regular.ttf", "NotoSansEthiopic-Bold.ttf"),
    # Noto Sans Mongolian ships no static Bold; the browser synthesises
    # label weight from the Regular slices, as it does for local fonts.
    "mongolian": ("NotoSansMongolian-Regular.ttf", None),
    "syriac": ("NotoSansSyriac-Regular.ttf", "NotoSansSyriac-Bold.ttf"),
    "tifinagh": ("NotoSansTifinagh-Regular.ttf", "NotoSansTifinagh-Bold.ttf"),
    "thaana": ("NotoSansThaana-Regular.ttf", "NotoSansThaana-Bold.ttf"),
    "nko": ("NotoSansNKo-Regular.ttf", "NotoSansNKo-Bold.ttf"),
    "canadian-aboriginal": ("NotoSansCanadianAboriginal-Regular.ttf", "NotoSansCanadianAboriginal-Bold.ttf"),
    "cherokee": ("NotoSansCherokee-Regular.ttf", "NotoSansCherokee-Bold.ttf"),
    "symbols": ("NotoSansSymbols-Regular.ttf", "NotoSansSymbols-Bold.ttf"),
    "symbols2": ("NotoSansSymbols2-Regular.ttf", None),
    "math": ("NotoSansMath-Regular.ttf", None),
}
WEIGHTS = ((400, 0), (700, 1))  # (weight, index into the family tuple)


def font_dirs():
    override = os.environ.get("ATLAS_FONT_DIRS")
    if override:
        return [Path(p) for p in override.split(os.pathsep) if p]
    return [Path("/usr/share/fonts/truetype/noto"), Path("/usr/share/fonts")]


def find_file(name, dirs):
    for directory in dirs:
        for candidate in directory.rglob(name):
            return candidate
    return None


def slices(font_bytes):
    """(block, code count, woff2 bytes) for every block with glyphs."""
    cmap = TTFont(io.BytesIO(font_bytes), lazy=True).getBestCmap()
    blocks = {}
    for code in cmap:
        blocks.setdefault(code >> 8, []).append(code)
    for block, codes in sorted(blocks.items()):
        font = TTFont(io.BytesIO(font_bytes), lazy=True)
        options = subset.Options()
        options.flavor = "woff2"
        # Layout features stay (unlike the rare Han cut): the base font's
        # Cyrillic locl forms and the Arabic-script designs' joining and
        # regional features are part of the glyphs being packaged.
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
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "styles/fonts/world-v1"
    dirs = font_dirs()
    missing = [name for pair in FAMILIES.values() for name in pair[:1] if not find_file(name, dirs)]
    if missing:
        sys.exit("World font sources not found (install fonts-noto-core and fonts-noto-extra): " + ", ".join(missing))
    output.mkdir(parents=True, exist_ok=True)
    index, total, characters, report = {}, 0, 0, []
    for family, pair in FAMILIES.items():
        index[family] = {}
        for weight, slot in WEIGHTS:
            name = pair[slot]
            if name is None:
                continue
            path = find_file(name, dirs)
            if path is None:
                print(f"warning: {family} weight {weight}: {name} not found, slices skipped", file=sys.stderr)
                continue
            blocks = []
            for block, count, data in slices(path.read_bytes()):
                (output / f"{family}-{weight}-{block:03x}.woff2").write_bytes(data)
                blocks.append(block)
                total += len(data)
                characters += count
            index[family][str(weight)] = blocks
            report.append(f"{family}/{weight}: {len(blocks)} slices")
    (output / "index.json").write_text(json.dumps({
        "license": "OFL-1.1",
        "source": "Noto fonts (system fonts-noto packages)",
        "characters": characters,
        "bytes": total,
        "families": index,
    }, separators=(",", ":")) + "\n")
    print("; ".join(report))
    print(f"{sum(len(b) for f in index.values() for b in f.values())} slices, {characters} characters, {total / 1e6:.1f} MB in {output}")


if __name__ == "__main__":
    main()
