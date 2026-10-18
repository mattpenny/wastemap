import type { StyleSpecification } from "maplibre-gl";

/** Flat sea colour for the water mask — muted grey-teal, sampled from the
 * natural satellite-sea tone the user preferred (#4e6966) rather than the
 * original darker blue-teal #1a4a60. */
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
      imagery: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        // Declared as 128 (half the real 256px image size) on purpose — see the
        // note on the `satellite` layer below. MapLibre then fetches one zoom
        // level deeper and 2x supersamples, which pulls the sharp, bright z13+
        // aerial instead of the dark coarse z11/z12 mosaic.
        //
        // NOTE: this only fixes LAND sharpness. The large, tone-shifted
        // parallelograms over the water are baked into Esri's World Imagery
        // source itself (adjacent mosaic tiles are different satellite passes
        // — one overcast/grey, one clear/teal). Verified by exporting the raw
        // Esri image for the harbour with no app code involved: the seam is in
        // the source pixels. Fetching deeper zooms (tileSize 64 → z14) does not
        // remove it, so 128 is kept as the perf/sharpness balance.
        tileSize: 128,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION,
      },
      // Coarse fallback imagery, drawn beneath `satellite`. During a fast
      // zoom-out the sharp deep-zoom tiles keep covering the centre of the
      // viewport while the new wide tiles for the outer ring are still on the
      // wire — without this layer that ring shows the dark `background` paint
      // as black blocks at the edges. One z8 tile covers all of Hong Kong, so
      // it lands almost immediately and the gap reads as (softer) satellite
      // imagery instead of a black flash. Same Esri service, capped at z8 so
      // each tile is tiny.
      "imagery-low": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 8,
      },
      labels: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
      },
      // High-resolution OSM water polygons (OpenFreeMap, key-less) used to
      // paint a flat sea over the imagery. `url` fetches the TileJSON, which
      // carries the versioned tile template; maxzoom 12 keeps tiles light
      // (overzoomed above z12, plenty for a flat sea).
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
        // brief window during a `flyTo` while the destination's z13+ tiles are
        // still being fetched, and around tile edges at low zoom. It must read
        // as "water" (HK is mostly sea at this view) and not as a black void,
        // because a near-black background flashes as a full black page every
        // time the camera flies to a new facility whose tiles are uncached.
        // Picked as a dark grey-teal so the brief flash reads as "tiles
        // loading over the harbour" and matches the mask sea's tone family.
        paint: { "background-color": "#1c3434" },
      },
      {
        // Coarse underlay for the zoom-out gap — see the `imagery-low` source.
        // Must sit directly above the background and below every other layer so
        // it only ever shows where the main imagery has no tile yet.
        id: "satellite-low",
        type: "raster",
        source: "imagery-low",
        paint: { "raster-fade-duration": 0 },
      },
      {
        id: "satellite",
        type: "raster",
        source: "imagery",
        paint: {
          "raster-fade-duration": 0,
          /**
           * Two stacked measures against the dark, coarse z11–z12 mosaic Esri
           * serves over Hong Kong (z11 alone is ~19% near-black pixels, with
           * tile-aligned edges that read as big "shadows" over the sea):
           *
           *   1. The `imagery` source declares `tileSize: 128`. MapLibre picks
           *      the tile zoom from the declared tile size, so this makes it
           *      fetch one level deeper (z13+, genuine high-res aerial) and draw
           *      each 256px image into half the area — 2x supersampling. This is
           *      the real fix; the paint below only mops up the wide-out edges.
           *   2. A leftover black-point / contrast lift for the z10–z11 edges
           *      that still show at the wide end, faded to ZERO by z12.5 so it
           *      can never wash out the sharp aerial. (Raising the black point on
           *      good imagery is itself what makes it look soft and milky.)
           *
           * Both are zoom expressions on the camera zoom, so the wide view keeps
           * the lift and every closer level shows the imagery at its natural
           * tone. `raster-saturation` band-aid removed for the same reason.
           */
          "raster-brightness-min": ["interpolate", ["linear"], ["zoom"], 9.5, 0.2, 12.5, 0],
          "raster-brightness-max": 1,
          "raster-contrast": ["interpolate", ["linear"], ["zoom"], 9.5, -0.2, 12.5, 0],
        },
      },
      {
        // Sea painted from OSM's high-res water polygons.
        //
        // The paint used to be a permanently opaque tone because Esri's low-zoom
        // ocean mosaic over the harbour is dark and tone-shifted — adjacent tiles
        // are different satellite passes, so the wide view shows near-black
        // parallelograms over the water (measured: mean luma ~60 with ~15%
        // near-black pixels at z10 vs ~94 and 0% at z14 — see
        // out/verify/tiles/). That dark water is the "shadow" the mask hides.
        //
        // A permanently opaque mask throws the natural sea away though, so the
        // fill now fades out with camera zoom: near-opaque at the overview
        // (z10–z11, where the mosaic is at its worst), thin from z13 (Esri's
        // harbour water is already clean by then) and gone by z14.5 — from there
        // the bright, uniform high-res aerial shows through and the sea reads as
        // real satellite water instead of a colour fill.
        id: "sea-mask",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: {
          "fill-color": SEA_COLOR,
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.97,
            11.5,
            0.93,
            13,
            0.6,
            14.5,
            0,
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
