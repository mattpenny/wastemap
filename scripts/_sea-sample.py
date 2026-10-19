import json, os
from PIL import Image

OUT = "out/seacheck"
data = json.load(open(os.path.join(OUT, "coords.json")))
# SEA_COLOR #35565c -> rgb(53,86,92)
FILL = (53, 86, 92)
def luma(p):
    r, g, b = p
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

print(f"reference flat fill luma = {luma(FILL):.1f}  (rgb {FILL})")
for z in data["ZOOMS"]:
    zs = str(z)
    img = Image.open(os.path.join(OUT, f"z{zs}.png")).convert("RGB")
    W, H = img.size
    pts = data["coords"][zs]
    lumas = []
    detail = []
    for p in pts:
        x, y = p["x"], p["y"]
        if 0 <= x < W and 0 <= y < H:
            block = []
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < W and 0 <= yy < H:
                        block.append(luma(img.getpixel((xx, yy))))
            if block:
                med = sorted(block)[len(block) // 2]
                lumas.append(med)
                detail.append(f"{p['name']}={med:.0f}")
    med_all = sorted(lumas)[len(lumas) // 2] if lumas else 0
    verdict = "FLAT-FILL" if 76 <= med_all <= 82 else ("BRIGHT-NATURAL" if med_all > 82 else "DARK-RAW(shadow)")
    print(f"z{zs:>5}  median={med_all:.0f}  [{verdict}]  " + " ".join(detail))
