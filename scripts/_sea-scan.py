import os
from PIL import Image

OUT = "out/seacheck"
FILL = 79.4  # flat fill luma reference

def is_sea(r, g, b):
    # teal/blue water: blue not far below green, and blue clearly above red
    return (b >= g - 18) and (b > r + 4)

for z in ["10.72", "10.9", "11.08"]:
    img = Image.open(os.path.join(OUT, f"z{z}.png")).convert("RGB")
    W, H = img.size
    lumas = []
    for y in range(480, min(H, 900), 8):
        for x in range(40, min(W, 1440), 8):
            r, g, b = img.getpixel((x, y))
            if is_sea(r, g, b):
                lumas.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    if lumas:
        lumas.sort()
        med = lumas[len(lumas) // 2]
        n = len(lumas)
        fill_frac = sum(1 for l in lumas if 74 <= l <= 84) / n * 100
        dark_frac = sum(1 for l in lumas if l < 70) / n * 100
        bright_frac = sum(1 for l in lumas if l > 85) / n * 100
        print(f"z{z}: sea-px={n} median={med:.0f}  fill~79:{fill_frac:.0f}%  dark<70:{dark_frac:.0f}%  bright>85:{bright_frac:.0f}%")
    else:
        print(f"z{z}: no sea pixels found")
