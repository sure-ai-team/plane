"""Logo geometry for the SURE (Sure Global Tech) brand, shared by rebrand.py and generate_assets.py.

The source is the official vector logo in branding/sgt/sure-logo.svg. Its shapes are
used in document order:
  Paths and polygons, in order (circles and rects are the Arabic dots):
  0-4    "sure" wordmark (2 is the blue flag on the "r", 3 is the "r" stem)
  5-6    Arabic name above the wordmark
  7-20   "SURE GLOBAL TECH"
  21-25  Arabic company name
Bounding boxes below were measured in the SVG's own units with a browser (getBBox).
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = json.loads((ROOT / "branding" / "brand.json").read_text(encoding="utf-8"))
BLUE = BRAND["colors"]["primary"]

WORDMARK = list(range(0, 5))
FULL = list(range(0, 26))
ICON = [2, 3]
FLAG = 2

# x, y, width, height
BBOX_WORDMARK = (10.12, 61.87, 206.48, 60.84)
BBOX_ICON = (124.67, 63.47, 38.75, 59.04)
BBOX_FULL = (10.12, 7.54, 206.49, 170.09)


def _shapes():
    svg = (ROOT / BRAND["logo_svg"]).read_text(encoding="utf-8")
    found = re.findall(r'<(path|polygon)\b[^>]*?class="(cls-\d)"[^>]*?\b(d|points)="([^"]+)"', svg)
    if len(found) != 26:
        raise SystemExit(f"Unexpected logo structure: found {len(found)} shapes, expected 26")
    return found


SHAPES = _shapes()


def _all_elements():
    """Every drawable element in document order, including the dots drawn as circles and rects."""
    svg = (ROOT / BRAND["logo_svg"]).read_text(encoding="utf-8")
    return re.findall(r'<(?:path|polygon|circle|rect|ellipse)\b[^>]*?/?>', svg)


ALL_ELEMENTS = _all_elements()


def fragment(indices, text_fill, jsx=False, flag_fill=BLUE):
    """SVG elements for the given shapes. text_fill is a color, or a JSX expression when jsx=True."""
    out = []
    for i in indices:
        tag, cls, attr, data = SHAPES[i]
        fill = flag_fill if cls == "cls-2" else text_fill
        fill_attr = f'fill="{fill}"' if (not jsx or fill.startswith("#")) else f"fill={{{fill}}}"
        out.append(f'<{tag} {attr}="{data}" {fill_attr} />')
    return out


def viewbox(bbox, pad=0.0):
    x, y, w, h = bbox
    return f"{x - pad:.2f} {y - pad:.2f} {w + 2 * pad:.2f} {h + 2 * pad:.2f}"


# Lockup: wordmark, a divider, and two lines of product name.
LOCKUP_H = 61
LOCKUP_TEXT_X = 240
LOCKUP_FONT = 21


def lockup_width():
    longest = max(len(line) for line in BRAND["lockup_lines"])
    return round(LOCKUP_TEXT_X + longest * LOCKUP_FONT * 0.56 + 6)


def lockup_parts(text_fill, jsx=False):
    """Inner elements of the lockup, in a 0 0 lockup_width() 61 box."""
    x, y, _, _ = BBOX_WORDMARK
    fill = f"fill={{{text_fill}}}" if jsx else f'fill="{text_fill}"'
    lines = BRAND["lockup_lines"]
    font = 'fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"' if jsx else 'font-family="Inter, Segoe UI, Arial, sans-serif"'
    weight = "fontWeight" if jsx else "font-weight"
    size = "fontSize" if jsx else "font-size"
    opacity = "opacity" if jsx else "opacity"
    parts = [f'<g transform="translate({-x} {-y + 0.08})">'] + fragment(WORDMARK, text_fill, jsx) + ["</g>"]
    parts.append(f'<rect x="221" y="8" width="1.6" height="45" {fill} {opacity}="0.25" />')
    parts.append(f'<text x="{LOCKUP_TEXT_X}" y="27" {font} {weight}="600" {size}="{LOCKUP_FONT}" {fill}>{lines[0]}</text>')
    if len(lines) > 1:
        parts.append(f'<text x="{LOCKUP_TEXT_X}" y="52" {font} {weight}="400" {size}="{LOCKUP_FONT}" {fill} {opacity}="0.75">{lines[1]}</text>')
    return parts


def icon_svg(size=None, bg=None, text_fill="#FFFFFF"):
    """Square app icon: the "r" with its blue flag on a dark rounded tile."""
    bg = bg or BRAND["colors"]["dark"]
    x, y, w, h = BBOX_ICON
    side = h * 1.5
    cx, cy = x + w / 2, y + h / 2
    ox, oy = cx - side / 2, cy - side / 2
    dims = f' width="{size}" height="{size}"' if size else ""
    body = "".join(fragment(ICON, text_fill))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg"{dims} viewBox="{ox:.2f} {oy:.2f} {side:.2f} {side:.2f}">'
        f'<rect x="{ox:.2f}" y="{oy:.2f}" width="{side:.2f}" height="{side:.2f}" rx="{side * 0.22:.2f}" fill="{bg}"/>'
        f"{body}</svg>"
    )


def full_svg(text_fill=None):
    text_fill = text_fill or BRAND["colors"]["text"]
    body = "".join(
        el.replace('class="cls-2"', f'fill="{BLUE}"').replace('class="cls-1"', f'fill="{text_fill}"')
        for el in ALL_ELEMENTS
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox(BBOX_FULL, 4)}">{body}</svg>'


def lockup_svg(text_fill=None):
    text_fill = text_fill or BRAND["colors"]["text"]
    body = "".join(lockup_parts(text_fill))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {lockup_width()} {LOCKUP_H}">{body}</svg>'
