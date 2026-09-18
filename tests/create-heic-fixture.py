"""Regenerate the original tiny HEIC browser-test fixture (requires pillow-heif)."""
from pathlib import Path

from PIL import Image, ImageDraw
import pillow_heif

image = Image.new('RGB', (96, 128), '#adc3d4')
draw = ImageDraw.Draw(image)
draw.rectangle((6, 6, 25, 25), fill='#cf6558')
draw.ellipse((31, 27, 70, 78), fill='#d9a48a')
draw.rectangle((16, 92, 79, 122), fill='#344c68')
pillow_heif.from_pillow(image).save(Path(__file__).parent / 'fixtures' / 'portrait.heic', quality=80)
