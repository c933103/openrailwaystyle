"""Optional font regeneration: pip install fonttools brotli, then run this script."""
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset
from io import BytesIO

SOURCE_COMMIT = "f8d157532fbfaeda587e826d4cd5b21a49186f7c"
SOURCE = f"https://raw.githubusercontent.com/notofonts/noto-cjk/{SOURCE_COMMIT}/Sans/"
OUTPUT = Path(__file__).resolve().parents[1] / "styles/fonts"
OUTPUT.mkdir(exist_ok=True)

for code in ("tc", "sc"):
    # Use the complete regional font, not the language-only TTF/Subset variant.
    with urlopen(SOURCE + f"Variable/TTF/NotoSansCJK{code}-VF.ttf", timeout=60) as response:
        font = TTFont(BytesIO(response.read()))
    instantiateVariableFont(font, {"wght": 400}, inplace=True)
    options = subset.Options()
    options.layout_features = []
    options.name_IDs = [1, 2, 3, 4, 5, 6, 13, 14]
    options.name_legacy = True
    options.name_languages = [0x409]
    options.recalc_bounds = True
    selected = subset.Subsetter(options=options)
    selected.populate(unicodes=[c for c in font.getBestCmap() if
                               0x2E80 <= c <= 0xA4CF or 0xF900 <= c <= 0xFAFF or
                               0xFE30 <= c <= 0xFE4F or 0xFF00 <= c <= 0xFFEF or
                               0x20000 <= c <= 0x323AF])
    selected.subset(font)
    for name in font["name"].names:
        if name.nameID in (1, 3, 4, 6):
            value = name.toUnicode().replace("Noto Sans CJK", "Atlas CJK").replace("NotoSansCJK", "AtlasCJK")
            name.string = value.encode(name.getEncoding())
    assert all(ord(c) in font.getBestCmap() for c in "武汉青岛华盛顿联合车站武漢青島華盛頓聯合車站")
    font.flavor = "woff2"
    font.save(OUTPUT / f"atlas-cjk-{code}-v1.woff2")

with urlopen(SOURCE + "LICENSE", timeout=60) as response:
    notice = "© 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.\n\n"
    (OUTPUT / "OFL.txt").write_bytes(notice.encode("utf-8") + response.read())
