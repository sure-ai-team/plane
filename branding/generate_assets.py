"""
Regenerate raster brand assets (favicons, app icons, logos, spinners, illustrations)
from branding/brand.json and the vector logo described in branding/logo.py.

    python branding/generate_assets.py

Needs Pillow and Google Chrome (used headless to render the SVG logo).
Set CHROME_PATH if Chrome is not in a standard location. Every file keeps its path,
format and pixel size, so no code that imports these assets has to change.
"""

import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import logo  # noqa: E402

ROOT = logo.ROOT
BRAND = logo.BRAND
C = BRAND["colors"]

CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
    shutil.which("chromium-browser") or "",
]
CHROME = next((c for c in CHROME_CANDIDATES if c and Path(c).exists()), None)
if not CHROME:
    raise SystemExit("Google Chrome not found. Set CHROME_PATH to the Chrome executable.")

TMP = Path(tempfile.mkdtemp(prefix="brand-assets-"))
_cache = {}


def render(svg, width, height):
    """Render SVG markup to an RGBA image of exactly width x height (transparent background)."""
    key = (svg, width, height)
    if key in _cache:
        return _cache[key].copy()
    scale = max(1, math.ceil(512 / max(width, height)))
    rw, rh = width * scale, height * scale
    html = TMP / f"r{len(_cache)}.html"
    png = TMP / f"r{len(_cache)}.png"
    html.write_text(
        "<html><head><style>html,body{margin:0;background:transparent;overflow:hidden}"
        f"svg{{display:block;width:{rw}px;height:{rh}px}}</style></head><body>{svg}</body></html>",
        encoding="utf-8",
    )
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
         f"--window-size={rw},{rh}", f"--screenshot={png}", html.as_uri()],
        check=True, capture_output=True, timeout=60,
    )
    img = Image.open(png).convert("RGBA").crop((0, 0, rw, rh))
    if scale > 1:
        img = img.resize((width, height), Image.LANCZOS)
    _cache[key] = img
    return img.copy()


def fit(svg, box_w, box_h, aspect):
    """Render svg (with intrinsic aspect w/h) as large as fits in box, return image."""
    w = box_w
    h = round(w / aspect)
    if h > box_h:
        h = box_h
        w = round(h * aspect)
    return render(svg, max(1, w), max(1, h))


def hex_rgba(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4)) + (a,)


def icon(size):
    return render(logo.icon_svg(), size, size)


def lockup(width, height, text_color):
    svg = logo.lockup_svg(text_color)
    aspect = logo.lockup_width() / logo.LOCKUP_H
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    img = fit(svg, round(width * 0.94), round(height * 0.86), aspect)
    canvas.alpha_composite(img, ((width - img.width) // 2, (height - img.height) // 2))
    return canvas


def full_logo(box_w, box_h, text_color=None):
    _, _, w, h = logo.BBOX_FULL
    return fit(logo.full_svg(text_color), box_w, box_h, (w + 8) / (h + 8))


def save_icon(path, size):
    img = icon(size)
    if path.suffix == ".ico":
        img = icon(256)
        img.save(path, sizes=[(16, 16), (32, 32), (48, 48)])
    else:
        img.save(path)


def spinner(size, path):
    w, h = size
    base = icon(round(min(w, h) * 0.42))
    frames = []
    for i in range(48):
        t = i / 48
        pulse = 0.5 + 0.5 * math.sin(2 * math.pi * t)
        m = base.resize((max(1, round(base.width * (0.9 + 0.1 * pulse))),) * 2, Image.LANCZOS)
        alpha = 0.55 + 0.45 * pulse
        m.putalpha(m.getchannel("A").point(lambda a: int(a * alpha)))
        frame = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        frame.alpha_composite(m, ((w - m.width) // 2, (h - m.height) // 2))
        frames.append(frame)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=30, loop=0, disposal=2)


def confetti(size, path, center):
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(7)
    palette = [C["primary"], C["accent"], "#A9C4FF", C["dark"]]
    s_max = max(6, min(w, h) // 30)
    # Keep confetti clear of the centered logo
    lx0, ly0 = (w - center.width) // 2 - s_max, (h - center.height) // 2 - s_max
    lx1, ly1 = lx0 + center.width + 2 * s_max, ly0 + center.height + 2 * s_max
    placed = 0
    while placed < 30:
        x, y, s = rnd.randint(0, w), rnd.randint(0, h), rnd.randint(s_max // 2, s_max)
        if x + s > lx0 and x < lx1 and y + s > ly0 and y < ly1:
            continue
        d.rectangle([x, y, x + s, y + s], fill=hex_rgba(rnd.choice(palette)))
        placed += 1
    img.alpha_composite(center, ((w - center.width) // 2, (h - center.height) // 2))
    img.save(path, quality=90)


def banner(size, path):
    """Wide 'not ready' illustration: lockup on a ground line with two cones."""
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ground = round(h * 0.93)
    d.rectangle([0, ground, w, ground + max(4, h // 60)], fill=hex_rgba(C["light"]))
    lk = lockup(round(w * 0.42), round(h * 0.55), C["text"])
    img.alpha_composite(lk, (round(w * 0.04), ground - lk.height - round(h * 0.08)))
    for cx, ch in ((0.52, 0.24), (0.56, 0.16)):
        x, ht = round(w * cx), round(h * ch)
        d.polygon([(x - ht * 0.35, ground), (x + ht * 0.35, ground), (x, ground - ht)], fill=hex_rgba(C["primary"]))
    img.save(path, quality=90)


def cards(size, path):
    """Three tilted cards in brand colors, the decorative auth background."""
    w, h = size
    s = 4
    big = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
    cw, chh = round(w * 0.46) * s, round(h * 0.6) * s
    for i, col in enumerate([C["dark"], C["primary"], C["accent"]]):
        card = Image.new("RGBA", (cw, chh), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        top, bottom = hex_rgba(col, 235), hex_rgba(C["light"], 200)
        for y in range(chh):
            t = y / chh
            cd.line([(0, y), (cw, y)], fill=tuple(round(top[j] * (1 - t) + bottom[j] * t) for j in range(4)))
        mask = Image.new("L", (cw, chh), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, chh - 1], radius=cw // 9, fill=255)
        card.putalpha(mask)
        sheared = card.transform((cw, chh + cw // 2), Image.AFFINE, (1, 0, 0, -0.45, 1, 0), resample=Image.BICUBIC)
        big.alpha_composite(sheared, (round(i * w * 0.255) * s, 0))
    big.resize((w, h), Image.LANCZOS).save(path, quality=90)


def og_image(size, path):
    w, h = size
    img = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, h - 18, w, h], fill=hex_rgba(C["primary"]))
    lk = lockup(round(w * 0.8), round(h * 0.4), C["text"])
    img.alpha_composite(lk, ((w - lk.width) // 2, (h - lk.height) // 2 - 10))
    img.convert("RGB").save(path)


def replace_badge(path):
    """Paint the SURE icon over the round blue brand badge near the bottom of an illustration."""
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    xs, ys = [], []
    px = img.load()
    for y in range(h // 2, h, 2):
        for x in range(0, w, 2):
            r, g, b, a = px[x, y]
            if a > 200 and b > 150 and b - r > 80 and b - g > 50:
                xs.append(x)
                ys.append(y)
    if not xs:
        print(f"  no badge found in {path.name}, skipped")
        return False
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    d = max(x1 - x0, y1 - y0) + 6
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    ss = 4
    disc = Image.new("RGBA", (d * ss, d * ss), (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse([0, 0, d * ss - 1, d * ss - 1], fill=hex_rgba(C["primary"]))
    disc = disc.resize((d, d), Image.LANCZOS)
    mark = render(logo.icon_svg(bg="none", text_fill="#FFFFFF").replace('fill="' + C["primary"] + '"', 'fill="#FFFFFF"'), round(d * 0.75), round(d * 0.75))
    disc.alpha_composite(mark, ((d - mark.width) // 2, (d - mark.height) // 2))
    img.alpha_composite(disc, (cx - d // 2, cy - d // 2))
    img.save(path)
    return True


def main():
    done = []

    def add(p):
        done.append(p)

    # Square icons everywhere
    icon_files = []
    for app in ("web", "admin", "space"):
        fav = ROOT / f"apps/{app}/app/assets/favicon"
        icon_files += [p for p in fav.glob("*") if p.suffix in (".png", ".ico")]
        icon_files += list((ROOT / f"apps/{app}/public/favicon").glob("android-chrome-*.png"))
    icon_files += list((ROOT / "apps/web/public/icons").glob("icon-*.png"))
    icon_files += list((ROOT / "apps/web/app/assets/icons").glob("icon-*.png"))
    icon_files += [ROOT / "apps/web/public/plane-logos/plane-mobile-pwa.png"]
    icon_files += list(ROOT.glob("apps/*/app/assets/plane-logos/blue-without-text*.png"))
    for p in icon_files:
        if p.exists():
            size = 48 if p.suffix == ".ico" else Image.open(p).size[0]
            save_icon(p, size)
            add(p)

    # Spinners
    for p in ROOT.glob("apps/*/app/assets/images/logo-spinner-*.gif"):
        spinner(Image.open(p).size, p)
        add(p)

    # Horizontal logos
    for p in ROOT.glob("apps/*/app/assets/plane-logos/*-horizontal-with-blue-logo.png"):
        w, h = Image.open(p).size
        lockup(w, h, C["text"] if p.name.startswith("black") else "#FFFFFF").save(p)
        add(p)
    email_logo = ROOT / "apps/api/plane/static/logos/Logo.png"
    if email_logo.exists():
        w, h = Image.open(email_logo).size
        lockup(w, h, C["text"]).save(email_logo)
        add(email_logo)

    # Illustrations
    for p in ROOT.glob("apps/*/app/assets/**/plane-takeoff.png"):
        w, h = Image.open(p).size
        confetti((w, h), p, full_logo(round(w * 0.5), round(h * 0.7)))
        add(p)
    setup_done = ROOT / "apps/web/app/assets/instance-setup-done.webp"
    if setup_done.exists():
        w, h = Image.open(setup_done).size
        confetti((w, h), setup_done, full_logo(round(w * 0.4), round(h * 0.55)))
        add(setup_done)
    for p in [ROOT / "apps/space/app/assets/instance/plane-instance-not-ready.webp", ROOT / "apps/web/app/assets/instance-not-ready.webp"]:
        if p.exists():
            banner(Image.open(p).size, p)
            add(p)
    for name in ("gradient-bg-logo.webp", "gradient-logo.webp"):
        p = ROOT / "apps/web/app/assets/auth" / name
        if p.exists():
            cards(Image.open(p).size, p)
            add(p)
    og = ROOT / "apps/web/app/assets/og-image.png"
    if og.exists():
        og_image(Image.open(og).size, og)
        add(og)

    # Illustrations that carry the brand badge
    for rel in [
        "apps/web/app/assets/workspace/workspace-creation-disabled.png",
        "apps/web/app/assets/workspace/workspace-not-available.png",
        "apps/space/app/assets/instance/intake-sent-light.png",
        "apps/space/app/assets/instance/intake-sent-dark.png",
    ]:
        p = ROOT / rel
        if p.exists() and replace_badge(p):
            add(p)

    for p in done:
        print(p.relative_to(ROOT).as_posix())
    print(f"{len(done)} assets regenerated")
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
