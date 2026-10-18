/**
 * Client-side loader for the split weighbridge data layout.
 * -------------------------------------------------------------------------
 * Mirrors `weighbridgeServer.ts` but reads the split files from `/public`
 * (same-origin static assets) instead of disk, so the browser gets the data
 * with no serverless round-trip or cold start. It calls the SAME shared
 * `assembleFromYearPayloads` / `yearsInRange` helpers, so the assembled
 * shape is identical to what the API route returns.
 *
 * The files are served from `/weighbridge/...` — `public/weighbridge/` is a
 * copy of `src/data/weighbridge/` produced by `scripts/ingest-weighbridge.mjs`
 * (and committed). This module is client-safe: no `fs`, no `server-only`.
 */
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

const BASE = "/weighbridge";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Read `index.json`. Throws if the static copy has not been published. */
export async function loadIndex(): Promise<WeighbridgeIndex> {
  return fetchJson<WeighbridgeIndex>(`${BASE}/index.json`);
}

async function loadStationMetaRaw(stationId: string): Promise<WeighbridgeStationMeta> {
  const id = stationId.toUpperCase();
  return fetchJson<WeighbridgeStationMeta>(`${BASE}/${id}/meta.json`);
}

async function loadYearRaw(stationId: string, year: number): Promise<WeighbridgeYearPayload> {
  const id = stationId.toUpperCase();
  return fetchJson<WeighbridgeYearPayload>(`${BASE}/${id}/${year}.json`);
}

/** Assemble one station from its static split files, optionally range-limited. */
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

/** Assemble every station — the same payload the default API call returns. */
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

/** Alias the page imports; the API route keeps `loadDataset` for symmetry. */
export const loadWeighbridgeDataset = loadDataset;

/** `meta` alone — small, used for the drawer provenance note. */
export async function loadMeta(): Promise<WeighbridgeMeta> {
  const index = await loadIndex();
  return index.meta;
}
