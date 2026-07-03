#!/usr/bin/env python3
"""Generate Prep Tracker app icons: a blue barbell glyph on the app's dark
charcoal background. Drawn at 4x and downscaled for clean anti-aliasing.

Maskable safe zone: all glyph geometry stays inside the central circle of
radius 0.4 * size (icon may be cropped to a circle/squircle by the OS).
"""
from PIL import Image, ImageDraw

BG = '#16171a'   # --ink
FG = '#2f74d0'   # --red (blue accent)

SS = 4  # supersample factor


def draw_barbell(d, s):
    """Draw in a 512-unit design space scaled by s."""
    def rr(x0, y0, x1, y1, r):
        d.rounded_rectangle([x0 * s, y0 * s, x1 * s, y1 * s], radius=r * s, fill=FG)

    cy = 256
    # bar (through the middle, past the outer plates)
    rr(70, cy - 12, 442, cy + 12, 12)
    # inner plates (tall)
    rr(136, cy - 90, 180, cy + 90, 16)
    rr(332, cy - 90, 376, cy + 90, 16)
    # outer plates (shorter)
    rr(92, cy - 62, 128, cy + 62, 14)
    rr(384, cy - 62, 420, cy + 62, 14)


def make(size, path):
    big = 512 * SS
    img = Image.new('RGB', (big, big), BG)
    draw_barbell(ImageDraw.Draw(img), SS)
    img.resize((size, size), Image.LANCZOS).save(path)
    print(path, size)


# iOS ignores manifest background_color for the standalone launch screen —
# without these a cold launch flashes white. One image per device size
# (pt width, pt height, scale); iOS only uses an exact match.
SPLASH = [
    (375, 812, 3),   # X / XS / 11 Pro / 12-13 mini
    (390, 844, 3),   # 12 / 13 / 14
    (393, 852, 3),   # 14 Pro / 15 / 16
    (402, 874, 3),   # 16 Pro / 17 Pro
    (414, 896, 2),   # XR / 11
    (414, 896, 3),   # XS Max / 11 Pro Max
    (428, 926, 3),   # 12-13 Pro Max / 14 Plus
    (430, 932, 3),   # 14 Pro Max / 15-16 Plus / 15 Pro Max
    (440, 956, 3),   # 16 Pro Max / 17 Pro Max
]


def make_splash(w, h, scale):
    pw, ph = w * scale, h * scale
    big = Image.new('RGB', (pw * 2, ph * 2), BG)
    d = ImageDraw.Draw(big)
    # barbell centered at ~42% of the screen width, same geometry as the icon
    s = (pw * 2) * 0.42 / 512
    ox = (pw * 2 - 512 * s) / 2
    oy = (ph * 2 - 512 * s) / 2

    def rr(x0, y0, x1, y1, r):
        d.rounded_rectangle([ox + x0 * s, oy + y0 * s, ox + x1 * s, oy + y1 * s], radius=r * s, fill=FG)

    cy = 256
    rr(70, cy - 12, 442, cy + 12, 12)
    rr(136, cy - 90, 180, cy + 90, 16)
    rr(332, cy - 90, 376, cy + 90, 16)
    rr(92, cy - 62, 128, cy + 62, 14)
    rr(384, cy - 62, 420, cy + 62, 14)

    path = f'icons/splash-{pw}x{ph}.png'
    big.resize((pw, ph), Image.LANCZOS).save(path, optimize=True)
    print(path)


def splash_links():
    for w, h, scale in SPLASH:
        print(f'<link rel="apple-touch-startup-image" media="(device-width: {w}px) and (device-height: {h}px) '
              f'and (-webkit-device-pixel-ratio: {scale}) and (orientation: portrait)" '
              f'href="icons/splash-{w * scale}x{h * scale}.png">')


if __name__ == '__main__':
    make(192, 'icons/icon-192.png')
    make(512, 'icons/icon-512.png')
    make(180, 'icons/apple-touch-icon.png')
    for w, h, scale in SPLASH:
        make_splash(w, h, scale)
    splash_links()
