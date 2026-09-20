#!/usr/bin/env python3
"""
Generates every Masari app icon from one definition.

The icons are produced rather than drawn by hand so the whole set stays in
step: a launcher icon, an Android adaptive pair, a themed monochrome icon, a
notification icon, a splash mark and a favicon all have to agree, and hand
editing six files is how they stop agreeing.

The mark is the letter م — the first letter of مصاري — inside a coin. A full
word is unreadable at 48px and Android's adaptive mask crops the sides of
anything wide, so the word itself appears only on the splash, where there is
room for it.

    python3 scripts/brand/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets"
FONT = Path(__file__).resolve().parent / "Cairo-Bold.ttf"

# Straight from src/theme/tokens.ts, so the icon and the app cannot drift apart.
RED = (236, 48, 19, 255)        # accent
DEEP = (158, 53, 38, 255)       # accentDeep
WHITE = (255, 255, 255, 255)

# Render at 4x and downsample. PIL has no antialiased draw, so this is what
# keeps the ring and the letter edges clean instead of stair-stepped.
SS = 4

# Arabic is shaped by Pillow itself, through HarfBuzz. The obvious-looking
# alternative — running the text through arabic_reshaper — converts it to
# Unicode presentation forms (U+FExx), and a modern font like Cairo does not
# contain those codepoints at all: every letter renders as an empty box. Raw
# text plus direction="rtl" is both correct and simpler.
RTL = {"direction": "rtl", "language": "ar"}


def fit_font(text: str, box: int) -> ImageFont.FreeTypeFont:
    """Largest size whose rendered width and height both fit `box`."""
    size = box
    while size > 8:
        f = ImageFont.truetype(str(FONT), size)
        l, t, r, b = f.getbbox(text, **RTL)
        if (r - l) <= box and (b - t) <= box:
            return f
        size -= 2
    return ImageFont.truetype(str(FONT), 8)


def draw_centred(d: ImageDraw.ImageDraw, xy, text, font, fill):
    """Centres on the INK box, not the font metrics — Arabic sits high in the
    em square, so centring by line height leaves it visibly low."""
    cx, cy = xy
    l, t, r, b = d.textbbox((0, 0), text, font=font, **RTL)
    d.text((cx - (l + r) / 2, cy - (t + b) / 2), text, font=font, fill=fill, **RTL)


def coin(size: int, bg, fg, ring, *, ring_width: float = 0.035, pad: float = 0.0):
    """The mark: a letter inside a ring. `pad` leaves room for a mask to crop."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    inset = n * pad
    box = [inset, inset, n - inset, n - inset]

    if bg is not None:
        d.ellipse(box, fill=bg)

    if ring is not None:
        w = max(1, int(n * ring_width))
        gap = (n - 2 * inset) * 0.085
        d.ellipse(
            [box[0] + gap, box[1] + gap, box[2] - gap, box[3] - gap],
            outline=ring,
            width=w,
        )

    inner = int((n - 2 * inset) * 0.46)
    draw_centred(d, (n / 2, n / 2 + n * 0.01), "م", fit_font("م", inner), fg)

    return img.resize((size, size), Image.LANCZOS)


def launcher(size: int) -> Image.Image:
    """Full-bleed icon: the coin on brand red, rounded like a store listing."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, n, n], radius=int(n * 0.22), fill=RED)
    img = img.resize((size, size), Image.LANCZOS)
    img.alpha_composite(coin(size, None, WHITE, WHITE, ring_width=0.03, pad=0.17))
    return img


def splash(size: int) -> Image.Image:
    """The one place the whole word fits: mark above, مصاري beneath it."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    mark_px = int(n * 0.44)
    mark = coin(mark_px, RED, WHITE, WHITE, ring_width=0.032, pad=0.02)
    img.alpha_composite(mark, (int((n - mark_px) / 2), int(n * 0.14)))

    d = ImageDraw.Draw(img)
    draw_centred(d, (n / 2, n * 0.755), "مصاري", fit_font("مصاري", int(n * 0.50)), DEEP)

    return img.resize((size, size), Image.LANCZOS)


def write(img: Image.Image, name: str, mode: str = "RGBA"):
    path = ASSETS / name
    img.convert(mode).save(path)
    print(f"  {name:34} {img.size[0]}x{img.size[1]}  {path.stat().st_size / 1024:6.1f} KB")


def main():
    if not FONT.exists():
        raise SystemExit(f"Missing font: {FONT}")
    ASSETS.mkdir(exist_ok=True)
    print("Writing Masari icons:")

    # Store / iOS / general. No alpha: the stores reject a transparent icon.
    write(launcher(1024), "icon.png", "RGB")

    # Android adaptive: background and foreground are masked together, and only
    # the middle ~66% is guaranteed visible, so the mark is inset to survive a
    # circular, squircle or teardrop mask on any launcher.
    write(Image.new("RGBA", (512, 512), RED), "android-icon-background.png")
    write(coin(512, None, WHITE, WHITE, ring_width=0.03, pad=0.19), "android-icon-foreground.png")

    # Themed icons and the notification icon: Android tints these itself, so
    # they must be one flat colour on transparency — any colour here is thrown
    # away, and a filled shape would show as a solid blob in the status bar.
    write(coin(432, None, WHITE, WHITE, ring_width=0.035, pad=0.20), "android-icon-monochrome.png")

    write(splash(1024), "splash-icon.png")

    # At 48px the ring closes up and the letter loses its counters, so the
    # favicon drops the ring and carries the letter alone.
    write(coin(48, RED, WHITE, None, pad=0.0), "favicon.png")

    print("\nDone.")


if __name__ == "__main__":
    main()
