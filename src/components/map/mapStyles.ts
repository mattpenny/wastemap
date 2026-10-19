import type { StyleSpecification } from "maplibre-gl";

/**
 * Two sea tones, because they do two different jobs (2026-10-19).
 *
 * `SEA_BG` is the WebGL background — what is painted wherever no satellite tile
 * has arrived. It only ever shows during a `flyTo` or around a lagging tile
 * edge, so it is matched to the *overview* water (sampled #4d7871) rather than
 * to the mask: a gap at the wide view then reads as more sea, not as a block.
 *
 * `SEA_COLOR` is the `sea-mask` fill — the flat one-tone sea that covers
 * Esri's measured water defects once the user has zoomed in. Its opacity is
 * driven as the `wmSeaMask` global state (see `seaMaskOpacity` below): natural
 * sea at the landing view and through three wheel notches, flat from the
 * fourth notch on, and similarly covered once any other zoom path (flyTo on
 * selection, geolocate, the +/− buttons, keyboard, double-click) goes deep.
 * Deep harbour teal: it separates water from land, which is what
 * gives the pitched view its depth.
 *
 * They are deliberately different. Matching them (as they were until this
 * revision) forced one value to do both jobs, and whichever it was, the other
 * zoom range looked wrong.
 */
const SEA_BG = "#4d7871";
const SEA_COLOR = "#35565c";

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

/**
 * How the flat sea mask engages (2026-10-21, "start at the fourth notch").
 *
 * The user's requirement is a **gesture** requirement — "the masked layer
 * starts from the fourth notch of mouse wheeling" — but the landing zoom
 * differs with window size (the framing fit solves for width: z10.36 at
 * 1440x900, z10.56 at 1920x1080, z9.65 at a short 1080x540, z10.18 at
 * 1280x800), so no constant zoom ramp can fire at the same notch on every
 * screen. A zoom ramp anchored at 10.9/11.08 measured the mask starting at
 * notch 3, 2, 7 and 5 on those four viewports — the "fourth to seventh
 * notches" the user reported. Worse, the zoom a wheel *detent* produces is
 * device-dependent: MapLibre converts one detent through
 * `scale = 2/(1+exp(-|delta|/450))`, so a detent reporting deltaY=120 moves
 * +0.180 zoom while a Chrome/Windows mouse reporting deltaY=100 moves only
 * +0.152. An odometer of *wheel events* is what makes "the fourth notch" true
 * on the user's own mouse.
 *
 * So `fill-opacity` is a single global-state number (`wmSeaMask`, default 0 —
 * natural sea), and the *component* computes it from two ingredients:
 *
 *   1. the landing zoom the framing pass actually settled on (viewport-
 *      dependent),
 *   2. the zoom ONE wheel detent actually produces on the user's device —
 *      with MapLibre's own conversion (see `wheelDetentZoom`).
 *
 * The mask ramp then begins fading at that landing + 3 detents and reaches 1
 * exactly at the landing + 4 detents: "starts from the fourth notch", in the
 * units the user counts, on every window size and every mouse, with no
 * gesture bookkeeping (a zoom predicate is stateless and cannot desync from
 * the camera). It cannot falsely trigger early: below the landing + 3
 * detents the ramp is 0 by construction, so the first three notches are
 * always natural sea.
 */
export const SEA_MASK_STATE = "wmSeaMask";

/**
 * Zoom one wheel detent produces, before it is measured. MapLibre converts a
 * deltaY-120 detent via `scale = 2/(1+exp(-delta/450))` → x1.1327 → +0.180
 * zoom; this default matches MapLibre's own wheel math and the observed
 * 1440x900 probes.
 */
export const SEA_MASK_DETENT_DEFAULT = 0.18;

/** Sane bounds for one detent's zoom across real wheel reporting modes. */
export const SEA_MASK_DETENT_MIN = 0.07; // deltaY 53 (Windows line mode)
export const SEA_MASK_DETENT_MAX = 0.35;

/**
 * Absolute backstop: four detents of even the LARGEST tolerated reporting
 * mode. Guarantees the flat fill no matter what, and covers deep non-wheel
 * zooms (flyTo on selection, geolocate, keyboard, double-click) whose offset
 * dwarfs any ramp.
 */
export const SEA_MASK_GUARANTEE_OFFSET = 4 * SEA_MASK_DETENT_MAX;

/**
 * The zoom one mouse-wheel detent produces on this device, using MapLibre's
 * own ScrollZoomHandler math (maplibre-gl 5.24, scroll_zoom):
 *
 *   value  = deltaY, scaled by 40 per line when deltaMode is DOM_DELTA_LINE
 *   rate   = 1/450 (the wheel rate — every detent-sized delta takes it)
 *   dZoom  = log2(2 / (1 + exp(-|value| / 450)))
 *
 * A deltaY-120 detent therefore moves +0.180 zoom; deltaY-100 (Chrome on
 * Windows) +0.152; deltaY-159 +0.245. Reading the detent's own delta is what
 * makes "notch" a per-device truth instead of an assumption.
 */
export function wheelDetentZoom(value: number, deltaMode: number): number {
  const v = Math.abs(deltaMode === 1 /* DOM_DELTA_LINE */ ? value * 40 : value);
  if (v === 0) return 0;
  const scale = 2 / (1 + Math.exp(-v / 450));
  return Math.log2(scale);
}

/**
 * The whole mask as a pure function of the live zoom, the landing camera and
 * the measured per-detent zoom. Pure, so the probe can call the same math.
 *
 *   • offset ≤ 3 detents  → 0 (natural Esri sea),
 *   • offset = 4 detents  → 1 (flat one-tone sea),
 *   • in between          → the one-notch blend that hands the coastline
 *                           from Esri's polygon to OSM's.
 */
export function seaMaskOpacity(zoom: number, landing: number, detent: number): number {
  const offset = zoom - landing;
  if (offset >= SEA_MASK_GUARANTEE_OFFSET) return 1;
  const onset = 3 * detent;
  const full = 4 * detent;
  if (offset <= onset) return 0;
  if (offset >= full) return 1;
  return clamp01((offset - onset) / (full - onset));
}

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
    // Declared default for the sea-mask opacity: 0 = natural Esri sea. Only
    // the satellite style has the sea-mask layer; `_createLayers` re-installs
    // this default on every style (re)load, which is why the component
    // re-asserts the computed value on `style.load`.
    state: { [SEA_MASK_STATE]: { default: 0 } },
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
      // Only one is visible at a time; they cross-fade between z13.5 and z14.5
      // (see the two raster layers). Using 128 at the wide end was the original
      // bug: it pulled z11/z12 tiles whose adjacent mosaic passes differ in
      // tone, which showed up as large parallelograms over the water. That was
      // hidden with an opaque sea fill, which also threw away the sea's detail —
      // the two-source split fixes the cause instead, but only while the view
      // is wide enough to stay inside few tiles; from z10.9 the mosaic shows
      // again, which is what the sea-mask below now covers.
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
      // OSM water polygons (OpenFreeMap, key-less) — used to paint the flat
      // sea over the imagery. See the `sea-mask` layer for why this is needed.
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
        paint: { "background-color": SEA_BG },
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
          // Matches the grade on the two layers above, so a gap never flashes
          // a differently-coloured patch while the sharp tiles are in flight.
          "raster-contrast": 0,
          "raster-saturation": 0.25,
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
          "raster-brightness-min": ["interpolate", ["linear"], ["zoom"], 9.5, 0.26, 12.5, 0],
          "raster-brightness-max": 1,
          // A light grade, not a rescue. The raw mosaic is desaturated grey-
          // green (measured saturation 22% of the frame), which is the other
          // half of why the view looked dull; +0.25 saturation and a touch of
          // contrast bring the vegetation and the built-up areas back without
          // the milky haze a bigger black-point lift causes. Tuned against
          // out/look/ — E-bright-punch held the median at 96 (baseline 99)
          // while lifting p90 129 → 142 and saturation 22% → 30%.
          "raster-contrast": 0.08,
          "raster-saturation": 0.25,
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
          // Same grade as the wide layer, so the handover is invisible. The
          // close imagery is clean enough not to need the black-point lift,
          // only the colour.
          "raster-contrast": 0.08,
          "raster-saturation": 0.25,
        },
      },
      {
        // Sea painted from OSM's water polygons, driven as a global state.
        // This is the fifth arrangement of this layer, so the history is
        // worth keeping.
        //
        // The natural sea is the look that was asked for, and at the landing
        // zoom Esri delivers it: turquoise shallows, sediment plumes, a real
        // shoreline. The problem is everything above it. Two measured defects
        // in Esri's water:
        //
        //   1. a cache tier step at z12 — the same point of deep water goes
        //      #1e4549 (luma 61) at z8-z11 and #092936 (luma 35) at z12-z17
        //      (scripts/_tilesample.mjs), while land does not step;
        //   2. adjacent tiles differ by ~20 luma over water, showing as pale
        //      rectangles with hard edges (scripts/_seamprobe.mjs).
        //
        // On top of that the water itself darkens with zoom: the open sea
        // slides 88 -> 84 -> 77 -> 63 -> 54 -> 44 -> 30 luma from z10.6 to z15
        // (scripts/_hybrid4.mjs). So an unmasked close-up was never viable —
        // the shadow the user kept reporting.
        //
        // PART E (current): the user wants the map to render NATURALLY at the
        // landing / overview — the "previous map" (Esri's real shoreline,
        // turquoise shallows, sediment, ~88 luma) — and for the flat one-tone
        // fill to appear ONLY once they have zoomed in four mouse-wheel
        // notches. They explicitly do NOT want it always masked.
        //
        // Arrangement D tried to express "fourth notch" as a fixed zoom ramp
        // pinned to the 1440x900 landing (0 below z10.9, 1 above z11.08,
        // "~0.18 zoom per notch"), conceding that wider/narrower windows
        // "mask a notch later/earlier — within tolerance". It is not within
        // tolerance: live probes (scripts/_notch-probe.mjs) measured the mask
        // first appearing at notch 3, 2, 7 and 5 on those four viewports —
        // the "fourth to seventh notches" the user reported. The 0.18 zoom a
        // detent moves is also device-dependent (a Chrome/Windows wheel
        // reporting deltaY=100 moves ~0.152), so even a viewport-perfect
        // ramp is off by half a notch on other mice.
        //
        // So the requirement is honoured literally: the fill-opacity is a
        // global state (`wmSeaMask`, default 0 — natural sea everywhere until
        // engaged), computed by seaMaskOpacity() (see the note there) from
        //   • the component's wheel odometer — "fourth wheel notch" as the
        //     user counts it, counted in Notches of zoom-in (from the framed
        //     landing camera), blended across one notch to soften the
        //     coastline hand-over to OSM's more generalised polygons; and
        //   • a zoom safety net anchored on the *actual* landing zoom the
        //     framing pass measured, so a flyTo on selection, the geolocate
        //     fit, the +/− buttons, keyboard or double-click zoom — none of
        //     which are wheel notches — still cover the sea once deep enough.
        //
        // Diagnostics: _notch-probe.mjs (per-notch notches/zoom/opacity sweep
        // across viewports), _sea-early.mjs (ramp previewer), _hybrid4.mjs
        // (luma sweep), _wheel-repro.mjs (zoom-in repro), _sea-luma.mjs
        // + _sea-scan.py (grid-scan the rendered sea).
        id: "sea-mask",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: {
          "fill-color": SEA_COLOR,
          // 0/natural at the landing and through three notches; flat from the
          // fourth notch on. The number is computed in WasteMap3D.tsx and
          // pushed as a global state (verified: setGlobalStateProperty
          // re-evaluates this paint immediately, with no camera movement).
          "fill-opacity": ["global-state", SEA_MASK_STATE],
        },
      },
      {
        // Esri's place names are white text on dark plates. At 0.88 they
        // dominated the frame and were a large part of why the view read as
        // heavy; 0.72 keeps them legible over both land and water without
        // letting them compete with the facilities.
        id: "places",
        type: "raster",
        source: "labels",
        paint: { "raster-fade-duration": 0, "raster-opacity": 0.72 },
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

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
