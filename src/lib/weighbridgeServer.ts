/**
 * Server-side loader for the split weighbridge data layout.
 * -------------------------------------------------------------------------
 * Reads `src/data/weighbridge/{index.json, <STATION>/meta.json,
 * <STATION>/<YEAR>.json}` and assembles the same `WeighbridgeStation` shape
 * the UI already consumes, so the `WeighbridgeSection` component and the
 * `summariseStation` re-slicer do not need to know the data is split.
 *
 * The split layout means the API can answer a date-range request by reading
 * only the intersecting year files instead of transferring the full
 * multi-year history. The default (no range) still assembles the full
 * station so existing clients keep working.
 *
 * This module is server-only. It is imported from the `/api/station-data`
 * route and must not be pulled into a client component — keep it that way by
 * not re-exporting from `@/lib/weighbridge`.
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import type {
  WeighbridgeDataset,
  WeighbridgeIndex,
  WeighbridgeMeta,
  WeighbridgeStation,
  WeighbridgeStationMeta,
  WeighbridgeYearPayload,
} from "@/lib/weighbridge";

const DATA_ROOT = path.join(process.cwd(), "src", "data", "weighbridge");

/**
 * Tiny read-through cache keyed by absolute path, invalidated by mtime.
 * The data is static between ingests, so this both avoids re-parsing on
 * every request and stays correct when a new ingest rewrites a file.
 */
const cache = new Map<string, { mtimeMs: number; data: unknown }>();

async function readJsonCached<T>(absPath: string): Promise<T> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WeighbridgeDataError("MISSING_FILE", `Weighbridge file not found: ${absPath}`);
    }
    throw err;
  }
  const hit = cache.get(absPath);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.data as T;
  const raw = await fs.readFile(absPath, "utf8");
  const data = JSON.parse(raw) as T;
  cache.set(absPath, { mtimeMs: stat.mtimeMs, data });
  return data;
}

export class WeighbridgeDataError extends Error {
  readonly code: "MISSING_FILE" | "UNKNOWN_STATION" | "UNKNOWN_FACILITY";
  constructor(code: WeighbridgeDataError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Public loader
// ---------------------------------------------------------------------------

/** Read `index.json`. Throws `MISSING_FILE` if it has not been ingested yet. */
export async function loadIndex(): Promise<WeighbridgeIndex> {
  return readJsonCached<WeighbridgeIndex>(path.join(DATA_ROOT, "index.json"));
}

async function loadStationMetaRaw(stationId: string): Promise<WeighbridgeStationMeta> {
  const id = stationId.toUpperCase();
  return readJsonCached<WeighbridgeStationMeta>(
    path.join(DATA_ROOT, id, "meta.json")
  );
}

async function loadYearRaw(stationId: string, year: number): Promise<WeighbridgeYearPayload> {
  const id = stationId.toUpperCase();
  return readJsonCached<WeighbridgeYearPayload>(
    path.join(DATA_ROOT, id, `${year}.json`)
  );
}

export interface AssembleOptions {
  /** ISO date `YYYY-MM-DD`; only years intersecting this range are read. */
  from?: string;
  to?: string;
}

/** Which years of a station are needed to cover `[from, to]`. */
function yearsInRange(years: string[], from?: string, to?: string): string[] {
  if (!from && !to) return years;
  const lo = from ?? "0000-01-01";
  const hi = to ?? "9999-12-31";
  return years.filter((y) => {
    const yStart = `${y}-01-01`;
    const yEnd = `${y}-12-31`;
    return yEnd >= lo && yStart <= hi;
  });
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Build a full `WeighbridgeStation` for one station, optionally restricted
 * to a date range. When no range is given, the station's meta supplies the
 * period totals directly (fast path). When a range is given, only the
 * intersecting year files are read and the waste-type / district totals are
 * summed across them.
 */
export async function assembleStation(
  stationId: string,
  opts: AssembleOptions = {}
): Promise<WeighbridgeStation | null> {
  const id = stationId.toUpperCase();
  const index = await loadIndex();
  const indexEntry = index.stations[id];
  if (!indexEntry) return null;

  const meta = await loadStationMetaRaw(id);
  const hasRange = Boolean(opts.from || opts.to);

  if (!hasRange) {
    // Fast path: meta already carries every period total. Still need the
    // merged `daily[]` for the client to re-slice interactively, so load all
    // year files in parallel.
    const yearPayloads = await Promise.all(
      indexEntry.years.map((y) => loadYearRaw(id, Number(y)))
    );
    const daily = yearPayloads
      .flatMap((p) => p.daily)
      .sort((a, b) => a.date.localeCompare(b.date));

    return buildStation(id, meta, daily, meta.wasteTypes, meta.districts, false);
  }

  // Range path: only fetch the years that overlap `[from, to]`, then sum
  // their waste-type / district totals and merge their daily rows.
  const wantedYears = yearsInRange(indexEntry.years, opts.from, opts.to);
  const yearPayloads = await Promise.all(
    wantedYears.map((y) => loadYearRaw(id, Number(y)))
  );
  const daily = yearPayloads
    .flatMap((p) => p.daily)
    .filter((d) => (!opts.from || d.date >= opts.from) && (!opts.to || d.date <= opts.to))
    .sort((a, b) => a.date.localeCompare(b.date));

  const wtMap = new Map<string, { tonnes: number; loads: number }>();
  const distMap = new Map<string, { tonnes: number; loads: number }>();
  for (const p of yearPayloads) {
    for (const row of p.wasteTypes) {
      const cur = wtMap.get(row.code) ?? { tonnes: 0, loads: 0 };
      cur.tonnes += row.tonnes;
      cur.loads += row.loads;
      wtMap.set(row.code, cur);
    }
    for (const row of p.districts) {
      const cur = distMap.get(row.code) ?? { tonnes: 0, loads: 0 };
      cur.tonnes += row.tonnes;
      cur.loads += row.loads;
      distMap.set(row.code, cur);
    }
  }

  const wasteTypes = meta.wasteTypes
    .map((w) => ({
      ...w,
      tonnes: round3(wtMap.get(w.code)?.tonnes ?? 0),
      loads: wtMap.get(w.code)?.loads ?? 0,
    }))
    .filter((w) => w.tonnes > 0)
    .sort((a, b) => b.tonnes - a.tonnes);

  const districts = meta.districts
    .map((d) => ({
      ...d,
      tonnes: round3(distMap.get(d.code)?.tonnes ?? 0),
      loads: distMap.get(d.code)?.loads ?? 0,
    }))
    .filter((d) => d.tonnes > 0)
    .sort((a, b) => b.tonnes - a.tonnes);

  return buildStation(id, meta, daily, wasteTypes, districts, true);
}

function buildStation(
  stationId: string,
  meta: WeighbridgeStationMeta,
  daily: WeighbridgeStation["daily"],
  wasteTypes: WeighbridgeStation["wasteTypes"],
  districts: WeighbridgeStation["districts"],
  fromRange: boolean
): WeighbridgeStation {
  const tonnes = round3(daily.reduce((a, d) => a + d.tonnes, 0));
  const loads = daily.reduce((a, d) => a + d.loads, 0);
  const operatingDays = daily.length;
  const maintenanceTonnes = meta.wasteTypesMaintenance.reduce((a, w) => a + w.tonnes, 0);
  const maintenanceLoads = meta.wasteTypesMaintenance.reduce((a, w) => a + w.loads, 0);

  return {
    stationId,
    facilityId: meta.facilityId,
    // When a range was applied, the returned `period` reflects the range
    // (so `summariseStation` clamps correctly), otherwise the meta period.
    period: fromRange && daily.length > 0
      ? {
          from: daily[0].date,
          to: daily[daily.length - 1].date,
          operatingDays,
        }
      : meta.period,
    totals: {
      tonnes,
      loads,
      tonnesPerDay: round3(tonnes / (operatingDays || 1)),
      maintenanceTonnes: round3(maintenanceTonnes),
      maintenanceLoads,
    },
    daily,
    streams: meta.streams,
    vehicleTasks: meta.vehicleTasks,
    wasteTypes,
    wasteTypesMaintenance: meta.wasteTypesMaintenance,
    districts,
  };
}

/**
 * Build the whole dataset (all stations). Used by the default API call
 * (`/api/station-data` with no parameters) so existing clients keep getting
 * the full payload they already do, just sourced from the split files.
 */
export async function loadDataset(): Promise<WeighbridgeDataset> {
  const index = await loadIndex();
  const stationEntries = await Promise.all(
    Object.keys(index.stations).map(async (id) => {
      const station = await assembleStation(id);
      return [id, station] as const;
    })
  );
  const stations: Record<string, WeighbridgeStation> = {};
  for (const [id, station] of stationEntries) {
    if (station) stations[id] = station;
  }
  return { meta: index.meta, stations };
}

/** `meta` alone — small, used for 404s and the response envelope. */
export async function loadMeta(): Promise<WeighbridgeMeta> {
  const index = await loadIndex();
  return index.meta;
}

/** List station ids that have coverage, sorted. */
export async function listStationIds(): Promise<string[]> {
  const index = await loadIndex();
  return Object.keys(index.stations).sort();
}

/** Map of facility ids that have coverage, for the API's 404 detail. */
export async function listFacilityIds(): Promise<string[]> {
  const index = await loadIndex();
  return Object.values(index.stations)
    .map((s) => s.facilityId)
    .sort();
}
