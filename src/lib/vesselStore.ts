/**
 * The app's own vessel store
 * =========================================================================
 *
 * AIS position reports live here, inside the app, rather than only in the
 * bundled JSON that ships with a build. Two files exist and they are not the
 * same thing:
 *
 *   data/vessels/tracks.json          the STORE — live, appended to at runtime,
 *                                     gitignored, never deployed
 *   src/data/vessel-tracks/tracks.json the SNAPSHOT — committed, bundled into
 *                                     the build, what a static deploy serves
 *
 * The store is what makes "store the vessel data into the app" true: anything
 * that can reach `POST /api/vessel-ingest` — the collector, a cron job, curl —
 * adds reports, and the map reads them back from `GET /api/vessel-tracks`
 * without a rebuild. The snapshot stays as the floor, so a deployment with a
 * read-only filesystem (Vercel) still shows the last published recording
 * instead of nothing.
 *
 * Server-only. `node:fs` here must never be reached from a client component —
 * the client imports `@/lib/vesselTracks`, which is pure and takes the parsed
 * payload instead.
 */

import fs from "node:fs";
import path from "node:path";

/** Where the live store lives, relative to the project root. */
export const STORE_DIR = path.join(process.cwd(), "data", "vessels");
export const STORE_FILE = path.join(STORE_DIR, "tracks.json");

/**
 * Rolling window, in hours.
 *
 * Kept in step with `DEFAULT_RETAIN_HOURS` in `scripts/collect-ais.mjs` and
 * `VESSEL_RETENTION_MS` in `@/lib/vesselTracks`. Three places because they
 * live in three runtimes (a Node script, a server route, a browser bundle) and
 * none of them can import the others' module without dragging the wrong
 * dependency along.
 */
export const DEFAULT_RETAIN_HOURS = 24;

/** One recorded AIS position report. */
export interface StoredPoint {
  /** Epoch milliseconds, from the AIS message's own UTC timestamp. */
  t: number;
  lat: number;
  lng: number;
  sog: number | null;
  cog: number | null;
  nav: number | null;
}

export interface StoredVessel {
  mmsi: string;
  imo?: string | null;
  name: string;
  destination?: string;
  draught?: number;
  points: StoredPoint[];
}

export interface VesselStore {
  version: number;
  generatedAt: string | null;
  retainHours: number;
  vessels: StoredVessel[];
}

function emptyStore(retainHours = DEFAULT_RETAIN_HOURS): VesselStore {
  return { version: 1, generatedAt: null, retainHours, vessels: [] };
}

/** The store as it is on disk, or null when there is nothing usable yet. */
export function readStore(): VesselStore | null {
  try {
    if (!fs.existsSync(STORE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as VesselStore;
    if (!parsed || !Array.isArray(parsed.vessels)) return null;
    return {
      version: Number(parsed.version) || 1,
      generatedAt: parsed.generatedAt ?? null,
      retainHours: Number(parsed.retainHours) || DEFAULT_RETAIN_HOURS,
      vessels: parsed.vessels,
    };
  } catch (error) {
    // A corrupt store must not take the map down with it: the caller falls
    // back to the bundled snapshot, which is always well-formed.
    console.error("[vesselStore] Could not read the store:", error);
    return null;
  }
}

/**
 * Write the store atomically.
 *
 * A half-written JSON file would make every later read fail, and the writer
 * here is a long-running stream that can be interrupted at any moment — so the
 * bytes go to a temporary file and are renamed into place. `rename` is atomic
 * within a filesystem, so a reader either sees the old file or the new one.
 */
export function writeStore(store: VesselStore): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  store.generatedAt = new Date().toISOString();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, STORE_FILE);
}

/**
 * Drop points older than the retention window.
 *
 * The cutoff is anchored to each vessel's **newest point**, not to `Date.now()`.
 * That is deliberate: a now-anchored prune would delete an entire recording the
 * first time the store is written after a pause of more than a day, which is
 * exactly when a user comes back to look at it. Anchoring to the data means the
 * window only slides as far as the data actually reaches.
 *
 * Returns the number of points dropped.
 */
export function prune(store: VesselStore, retainHours = DEFAULT_RETAIN_HOURS): number {
  let dropped = 0;
  for (const vessel of store.vessels) {
    if (vessel.points.length === 0) continue;
    const newest = vessel.points[vessel.points.length - 1].t;
    const cutoff = newest - retainHours * 3600 * 1000;
    const kept = vessel.points.filter((p) => p.t >= cutoff);
    dropped += vessel.points.length - kept.length;
    vessel.points = kept;
  }
  return dropped;
}

/** Reports older than this are refused — a stale replay is not a sighting. */
export const MAX_REPORT_AGE_MS = 48 * 3600 * 1000;

/**
 * Hong Kong waters, generously padded around the collector's own bounding box.
 * A report outside this is not a position in this harbour; it is a decode
 * error or a mislabelled MMSI, and storing it would put a ship in the sea off
 * Africa on a map of Hong Kong.
 */
const BOUNDS = { minLat: 21.9, maxLat: 22.6, minLng: 113.6, maxLng: 114.6 };

export interface IngestReport {
  mmsi: string;
  t: number;
  lat: number;
  lng: number;
  sog?: number | null;
  cog?: number | null;
  nav?: number | null;
}

export interface IngestOutcome {
  accepted: number;
  duplicate: number;
  rejected: number;
  /** Per-reason counts, for the API response and for the caller's log. */
  reasons: Record<string, number>;
}

/**
 * Merge validated reports into the store.
 *
 * Dedupe is by `(mmsi, t)`, not by position: the same report delivered twice
 * (a retry, two collectors, a POST replay) is the same observation and must
 * not become two dots. Out-of-order arrivals are inserted in place, because
 * AIS delivery order is not guaranteed and every reader assumes a monotonic
 * series.
 */
export function mergeReports(
  store: VesselStore,
  reports: IngestReport[],
  vessels: { mmsi: string; name?: string; imo?: string | null }[] = []
): IngestOutcome {
  const outcome: IngestOutcome = { accepted: 0, duplicate: 0, rejected: 0, reasons: {} };
  const reject = (why: string) => {
    outcome.rejected++;
    outcome.reasons[why] = (outcome.reasons[why] ?? 0) + 1;
  };

  const byMmsi = new Map(store.vessels.map((v) => [v.mmsi, v]));
  for (const meta of vessels) {
    if (!byMmsi.has(meta.mmsi)) {
      const created: StoredVessel = {
        mmsi: meta.mmsi,
        imo: meta.imo ?? null,
        name: meta.name ?? meta.mmsi,
        points: [],
      };
      store.vessels.push(created);
      byMmsi.set(meta.mmsi, created);
    }
  }

  const now = Date.now();
  for (const r of reports) {
    if (!/^\d{9}$/.test(r.mmsi)) { reject("bad_mmsi"); continue; }
    if (!Number.isFinite(r.t) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) {
      reject("not_finite");
      continue;
    }
    if (r.t > now + 5 * 60 * 1000) { reject("future"); continue; }
    if (now - r.t > MAX_REPORT_AGE_MS) { reject("too_old"); continue; }
    if (
      r.lat < BOUNDS.minLat || r.lat > BOUNDS.maxLat ||
      r.lng < BOUNDS.minLng || r.lng > BOUNDS.maxLng
    ) {
      reject("outside_hong_kong");
      continue;
    }

    let vessel = byMmsi.get(r.mmsi);
    if (!vessel) {
      // A vessel we have never seen. Create it rather than dropping the
      // report: the ingest API is the app's own door, and refusing data for
      // being new would make it useless to any second source.
      vessel = { mmsi: r.mmsi, imo: null, name: r.mmsi, points: [] };
      store.vessels.push(vessel);
      byMmsi.set(r.mmsi, vessel);
    }

    const points = vessel.points;
    // Binary search for an existing report at this instant.
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < r.t) lo = mid + 1;
      else hi = mid;
    }
    if (lo < points.length && points[lo].t === r.t) { outcome.duplicate++; continue; }

    points.splice(lo, 0, {
      t: r.t,
      lat: r.lat,
      lng: r.lng,
      sog: r.sog ?? null,
      cog: r.cog ?? null,
      nav: r.nav ?? null,
    });
    outcome.accepted++;
  }

  return outcome;
}

/** Total reports held, across every vessel. */
export function storeReportCount(store: VesselStore): number {
  return store.vessels.reduce((sum, v) => sum + v.points.length, 0);
}

export { emptyStore };
