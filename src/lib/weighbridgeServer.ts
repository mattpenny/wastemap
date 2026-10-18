/**
 * Server-side loader for the split weighbridge data layout.
 * -------------------------------------------------------------------------
 * Reads `src/data/weighbridge/{index.json, <STATION>/meta.json,
 * <STATION>/<YEAR>.json}` from disk and assembles the same
 * `WeighbridgeStation` shape the UI consumes, by delegating the merge/sum
 * logic to the shared, client-safe helpers in `src/lib/weighbridge.ts`
 * (`assembleFromYearPayloads`, `yearsInRange`).
 *
 * The split layout means a date-range request reads only the intersecting
 * year files instead of transferring the full multi-year history. The default
 * (no range) assembles the full station so existing clients keep working.
 *
 * This module is server-only. It is imported from the `/api/station-data`
 * route and must not be pulled into a client component — keep it that way by
 * not re-exporting from `@/lib/weighbridge`.
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import {
  assembleFromYearPayloads,
  yearsInRange,
  type AssembleOptions,
  type WeighbridgeDataset,
  type WeighbridgeIndex,
  type WeighbridgeMeta,
  type WeighbridgeStation,
  type WeighbridgeStationMeta,
  type WeighbridgeYearPayload,
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
  return readJsonCached<WeighbridgeStationMeta>(path.join(DATA_ROOT, id, "meta.json"));
}

async function loadYearRaw(stationId: string, year: number): Promise<WeighbridgeYearPayload> {
  const id = stationId.toUpperCase();
  return readJsonCached<WeighbridgeYearPayload>(path.join(DATA_ROOT, id, `${year}.json`));
}

/**
 * Build a full `WeighbridgeStation` for one station, optionally restricted
 * to a date range. Delegates the merge/sum to the shared helper; only the
 * disk reads are server-specific here.
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
  const wantedYears = yearsInRange(indexEntry.years, opts.from, opts.to);
  const yearPayloads = await Promise.all(
    wantedYears.map((y) => loadYearRaw(id, Number(y)))
  );
  return assembleFromYearPayloads(meta, yearPayloads, opts);
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
