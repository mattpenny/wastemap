"""
Build src/data/hk-sea.json — the sea polygon the satellite style fills to mask
the Esri water-mosaic seams.

Why: Esri World Imagery's water tiles are different satellite passes stitched
together (one overcast/grey, one clear/teal), so the open sea shows hard,
tone-shifted parallelograms that no zoom/tileSize change removes. Painting a
flat sea colour over the water hides them; the land keeps the imagery.

Source: Natural Earth 1:10m ocean (public domain), clipped to the HK bbox.

Usage (needs shapely; the repo does not depend on it at runtime):
    python -m venv .venv-sea
    .venv-sea/Scripts/pip install shapely      # Windows
    .venv-sea/bin/pip install shapely          # macOS / Linux
    .venv-sea/Scripts/python scripts/build-sea-mask.py

The ~10 MB ocean GeoJSON is cached in the OS temp dir; delete it to re-download.
"""
import json
import os
import tempfile
import urllib.request

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

OCEAN_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_10m_ocean.geojson"
)
# Generous margin around HK so the opening view and a zoom-out stay covered.
BBOX = (113.3, 21.7, 115.0, 22.9)  # minx, miny, maxx, maxy
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "hk-sea.json")

cache = os.path.join(tempfile.gettempdir(), "ne_10m_ocean.geojson")
if not os.path.exists(cache):
    print("downloading Natural Earth ocean…")
    urllib.request.urlretrieve(OCEAN_URL, cache)

with open(cache, encoding="utf-8") as f:
    data = json.load(f)

bbox = box(*BBOX)
geoms = []
for feat in data["features"]:
    g = shape(feat["geometry"])
    b = g.bounds
    if b[2] < BBOX[0] or b[0] > BBOX[2] or b[3] < BBOX[1] or b[1] > BBOX[3]:
        continue
    geoms.append(g)

clipped = unary_union(geoms).intersection(bbox)
clipped = clipped.simplify(0.0008, preserve_topology=True)

out = {
    "type": "FeatureCollection",
    "features": [{"type": "Feature", "properties": {}, "geometry": mapping(clipped)}],
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))

print("saved", os.path.abspath(OUT), os.path.getsize(OUT), "bytes")
