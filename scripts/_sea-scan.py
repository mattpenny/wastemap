import os, re
from PIL import Image

OUT = "out/seacheck"
FILL = 79.4  # flat fill luma reference

def is_sea(r, g, b):
    # teal/blue water: blue not far below green, and blue clearly above red
    return (b >= g - 18) and (b > r + 4)

files = sorted(
    [f for f in os.listdir(OUT) if re.fullmatch(r"z[\d.]+\.png", f)],
    key=lambda f: float(f[1:-4]),
)
for fname in files:
    z = fname[1:-4]
    img = Image.open(os.path.join(OUT, fname)).convert("RGB")
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
        verdict = "FLAT" if fill_frac >= 80 else ("DARK" if dark_frac >= 30 else "BLEND")
        print(f"z{z:>5} sea-px={n:>5} median={med:.0f}  fill:{fill_frac:.0f}%  dark:{dark_frac:.0f}%  bright:{bright_frac:.0f}%  [{verdict}]")
    else:
        print(f"z{z}: no sea pixels in band")
