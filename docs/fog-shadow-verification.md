# Verification — dark "shadow"/gradient over water on the satellite basemap

Scope: read-only investigation of the current code (no changes made), per request.

## 1. Fog / atmospheric haze — RULED OUT

- Engine is **MapLibre GL JS 5.24**, not Mapbox GL JS. There is no `map.setFog()` API.
  Fog in MapLibre lives in the style `sky` object (`fog-color`, `fog-ground-blend`,
  `horizon-fog-blend`, `sky-color`, `horizon-color`, `atmosphere-blend`) — verified in
  `node_modules/maplibre-gl/dist/maplibre-gl-csp-dev.js` (Sky class, ~line 37509).
- Neither `satelliteStyle()` nor `officialStyle()` in `src/components/map/mapStyles.ts`
  defines `sky`, and no code calls `map.setSky()` at runtime.
- Engine default when no `sky` object is supplied (from MapLibre source):
  `sky-color: transparent`, `horizon-color: transparent`, `fog-color: transparent`,
  `atmosphere-blend: 0` → nothing is rendered.
- Belt and braces: MapLibre's fog is invisible below camera pitch 60 and only fades
  in between 60°–70° (`calculateFogBlendOpacity`). This map runs at **pitch 50**
  (`HK_PITCH`), so fog could not show even if it were configured.

## 2. 3D lighting / terrain / shadows — RULED OUT

- No `terrain` is set anywhere; no `setLight`, no skybox, no shadow pass.
- The deck.gl `LightingEffect` (AmbientLight + DirectionalLight in `WasteMap3D.tsx`)
  only shades the extruded pillar materials. The lights have no `_shadow` flag, so
  nothing casts shadows onto the basemap.

## 3. Real candidates (most likely first)

| # | Candidate | Why it matches "dark gradient over water, varies with zoom/angle" |
|---|-----------|----------------------------------------------------------------------|
| a | Background paint `#1c3434` (dark grey-teal) on the satellite style | Painted by WebGL wherever no Esri imagery tile / OSM water polygon is loaded yet. At pitch 50 the **far/horizon water is the last area to load**, so it reads as a dark wash over the distant sea during and right after `flyTo`/zoom. Tile coverage changes with zoom/bearing → matches the "varies with viewing angle" symptom. |
| b | Esri World Imagery source pixels at low zoom | Esri's z10–z11 ocean mosaic over HK is genuinely dark and per-pass tone-shifted (previously verified by fetching raw tiles with no app code involved; documented in `mapStyles.ts` comments). |
| c | Zoom-interpolated `raster-brightness-min` 0.2→0 / `raster-contrast` -0.2→0 (z9.5→12.5) | These *lift* blacks — they cannot introduce new darks, and they are fully off by z12.5. Not the cause of a *dark* shadow. (Not a contributor; listed to be exhaustive.) |

## 4. How to confirm which one it is (no code change)

1. Open DevTools → Network, filter `arcgisonline`. Reproduce the shadow, note the tile
   URL being displayed, open that raw tile in a browser tab and compare the shadow area
   pixel-by-pixel.
2. Watch *when* it appears: only during / right after a zoom or `flyTo` → candidate **a**
   (background showing through unloaded tiles). Persisting at z13+ over the same sea
   area → candidate **b** (source pixels).

## 5. Proposed fix (awaiting approval — not yet applied)

- Change the satellite style `background-color` from `#1c3434` to the sea-mask tone
  family, e.g. `#4e6966` (the `sea-mask` fill colour) or slightly lighter `#5a7571`, so
  any tile gap reads as "sea loading" instead of a shadow. Trade-off: a lighter flash
  during `flyTo`, but tone-matched to the mask.
- Optionally add an explicit all-transparent `sky` block to the style as
  self-documenting belt-and-braces (no visual change, since defaults are already
  transparent).

## 6. Live comparison (2026-10-18, after user attached the previous-version screenshot)

- User attached a screenshot of the **previous version**: the harbour water shows
  large, tile-aligned dark grey-green parallelograms of differing tones — Esri's raw
  mosaic, visible because that build had no sea mask (the flat mask had been removed
  and was restored at 16:58 the same day).
- A fresh headless-Chrome capture of the **current** deployment at the same wide view
  (`scripts/_sea-check.mjs`, saved to `out/verify/sea-current-live.png`) shows the
  whole sea as one flat #4e6966 tone — no parallelograms, no gradient, no horizon
  shading. Console/page errors: none.
- Conclusion: the sea "shadow" is 100% Esri World Imagery source-side tone variation
  over the harbour. The OSM water mask already covers it in the current build; the
  attached screenshot predates it. **No code change required** unless dark patches are
  observed in the current build (in which case they would be mask gaps — unmapped
  harbour water — not a rendering/fog effect).

## 7. Raw-tile measurements & the natural-sea fix (2026-10-18, shipped)

Headless headroom: raw tiles over Victoria Harbour (114.16, 22.29):
`scripts/_tile-probe.py`, tiles saved to `out/verify/tiles/`.

| Source / zoom | Mean luma | Pixels < 40 luma | Water look |
|---|---|---|---|
| Esri z10 | 58.6–66.9 | 3.4–14.9% | dark, patchy, tone-shifted mosiac ("shadow") |
| Esri z12 | 73.7–77.3 | 2.4–5.7% | milder tone steps |
| Esri z13 | 79.9–80.7 | 0–6.0% | mostly clean teal |
| Esri z14 | 89.5–94.0 | 0–0.1% | bright, uniform, natural |
| EOX Sentinel-2 cloudless z12 | 85.3 | 3.9% | uniform but 10 m resolution (soft vs Esri) |

The user wanted the natural sea back without the shadow. MapLibre cannot clip a
raster to water polygons, so the shipped fix keeps the single OSM water-mask fill but
**fades its opacity with camera zoom** (`src/components/map/mapStyles.ts`):

```
"fill-opacity": interpolate linear by zoom:
  z10 → 0.97   (overview: dark mosaic fully suppressed, same approved tone)
  z11.5 → 0.93
  z13 → 0.6    (Esri harbour water already clean; texture through)
  z14.5 → 0    (bright, uniform high-res aerial fully visible — natural sea)
```

Evidence: `out/verify/sea-fade-overview.png` (sea calm, no parallelograms) and
`out/verify/sea-fade-close.png` (natural bright harbour water at close zoom).
Verification: `tsc --noEmit` clean, browser suite 139/139, committed and pushed to
`main` (`2a3a4d4`), auto-deployed to Vercel. An EOX Sentinel-2 cloudless basemap
(seam-free everywhere but 10 m land) remains available as a future option if the
user ever wants a second satellite style.
