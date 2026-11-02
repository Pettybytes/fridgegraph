"""Two-state, labeled replay from committed live browser captures only.

Requires Pillow. Source frames: web/evidence/notice-plan/live-2026-11-02/.
No generated UI state and no claim of completed pickup.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[3]
out = Path(__file__).parent
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 18)
frames = []
for filename, label in [('notice-review.png', '1  PARENT REVIEW'), ('notice-result.png', '2  REQUEST RECORDED')]:
    source = Image.open(out / filename).convert('RGB').resize((360, 690), Image.Resampling.LANCZOS)
    frame = Image.new('RGB', (360, 732), '#4654AD')
    frame.paste(source, (0, 42))
    ImageDraw.Draw(frame).text((16, 11), label, fill='white', font=font)
    frames.append(frame)
frames[0].save(out / 'notice-replay.gif', save_all=True, append_images=frames[1:], duration=[3000, 3000], loop=0, optimize=True)
