import type { StyleSpecification } from "maplibre-gl";

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

export type MapStyleId = "official" | "satellite" | "aerial";

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
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION,
      },
      labels: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0b1220" },
      },
      {
        id: "satellite",
        type: "raster",
        source: "imagery",
        paint: {
          "raster-fade-duration": 0,
          /**
           * Esri's World Imagery mosaic over Hong Kong is dramatically darker at
           * its low zoom levels than at z12+. Measured over the same area:
           *
           *   z10  mean luminance 61.8, 9.1% near-black pixels
           *   z11  mean luminance 54.8, 18.6% near-black pixels
           *   z12  mean luminance 68-85, 0.1-0.9% near-black pixels
           *
           * The default view renders z11 tiles, so those near-black patches read
           * as large "shadows" across the map with tile-aligned edges. Raising
           * the black point and easing contrast removes them at every zoom
           * without washing the imagery out.
           */
          "raster-brightness-min": 0.16,
          "raster-brightness-max": 1,
          "raster-contrast": -0.15,
          "raster-saturation": 0.05,
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

/**
 * Lands Department aerial imagery (官方航拍).
 *
 * The same MapAPI the official cartographic map uses, on its `imagery` layer.
 * Worth having as its own style because Esri's World Imagery over Hong Kong is
 * a multi-date mosaic: it carries visible cloud shadows (measured over the sea
 * south-west of Lamma, Esri reads ~31 luminance where the Lands Department's
 * own survey reads ~78 across the same tiles) and hard tile seams. This layer
 * is one agency's survey, so it is consistent — and it is the official record
 * for the territory.
 *
 * The catch, and the reason it is not the default: it is served as PNG only
 * (`.jpg`/`.webp` both 404) at ~161 KB a tile against Esri's ~10 KB, which is
 * ~22 MB for the opening view instead of 1.7 MB. It is a deliberate opt-in.
 */
export function aerialStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      imagery: {
        type: "raster",
        tiles: [`${HKG_MAPAPI}/imagery/WGS84/{z}/{x}/{y}.png`],
        // Native 256 — this imagery is genuinely high-resolution at z13+, so
        // unlike the Esri source it needs no tile-zoom nudge.
        tileSize: 256,
        maxzoom: 19,
        attribution: LANDSD_ATTRIBUTION,
      },
      labels: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0b1220" },
      },
      {
        id: "aerial",
        type: "raster",
        source: "imagery",
        paint: { "raster-fade-duration": 0 },
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
  if (id === "aerial") {
    return aerialStyle();
  }
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
