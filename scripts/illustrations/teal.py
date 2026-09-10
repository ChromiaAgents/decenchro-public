#!/usr/bin/env python3
"""ian-xiaohei PNG (ink on white) -> transparent. PIL-only, no numpy.
Modes:
  teal  : duotone — all ink recoloured to brand teal #0e7569 (default)
  clear : keep original colours, only knock white background to transparent
Alpha ramps by luminance so anti-aliased edges fade out (no white halo).
Usage: post.py in.png out.png [teal|clear] [trim]
"""
import sys
from PIL import Image

TEAL = (14, 117, 105)
WHITE_CUT = 244   # lum >= this -> transparent
INK_FLOOR = 60    # lum <= this -> opaque

src, dst = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "teal"
trim = "trim" in sys.argv[3:]


def amap(l):
    if l >= WHITE_CUT:
        return 0
    if l <= INK_FLOOR:
        return 255
    return int((WHITE_CUT - l) / (WHITE_CUT - INK_FLOOR) * 255)


lum = Image.open(src).convert("L")
alpha = lum.point(amap)

if mode == "teal":
    out = Image.new("RGBA", lum.size, TEAL + (0,))
    out.putalpha(alpha)
else:  # clear
    out = Image.open(src).convert("RGBA")
    out.putalpha(alpha)

if trim:
    bb = out.getbbox()
    if bb:
        p = 12
        l, t, r, b = bb
        out = out.crop((max(0, l - p), max(0, t - p),
                        min(out.width, r + p), min(out.height, b + p)))

out.save(dst)
print(f"{mode} -> {dst} {out.size}")
