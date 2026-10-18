"""One-off: sample raw imagery tiles over Victoria Harbour to quantify the
'mosaic shadow' — Esri World Imagery at z10/z12/z13/z14 vs EOX Sentinel-2
cloudless (key-less). Prints tone stats and saves tiles for visual inspection."""
import math, os, sys, urllib.request

OUT = r"D:/Waste Map/out/verify/tiles"
os.makedirs(OUT, exist_ok=True)

LON, LAT = 114.16, 22.29  # Victoria Harbour


def tile_xy(z, lon, lat):
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return int(x), int(y)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except Exception as e:
        return None


from PIL import Image
import io


def stats(data, name):
    if not data:
        print(f"{name:38s} FETCH FAILED")
        return
    im = Image.open(io.BytesIO(data)).convert("RGB")
    small = im.resize((64, 64))
    px = list(small.getdata())
    lumas = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in px]
    mean = sum(lumas) / len(lumas)
    dark = sum(1 for l in lumas if l < 40) / len(lumas) * 100
    print(f"{name:38s} {im.size} mean luma {mean:6.1f}  pix<40 {dark:5.1f}%")
    im.resize((128, 128)).save(os.path.join(OUT, name.replace("/", "_").replace(":", "") + ".png"))
    return im


# --- Esri World Imagery (note: URL is {z}/{y}/{x}) ---
for z in (10, 12, 13, 14):
    x, y = tile_xy(z, LON, LAT)
    for dx in (0, 1):
        u = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y + dx}/{x}"
        stats(fetch(u), f"esri-z{z}-dx{dx}")

# --- EOX Sentinel-2 cloudless candidates ({z}/{y}/{x}) ---
z = 12
x, y = tile_xy(z, LON, LAT)
for cand in (
    f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
    f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/3857/{z}/{y}/{x}.jpg",
    f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/3857/{z}/{y}/{x}.jpg",
):
    stats(fetch(cand), f"eox-{cand.split('/')[8]}-{'g' if '/g/' in cand else '3857'}")

print("\nsaved to", OUT)
