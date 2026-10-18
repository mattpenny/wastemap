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

## 8. Zoom-out black blocks (2026-10-18, shipped)

**Symptom:** zooming out from a facility, dark near-black blocks flash at the outer
edges of the map for ~1s before the normal colours render.

**Reproduced on the live site** (`scripts/_zoomout-flash.mjs`): at t+0.3s the frame
shows sharp tiles in the viewport centre with hard-edged dark regions at the edges —
that is the satellite style's `background` paint `#1c3434` showing wherever the new
wide-zoom imagery tiles have not landed yet. The deep tiles keep covering the centre
during the flight while the outer ring is still on the wire.

**Fix** (`src/components/map/mapStyles.ts`): a second raster source `imagery-low`
(same Esri service, `maxzoom: 9`) plus a `satellite-low` layer painted directly above
the background. MapLibre requests every layer's viewport tiles on first load, so the
coarse tiles are cached before anyone zooms out; the gap then shows soft satellite
instead of black. (z9 keeps the whole overshoot range — z15 down past the z10.6
overview — within one or two tiny tiles.)

**Deterministic A/B proof** (`scripts/_maptest.mjs` + `_maptest-baseline.mjs`,
replaying the exact style spec standalone with deep tiles z≥10 aborted):
- baseline (no underlay): large hard-edged `#1c3434` blocks at the edges — the
  reported artefact, reproduced deterministically;
- with underlay: same frame fully covered by coarse imagery, no dark blocks.

Verification: `tsc --noEmit` clean; live site browser suite 139/139. Commits
`1d9b5c0` (underlay) and `cf83750` (z9 refinement), auto-deployed to Vercel.

## 9. "Still blocks after the fix" — deeper diagnosis + four-part hardening

The user still saw blocks at the outer edge while zooming in/out and asked whether the
"Imagery © Esri, Maxar, Earthstar Geographics" layer was to blame.

**The attribution is not a layer.** It is a text credit string carried in the source
metadata; it renders nothing. The blocks are painted by the style's `background` layer
wherever the raster layers have no loaded tile.

Live diagnostics (headless Chrome against the deployment, `scripts/_zoom-deep.mjs`,
`_map-probe.mjs`):

- The deployed style was correct — `satellite-low` present, correct order, `maxzoom: 9`
  (verified by dumping the minified chunk from the live bundle).
- The network log showed **zero z9 requests at startup**: the underlay's own tiles were
  never warmed, so the first zoom-out had no coverage. (Standalone replay of the same
  style does request them, so this is app-environment specific — cause not pinned down.)
- During the zoom-out the periphery still flashed the dark `#1c3434` background; once
  settled, everything rendered.

**Shipped hardening (commit `63105b0`, pool fix `22ca664`)** — each change alone removes
"black", together they remove the blocks entirely:

1. `background-color` `#1c3434` → `#4e6966` (the exact sea-mask tone). Any residual gap
   is now light; over water (most of the overview) it is literally invisible, and
   land-side gaps read as a light "loading" patch instead of a black void.
2. `satellite-low` gets a brightness lift (`brightness-min: 0.28`, `contrast: -0.08`) so
   Esri's dark z9 ocean pixels (luma ~60) never read as black blocks while the water
   mask is still painting.
3. New `src/lib/prefetchBasemap.ts` warms the browser HTTP cache with the underlay's z9
   tiles at startup (Esri sends `Cache-Control: max-age=86400` + `Access-Control-Allow-Origin: *`).
   Fire-and-forget, ~30 tiles, real 6-worker pool, skipped for data-saver, scheduled
   1.5s after map load so it never competes with the initial tile stream.
4. Main imagery `raster-fade-duration` 0 → 300ms so the progressive edge fill reads as
   tiles streaming in rather than rectangles popping.

**Evidence** (standalone MapLibre harness with the exact style, deep tiles aborted —
`scripts/_maptest.mjs`): the gap frame is now covered by soft real imagery
(`out/verify/maptest-with-underlay-gap.png`), and the no-underlay baseline shows a flat
light grey-teal map (`out/verify/maptest-baseline-no-underlay-gap.png`) — never black.
Live: browser suite 139/139 on the deployed build. The prefetch's firing on the live
site could not be re-confirmed because Vercel's bot challenge intermittently blocks
headless runs (a real browser is unaffected).
