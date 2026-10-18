/**
 * Coarse-tile prefetch for the zoom-out gap.
 *
 * `satellite-low` in mapStyles.ts only ever fetches z9 Esri World Imagery tiles
 * (its source is capped at maxzoom 9), and Esri serves those tiles with
 * `Cache-Control: max-age=86400` and a permissive CORS header. So fetching them
 * once at startup warms the browser HTTP cache, and when the user later zooms
 * out from a facility, MapLibre's own requests for the same URLs hit the cache
 * and the underlay covers the periphery from the first frame instead of
 * streaming in behind the camera (which is what used to show the style's
 * background paint as blocks at the outer edge).
 *
 * Fire-and-forget: failures are ignored, the batch is small (~30 tiles,
 * <1 MB), and it deliberately does not start until the caller schedules it
 * after the map has loaded its own initial tiles.
 */

const ESRI_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

/** Must match the `imagery-low` source maxzoom in mapStyles.ts. */
const UNDERLAY_ZOOM = 9;

/** Generous box around the HK overview viewport (camera z10.6, pitch 50). */
const BBOX = { west: 113.3, south: 21.5, east: 115.1, north: 23.0 };

const CONCURRENCY = 6;

function tileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return [x, y];
}

let started = false;

export function prefetchUnderlayTiles(): void {
  if (started || typeof window === "undefined" || typeof fetch !== "function") return;
  started = true;

  // Leave data-saver users alone.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } })
    .connection;
  if (conn?.saveData) return;

  const [x0, y1] = tileXY(BBOX.west, BBOX.south, UNDERLAY_ZOOM);
  const [x1, y0] = tileXY(BBOX.east, BBOX.north, UNDERLAY_ZOOM);

  const urls: string[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      urls.push(`${ESRI_TILE}/${UNDERLAY_ZOOM}/${y}/${x}`);
    }
  }

  // Real concurrency pool: CONCURRENCY workers pull from a shared queue, so a
  // slow link never has the whole batch in flight at once.
  const queue = [...urls];
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      // Fire-and-forget; a failure just means the underlay streams in later.
      try {
        await fetch(url);
      } catch {
        /* ignore */
      }
    }
  };
  for (let i = 0; i < CONCURRENCY; i++) void worker();
}
