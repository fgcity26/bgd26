#!/usr/bin/env python3
"""Render clean, brand-consistent placeholder photos for the sample catalogue.

Why placeholders: the deployment's image-generation credential is invalid and
stock-photo sites block automated downloads. These cards are generated locally,
carry no third-party rights, and are replaced the moment the owner uploads real
photos through the product form.

Output: 1000x1000 JPEG per slug, written to the directory given as argv[1].
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

INK = (15, 23, 42)
MUTED = (71, 85, 105)
BRAND = (0, 106, 78)
BRAND_DARK = (0, 74, 55)
LINE = 12

PRODUCTS = [
    ("engraved-wooden-name-plate", "Engraved Wooden Name Plate", "gift"),
    ("acrylic-led-photo-lamp", "Personalised Acrylic LED Photo Lamp", "lamp"),
    ("engraved-wooden-keyring-set", "Engraved Wooden Keyring Set", "keyring"),
    ("engraved-wooden-wall-plaque", "Engraved Wooden Wall Plaque", "plaque"),
    ("minimal-oak-wall-clock", "Minimal Oak Wall Clock", "clock"),
    ("custom-photo-wall-clock", "Custom Photo Wall Clock", "photoclock"),
    ("silent-metal-wall-clock", "Silent Metal Wall Clock", "clockbold"),
    ("wireless-earbuds-pro", "Wireless Earbuds Pro", "earbuds"),
    ("amoled-smart-watch", "AMOLED Smart Watch", "watch"),
    ("portable-bluetooth-speaker", "Portable Bluetooth Speaker", "speaker"),
    ("corporate-gift-box", "Corporate Gift Box", "box"),
    ("wedding-gift-hamper", "Wedding Gift Hamper", "hamper"),
]


def font(path, size):
    return ImageFont.truetype(path, size)


def rounded(draw, box, radius, outline=None, width=LINE, fill=None):
    draw.rounded_rectangle(box, radius=radius, outline=outline, width=width, fill=fill)


def background(size=1000):
    top = (244, 249, 246)
    bottom = (226, 239, 232)
    image = Image.new("RGB", (size, size), top)
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / size
        colour = tuple(
            int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3)
        )
        draw.line([(0, y), (size, y)], fill=colour)
    glow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow).ellipse((520, -180, 1180, 480), fill=70)
    image.paste(Image.new("RGB", (size, size), (255, 255, 255)), (0, 0), glow)
    return image


def icon(draw, kind, cx, cy):
    """Draw a simple line-art glyph centred on (cx, cy)."""
    w = LINE

    if kind in ("clock", "photoclock", "clockbold"):
        box = (cx - 150, cy - 150, cx + 150, cy + 150)
        draw.ellipse(box, outline=BRAND_DARK, width=w + (6 if kind == "clockbold" else 0))
        if kind == "photoclock":
            inner = (cx - 108, cy - 108, cx + 108, cy + 108)
            draw.ellipse(inner, outline=BRAND, width=6)
            draw.polygon(
                [(cx - 70, cy + 40), (cx - 20, cy - 30), (cx + 10, cy + 10),
                 (cx + 40, cy - 40), (cx + 82, cy + 40)],
                outline=BRAND,
            )
            draw.ellipse((cx + 34, cy - 62, cx + 62, cy - 34), outline=BRAND, width=6)
        else:
            for angle in range(0, 360, 30):
                rad = math.radians(angle)
                draw.line(
                    [
                        (cx + 128 * math.sin(rad), cy - 128 * math.cos(rad)),
                        (cx + 112 * math.sin(rad), cy - 112 * math.cos(rad)),
                    ],
                    fill=BRAND,
                    width=6,
                )
        draw.line([(cx, cy), (cx, cy - 92)], fill=BRAND_DARK, width=w)
        draw.line([(cx, cy), (cx + 70, cy + 34)], fill=BRAND_DARK, width=w)
        draw.ellipse((cx - 10, cy - 10, cx + 10, cy + 10), fill=BRAND_DARK)

    elif kind == "watch":
        draw.rounded_rectangle(
            (cx - 92, cy - 92, cx + 92, cy + 92), radius=34, outline=BRAND_DARK, width=w
        )
        draw.rectangle((cx - 56, cy - 190, cx + 56, cy - 92), outline=BRAND_DARK, width=w)
        draw.rectangle((cx - 56, cy + 92, cx + 56, cy + 190), outline=BRAND_DARK, width=w)
        draw.line([(cx, cy), (cx, cy - 54)], fill=BRAND, width=8)
        draw.line([(cx, cy), (cx + 40, cy + 22)], fill=BRAND, width=8)

    elif kind == "earbuds":
        for offset in (-64, 64):
            draw.rounded_rectangle(
                (cx + offset - 34, cy - 120, cx + offset + 34, cy + 20),
                radius=32,
                outline=BRAND_DARK,
                width=w,
            )
            draw.ellipse(
                (cx + offset - 30, cy - 160, cx + offset + 30, cy - 100),
                outline=BRAND,
                width=8,
            )
        rounded(draw, (cx - 150, cy + 50, cx + 150, cy + 170), 40, outline=BRAND_DARK)

    elif kind == "speaker":
        rounded(draw, (cx - 120, cy - 160, cx + 120, cy + 160), 46, outline=BRAND_DARK)
        for row in range(3):
            for col in range(3):
                px = cx - 56 + col * 56
                py = cy - 56 + row * 56
                draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill=BRAND)
        draw.arc(
            (cx + 60, cy - 200, cx + 150, cy - 110), start=200, end=340, fill=BRAND, width=8
        )

    elif kind == "keyring":
        draw.ellipse((cx - 168, cy - 60, cx - 78, cy + 30), outline=BRAND_DARK, width=w)
        rounded(draw, (cx - 60, cy - 110, cx + 150, cy + 80), 30, outline=BRAND_DARK)
        draw.ellipse((cx + 112, cy - 84, cx + 136, cy - 60), fill=BRAND)
        for row in range(2):
            draw.line(
                [(cx - 20, cy - 40 + row * 50), (cx + 96, cy - 40 + row * 50)],
                fill=BRAND,
                width=8,
            )

    elif kind == "lamp":
        rounded(draw, (cx - 130, cy - 170, cx + 130, cy + 80), 18, outline=BRAND_DARK)
        draw.polygon(
            [(cx - 86, cy + 42), (cx - 30, cy - 44), (cx + 6, cy - 2),
             (cx + 38, cy - 60), (cx + 94, cy + 42)],
            outline=BRAND,
        )
        draw.ellipse((cx + 44, cy - 108, cx + 78, cy - 74), outline=BRAND, width=6)
        rounded(draw, (cx - 82, cy + 80, cx + 82, cy + 132), 14, fill=BRAND, outline=BRAND)
        for dx in (-180, -150, 150, 180):
            draw.line([(cx + dx, cy - 60), (cx + dx, cy + 30)], fill=BRAND, width=6)

    elif kind == "plaque":
        rounded(draw, (cx - 170, cy - 130, cx + 170, cy + 130), 22, outline=BRAND_DARK)
        draw.polygon(
            [(cx, cy - 90), (cx + 90, cy), (cx, cy + 90), (cx - 90, cy)],
            outline=BRAND,
        )
        draw.polygon(
            [(cx, cy - 44), (cx + 44, cy), (cx, cy + 44), (cx - 44, cy)],
            outline=BRAND,
        )
        draw.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=BRAND)

    elif kind == "box":
        rounded(draw, (cx - 150, cy - 70, cx + 150, cy + 130), 18, outline=BRAND_DARK)
        rounded(draw, (cx - 150, cy - 130, cx + 150, cy - 60), 16, outline=BRAND_DARK)
        draw.line([(cx, cy - 130), (cx, cy + 130)], fill=BRAND, width=10)
        draw.line([(cx - 40, cy - 130), (cx - 40, cy - 60)], fill=BRAND, width=8)
        draw.line([(cx + 40, cy - 130), (cx + 40, cy - 60)], fill=BRAND, width=8)

    elif kind == "hamper":
        rounded(draw, (cx - 160, cy - 50, cx + 160, cy + 130), 20, outline=BRAND_DARK)
        draw.arc((cx - 70, cy - 160, cx + 70, cy - 20), start=180, end=360, fill=BRAND_DARK, width=w)
        draw.line([(cx - 160, cy - 50), (cx + 160, cy - 50)], fill=BRAND, width=10)
        draw.ellipse((cx - 90, cy - 24, cx - 30, cy + 36), outline=BRAND)
        draw.ellipse((cx - 10, cy - 24, cx + 50, cy + 36), outline=BRAND)
        draw.polygon(
            [(cx - 130, cy + 60), (cx - 90, cy + 60), (cx - 110, cy + 110)],
            fill=BRAND,
        )

    else:  # generic tag
        rounded(draw, (cx - 130, cy - 90, cx + 130, cy + 90), 24, outline=BRAND_DARK)
        draw.ellipse((cx - 96, cy - 20, cx - 56, cy + 20), fill=BRAND)


def card(slug, title, kind):
    size = 1000
    image = background(size)
    draw = ImageDraw.Draw(image)

    # Medallion
    draw.ellipse((250, 170, 750, 670), fill=(255, 255, 255))
    draw.ellipse((250, 170, 750, 670), outline=(198, 220, 210), width=6)
    icon(draw, kind, 500, 420)

    title_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 46)
    brand_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)

    # Wrap the title on two lines when needed.
    words = title.split()
    lines, current = [], ""
    for word in words:
        trial = f"{current} {word}".strip()
        width = draw.textlength(trial, font=title_font)
        if width > 820 and current:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)

    y = 730
    for line in lines:
        width = draw.textlength(line, font=title_font)
        draw.text(((size - width) / 2, y), line, fill=INK, font=title_font)
        y += 58

    # Brand hairline + sample chip
    draw.line([(430, 862), (570, 862)], fill=(180, 205, 195), width=3)
    chip = "SAMPLE PHOTO"
    chip_width = draw.textlength(chip, font=brand_font)
    draw.rounded_rectangle(
        ((size - chip_width) / 2 - 22, 892, (size + chip_width) / 2 + 22, 942),
        radius=24,
        fill=(232, 243, 238),
    )
    draw.text(((size - chip_width) / 2, 901), chip, fill=BRAND, font=brand_font)

    out = os.path.join(sys.argv[1], f"{slug}.jpg")
    image.save(out, "JPEG", quality=86, optimize=True)
    return out


def main():
    target = sys.argv[1]
    os.makedirs(target, exist_ok=True)
    for slug, title, kind in PRODUCTS:
        path = card(slug, title, kind)
        print(f"{slug}.jpg  {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
