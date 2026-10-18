import type { StyleSpecification } from "maplibre-gl";

/**
 * Fill for the WebGL background — the colour painted wherever no satellite
 * tile has arrived yet. Sampled from Esri's wide-view sea over Hong Kong, so a
 * gap over water is invisible and a gap over land is a light "loading" patch
 * rather than a black block.
 */
const SEA_COLOR = "#4e6966";

/**
 * Basemap definitions.
 *
 *   • official  → **Lands Department, HKSAR Government** official map, served
 *                 from the HK GeoData Store MapAPI as two raster tile layers:
 *                 the cartographic basemap plus a separate label layer that is
 *                 published in BOTH English and Traditional Chinese. The label
 *                 source is swapped to match the app's language, so the map
 *                 legend and the map labels stay in the same language.
 *   • satellite → Esri World Imagery plus the Esri boundaries/places overlay.
 *
 * Both are key-less public endpoints, so the app runs with no API token.
 *
 * On "3D": the MapAPI publishes raster basemap + label tiles only — there is no
 * 3D-tile or vector endpoint (verified: /xyz/3d, /xyz/basemap3d, /xyz/building
 * and /xyz/vector all 404). The three-dimensional presentation therefore comes
 * from this app: a pitched MapLibre camera plus deck.gl extruded pillars drawn
 * over the official map. Lands Department publishes true 3D building geometry
 * separately as Open3Dhk / 3D-BIT00 if that is ever wanted.
 *
 * Attribution for the official map is mandatory under the Lands Department
 * terms of use, so it is baked into the style.
 */

export type MapStyleId = "official" | "satellite";

/** Satellite is the default view. */
export const DEFAULT_MAP_STYLE: MapStyleId = "satellite";

export type MapLang = "en" | "zh";

export const HK_CENTER: [number, number] = [114.1694, 22.3193];
export const HK_ZOOM = 10.6;
export const HK_PITCH = 50;
export const HK_BEARING = -18;

const LANDSD_ATTRIBUTION =
  '© <a href="https://www.landsd.gov.hk/" target="_blank" rel="noreferrer">Lands Department, HKSAR Government</a>';
const ESRI_ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics";

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const HKG_MAPAPI = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz";

/**
 * Lands Department official map.
 *
 * Two stacked raster layers: `basemap` carries the cartography, `labels` carries
 * the place names. Keeping them separate is what lets us serve Chinese labels to
 * a Chinese UI and English labels to an English one from the same map.
 */
export function officialStyle(lang: MapLang = "en"): StyleSpecification {
  const labelLanguage = lang === "zh" ? "tc" : "en";

  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [`${HKG_MAPAPI}/basemap/WGS84/{z}/{x}/{y}.png`],
        tileSize: 256,
        maxzoom: 19,
        attribution: LANDSD_ATTRIBUTION,
      },
      labels: {
        type: "raster",
        tiles: [`${HKG_MAPAPI}/label/hk/${labelLanguage}/WGS84/{z}/{x}/{y}.png`],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f2efe9" },
      },
      {
        id: "hkg-basemap",
        type: "raster",
        source: "basemap",
        paint: { "raster-fade-duration": 0 },
      },
      {
        id: "hkg-labels",
        type: "raster",
        source: "labels",
        paint: { "raster-fade-duration": 0, "raster-opacity": 0.95 },
      },
    ],
  };
}

/** Esri World Imagery + boundaries/labels. */
export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      // Two declarations of the same Esri service, differing only in the
      // declared tile size. MapLibre picks the tile zoom from that number, so
      // one fetches a level deeper than the other:
      //
      //   imagery-wide  256 -> camera z10 fetches z10 tiles. At the wide view
      //                 those are the uniform, richly coloured tiles — the sea
      //                 reads as real water with no tone steps, because the
      //                 whole harbour falls inside one or two of them.
      //   imagery       128 -> camera z12 fetches z13. Half the real 256px
      //                 image is drawn into the same area, i.e. 2x
      //                 supersampling, which is what keeps land crisp once you
      //                 are close enough to care.
      //
      // Only one is visible at a time; they cross-fade between z11.5 and z12.5
      // (see the two raster layers). Using 128 at the wide end was the original
      // bug: it pulled z11/z12 tiles whose adjacent mosaic passes differ in
      // tone, which showed up as large parallelograms over the water. That was
      // hidden with an opaque sea fill, which also threw away the sea's detail —
      // the two-source split fixes the cause instead.
      imagery: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 128,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION,
      },
      "imagery-wide": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION,
      },
      // Coarse fallback imagery, drawn beneath `satellite`. During a fast
      // zoom-out the sharp deep-zoom tiles keep covering the centre of the
      // viewport while the new wide tiles for the outer ring are still on the
      // wire — without this layer that ring shows the dark `background` paint
      // as black blocks at the edges. These coarse tiles are requested on the
      // very first load (MapLibre loads every layer's viewport tiles), so by
      // the time anyone zooms out they are already cached and the gap shows
      // soft satellite instead of a black flash. Same Esri service, capped at
      // z9 — one tile covers most of the viewport at any wide zoom.
      "imagery-low": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 9,
      },
      labels: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
      },
      // OSM water polygons (OpenFreeMap, key-less) — used to *tint* the sea, not
      // to replace it. See the `sea-tint` layer for why this is still needed.
      openmaptiles: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        maxzoom: 12,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        // Painted by WebGL wherever no satellite tile is loaded — i.e. for the
        // brief window during a `flyTo` or a zoom-out while the destination's
        // tiles are still being fetched, and around tile edges at low zoom. It
        // must read as "water" and not as a black void, because a near-black
        // background renders as black blocks at the outer edge of the viewport
        // whenever the wide-zoom tiles lag (the periphery fills in last).
        // Matching the wide-view sea tone makes any water-side gap invisible,
        // and keeps land-side gaps a light "loading" patch instead of black.
        paint: { "background-color": SEA_COLOR },
      },
      {
        // Coarse underlay for the zoom-out gap — see the `imagery-low` source.
        // Must sit directly above the background and below every other layer so
        // it only ever shows where the main imagery has no tile yet. The
        // brightness/contrast lift keeps its dark low-zoom pixels (Esri z9
        // ocean averages luma ~60) well clear of "black block" territory. It
        // only ever shows through a gap in `satellite-wide`, which normally
        // covers it entirely.
        id: "satellite-low",
        type: "raster",
        source: "imagery-low",
        paint: {
          "raster-fade-duration": 0,
          "raster-brightness-min": 0.28,
          "raster-brightness-max": 1,
          "raster-contrast": -0.08,
        },
      },
      {
        // Wide view. `imagery-wide` (tileSize 256) makes MapLibre fetch the
        // tile level that actually matches the camera zoom, so at the overview
        // the harbour is covered by a handful of uniform tiles and the sea
        // reads as real water. Fades out as the camera closes in, handing over
        // to the supersampled layer above.
        id: "satellite-wide",
        type: "raster",
        source: "imagery-wide",
        // Above the handover the layer is invisible anyway; the maxzoom stops
        // it fetching tiles nobody will see (at the default view both layers
        // would otherwise pull a full screen of imagery each).
        maxzoom: 14.5,
        paint: {
          "raster-fade-duration": 300,
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 1, 14.5, 0],
          // Esri's wide-view mosaic is dark (z9–z10 ocean averages luma ~60),
          // so a black-point lift is what keeps the overview's sea reading as
          // water rather than as a shadow. Faded to zero by z12.5, where the
          // imagery is bright enough on its own — raising the black point on
          // good imagery is what makes it look soft and milky.
          "raster-brightness-min": ["interpolate", ["linear"], ["zoom"], 9.5, 0.2, 12.5, 0],
          "raster-brightness-max": 1,
          "raster-contrast": ["interpolate", ["linear"], ["zoom"], 9.5, -0.2, 12.5, 0],
        },
      },
      {
        id: "satellite",
        type: "raster",
        source: "imagery",
        // Mirrors `satellite-wide`'s maxzoom: below the handover this layer is
        // transparent, so there is no reason to download its deeper tiles.
        minzoom: 13.5,
        paint: {
          // 300ms fade-in so the progressive edge fill during a zoom reads as
          // tiles streaming in rather than rectangles popping (the periphery
          // is always the last to land).
          "raster-fade-duration": 300,
          // Handover from the wide layer. `imagery` declares tileSize 128, so
          // from z13.5 up it fetches one level deeper than the camera and draws
          // each 256px image into half the area — 2x supersampling, which is
          // what keeps the aerial crisp at the zooms people actually read.
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 14.5, 1],
        },
      },
      {
        // ----------------------------------------------------------------
        // Why this layer exists, measured rather than guessed.
        // ----------------------------------------------------------------
        // Esri World Imagery is not one seamless mosaic — it is a stack of
        // caches that switch at fixed zoom levels. Sampled at a single point
        // over deep water south of Lamma (scripts/_tilesample.mjs):
        //
        //     z8–z11   #1e4549   luma 61   (lighter, bluer tier)
        //     z12–z17  #092936   luma 35   (much darker tier)
        //
        // Land and the shallow harbour do NOT step: land holds luma 50–66 all
        // the way up, and the harbour actually gets *brighter* past z12. So the
        // step is confined to deep water, which is why it reads as a dark
        // shadow appearing over the sea at one particular zoom.
        //
        // Rendered without any tint (scripts/_seasweep.mjs, camera z10→z16,
        // open water south of Lamma), the sea's mean luma slides:
        //
        //     z10 95 · z11 87 · z12 70 · z12.5 59 · z13 52 · z13.5 43 · z15 35
        //
        // A global tone curve cannot repair this: lifting luma 35 back to ~88
        // needs raster-brightness-min ≈ 0.3, which turns every land shadow to
        // grey haze. The correction has to be confined to water, which is what
        // this fill does.
        //
        // There is a second, smaller defect in the same place: adjacent Esri
        // tiles over water differ by ~20 luma (a haze/date difference in the
        // mosaic), so the sea shows pale rectangles with hard edges — measured
        // in scripts/_seamprobe.mjs and _lowprobe.mjs. Those are *not* a
        // loading gap: hiding `satellite-low` produces a byte-identical frame.
        // At opacity a, a seam of 20 luma leaves 20·(1−a), so the ramp below
        // is pushed to ~0.9 above z12.5, where seams drop under ~2 luma and
        // stop being visible.
        //
        // The honest trade-off: at the overview the sea is untouched Esri
        // imagery (seams ~20 luma but spread over a huge area, reading as
        // natural water variation), and once you zoom in past z12 the water is
        // graded almost flat. That is deliberate — deep water has no detail
        // worth keeping, and at those zooms the eye is on the coastline and the
        // facilities, both of which are land and therefore never tinted.
        //
        // The trick is that the opacity is *not* a taste knob, it is solved
        // per zoom so the rendered sea lands on one tone (~88 rising gently to
        // ~93) everywhere:
        //
        //     a(z) ≈ (T − R(z)) / (100 − R(z))     R = untinted luma
        //
        //   z10.6 0.00 · z11 0.08 · z11.5 0.30 · z12 0.62 · z12.5 0.78
        //   z13 0.83 · z13.5 0.87 · z15 0.90
        //
        // Because the blended result is smooth, the ramp is invisible in
        // motion — you never see a tint "arrive", the sea simply stays the same
        // colour as you zoom. And at the default overview (z10.6) the opacity
        // is 0, so the wide view keeps the untouched Esri water the map was
        // always meant to show — the opposite of the old 0.97 mask, which
        // replaced the sea with one flat tone at every zoom.
        //
        // SEA_COLOR's luma (~99) is chosen, not decorative: it is the value
        // that lets a 0.9 blend lift deep water (35) to ~93 while leaving the
        // bright harbour (98) essentially untouched at 99.
        //
        // If it ever needs re-tuning, re-run scripts/_seasweep.mjs and read the
        // `tint on` column: it should stay flat across the zoom range. Do NOT
        // simply raise the numbers — a flat high opacity at every zoom is the
        // mask again, and it throws away the wide-view sea.
        id: "sea-tint",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: {
          "fill-color": SEA_COLOR,
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            0,
            10.5,
            0.02,
            11,
            0.08,
            11.5,
            0.3,
            12,
            0.62,
            12.5,
            0.78,
            13,
            0.83,
            13.5,
            0.87,
            14.5,
            0.9,
          ],
        },
      },
      {
        id: "places",
        type: "raster",
        source: "labels",
        paint: { "raster-fade-duration": 0, "raster-opacity": 0.88 },
      },
    ],
  };
}

export function styleFor(
  id: MapStyleId,
  lang: MapLang = "en"
): StyleSpecification | string {
  if (id === "satellite") {
    // A Mapbox token, if supplied, upgrades the satellite slot to a hybrid
    // satellite-streets style; otherwise the key-less Esri stack is used.
    if (MAPBOX_TOKEN) {
      return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${MAPBOX_TOKEN}`;
    }
    return satelliteStyle();
  }
  return officialStyle(lang);
}

/**
 * Identity of the style actually rendered. The official map has two variants
 * (one per label language), so the language has to be part of the key —
 * otherwise switching language would not re-fetch the label tiles.
 */
export function styleKey(id: MapStyleId, lang: MapLang): string {
  return id === "official" ? `official:${lang}` : id;
}

/**
 * Resolve the pixel ratio. Capping on small screens keeps the deck.gl canvas
 * cheap enough to stay smooth on phones.
 */
export function resolvePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const dpr = window.devicePixelRatio || 1;
  const isSmall = window.matchMedia("(max-width: 760px)").matches;
  return isSmall ? Math.min(dpr, 2) : dpr;
}

export function isSmallScreen(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 760px)").matches;
}
