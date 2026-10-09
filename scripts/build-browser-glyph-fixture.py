"""Offline Latin glyph fixture from DejaVu Sans (Pillow, NumPy, SciPy).

Not part of the site build. Rebuild explicitly with Python 3 and these installed
packages; never download glyphs from a map provider. See fixture README/license.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from scipy.ndimage import distance_transform_edt


def varint(value):
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    return bytes(result + bytes([value]))


def integer(tag, value):
    return varint(tag << 3) + varint(value)


def data(tag, value):
    return varint((tag << 3) | 2) + varint(len(value)) + value


font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 24)
stack = data(1, b'DejaVu Sans fixture') + data(2, b'0-255')
for code in range(32, 256):
    char = chr(code)
    left, top, right, bottom = font.getbbox(char, anchor='ls')
    width, height = right - left, bottom - top
    mask = Image.new('L', (width + 6, height + 6))
    ImageDraw.Draw(mask).text((3 - left, 3 - top), char, font=font, fill=255, anchor='ls')
    inside = np.asarray(mask) >= 128
    if inside.any():
        distance = distance_transform_edt(~inside) - distance_transform_edt(inside)
        bitmap = np.clip(np.round(255 * (0.75 - distance / 8)), 0, 255).astype('uint8').tobytes()
    else:
        bitmap = bytes((width + 6) * (height + 6))
    signed = lambda value: value * 2 if value >= 0 else -value * 2 - 1
    glyph = (integer(1, code) + data(2, bitmap) + integer(3, width) + integer(4, height)
             + integer(5, signed(left)) + integer(6, signed(-top)) + integer(7, round(font.getlength(char))))
    stack += data(3, glyph)
Path('tests/fixtures/browser-glyphs/0-255.pbf').write_bytes(data(1, stack))
