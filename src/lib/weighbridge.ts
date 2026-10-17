/**
 * Types and pure helpers for the station weighbridge data.
 * -------------------------------------------------------------------------
 * The on-disk data is stored in a **split layout** under
 * `src/data/weighbridge/` so that long histories can be loaded a year at a
 * time:
 *
 *   index.json          tiny registry: stations → { facilityId, years[], metaUrl }
 *   <STATION>/meta.json station meta: period, waste-type / district NAME tables,
 *                       streams, vehicle tasks. Names live here once.
 *   <STATION>/<YEAR>.json  one calendar year: daily[] + year-totalled
 *                          wasteTypes / districts (codes only — names are
 *                          joined from meta at assembly time).
 *
 * The raw operator exports never reach the client. They live in `data/`
 * (one file per station-month) and are read only by
 * `scripts/ingest-weighbridge.mjs`, which emits the split layout and
 * intentionally drops account numbers and licence plates so the output is
 * safe to commit.
 *
 * This file is **client-safe**: it has no `fs` and no build-time data
 * import. The server-side assembly that reads the split files lives in
 * `src/lib/weighbridgeServer.ts` and is used by the `/api/station-data`
 * route. The re-slicing functions below (`summariseStation`, `daysInRange`,
 * `bucketDays`, …) are pure: they take a fully-assembled `WeighbridgeStation`
 * and operate on its `daily[]` array, so the UI does not care whether the
 * station came from one file or from many.
 *
 * Why a split layout: with all RTS histories (multiple stations × multiple
 * years) the single-file bundle would be MB-scale and the client would
 * download every station on first paint even though it only ever renders
 * one. Splitting by station + year means a 5-year search transfers only
 * 5 year files in parallel, and a new month of data only invalidates the
 * one year file it belongs to.
 */

// ---------------------------------------------------------------------------
// Split-file layout
// ---------------------------------------------------------------------------
// These are the on-disk shapes emitted by `scripts/ingest-weighbridge.mjs`.
// The server-side loader (`weighbridgeServer.ts`) reads them and assembles a
// full `WeighbridgeStation` for the UI. The client never sees these — it
// only ever receives the assembled `WeighbridgeDataset` from the API route.

/** Per-station entry in the top-level `index.json`. */
export interface WeighbridgeIndexStation {
  /** Joins to `FacilityProperties.id` in `src/data/waste-facilities.ts`. */
  facilityId: string;
  /** Calendar years for which a year file exists, ascending. */
  years: string[];
}

/** `index.json` — small registry. */
export interface WeighbridgeIndex {
  meta: WeighbridgeMeta;
  stations: Record<string, WeighbridgeIndexStation>;
}

/**
 * `<STATION>/meta.json` — the station shell that is stable across years.
 *
 * Carries the NAME tables (waste types, districts, streams, vehicle tasks)
 * and the period totals, so the "default full-period" assembled station can
 * be produced without re-summing year files. Year files still carry their
 * own year totals (codes only) so a date-range query can sum the right
 * subset of years instead of using the all-period totals from meta.
 */
export interface WeighbridgeStationMeta {
  stationId: string;
  facilityId: string;
  period: { from: string; to: string; operatingDays: number };
  streams: WeighbridgeStream[];
  vehicleTasks: WeighbridgeVehicleTask[];
  wasteTypes: WeighbridgeWasteType[];
  /** Only the maintenance vehicle's loads, which never count as intake. */
  wasteTypesMaintenance: Array<{
    code: string;
    nameZh: string;
    nameEn: string;
    tonnes: number;
    loads: number;
  }>;
  districts: WeighbridgeDistrict[];
}

/** `<STATION>/<YEAR>.json` — one calendar year. */
export interface WeighbridgeYearPayload {
  year: number;
  daily: WeighbridgeDay[];
  /** Year totals, codes only (names come from meta). */
  wasteTypes: Array<{ code: string; tonnes: number; loads: number }>;
  districts: Array<{ code: string; tonnes: number; loads: number }>;
}

/** One code's tonnage on one day. Names live on the station, not here. */
export interface WeighbridgeDaySplit {
  code: string;
  tonnes: number;
  loads: number;
}

/** A station's daily intake. `private + public + gtw` equals `tonnes`. */
export interface WeighbridgeDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  tonnes: number;
  loads: number;
  private: number;
  public: number;
  gtw: number;
  /** Loads, not tonnage, for the same three streams. */
  privateLoads: number;
  publicLoads: number;
  gtwLoads: number;
  /**
   * That day's waste-type and source-district splits. These are what let the
   * card re-slice every figure by an arbitrary date range; the period-level
   * `wasteTypes` / `districts` below are the same rows aggregated once.
   */
  wasteTypes: WeighbridgeDaySplit[];
  districts: WeighbridgeDaySplit[];
}

/** Who delivers the waste. `share` is of received tonnage, not of loads. */
export interface WeighbridgeStream {
  key: "private" | "public" | "gtw" | "other";
  labelEn: string;
  labelZh: string;
  tonnes: number;
  loads: number;
  share: number;
}

export interface WeighbridgeWasteType {
  /** EPD waste classification code, e.g. `S40.00`. */
  code: string;
  nameZh: string;
  nameEn: string;
  /** Domestic / Commercial / Industrial / Special / Other. */
  group: string;
  tonnes: number;
  loads: number;
  /** True for grease trap waste — WKTS is the only station that takes it. */
  gtw: boolean;
}

export interface WeighbridgeDistrict {
  /** Operator's source code, e.g. `31`. */
  code: string;
  nameZh: string;
  nameEn: string;
  tonnes: number;
  loads: number;
}

export interface WeighbridgeVehicleTask {
  /** Raw task label from the export, e.g. `P99 私人車傾倒`. */
  task: string;
  stream: string;
  tonnes: number;
  loads: number;
}

export interface WeighbridgeStation {
  stationId: string;
  /** Joins to `FacilityProperties.id` in `src/data/waste-facilities.ts`. */
  facilityId: string;
  period: { from: string; to: string; operatingDays: number };
  totals: {
    /** Received waste only — excludes the station's own maintenance loads. */
    tonnes: number;
    loads: number;
    tonnesPerDay: number;
    maintenanceTonnes: number;
    maintenanceLoads: number;
  };
  daily: WeighbridgeDay[];
  streams: WeighbridgeStream[];
  vehicleTasks: WeighbridgeVehicleTask[];
  wasteTypes: WeighbridgeWasteType[];
  /** Only the maintenance vehicle's loads, which never count as intake. */
  wasteTypesMaintenance: Array<{
    code: string;
    nameZh: string;
    nameEn: string;
    tonnes: number;
    loads: number;
  }>;
  districts: WeighbridgeDistrict[];
}

export interface WeighbridgeMeta {
  source: string;
  sourceZh: string;
  /** Only weigh-ins with this 交收狀態 are counted. */
  statusKept: string;
  generatedAt: string;
  sourceFiles: string[];
  stations: string[];
  excluded: {
    notCompletedRecords: number;
    notCompletedTonnes: number;
    notCompletedByStatus: Record<string, number>;
    unparseableWeight: number;
    unknownStation: number;
    noteEn: string;
    noteZh: string;
  };
  warnings?: string[];
}

export interface WeighbridgeDataset {
  meta: WeighbridgeMeta;
  stations: Record<string, WeighbridgeStation>;
}

// The split-file data is loaded at runtime by `src/lib/weighbridgeServer.ts`
// (used from the API route), not at build time. This file stays
// client-safe — no `fs`, no synchronous data import — so it can be imported
// from the `WeighbridgeSection` component without dragging node-only code
// into the browser bundle.

// ---------------------------------------------------------------------------
// Re-slicing by date range
// ---------------------------------------------------------------------------

/**
 * A station's figures over one date window.
 *
 * Everything the card shows comes from here rather than from the raw station
 * object, so choosing a period can never leave one panel showing the old range
 * while another shows the new one — they are all computed from the same daily
 * rows in a single pass.
 */
export interface WeighbridgeSummary {
  from: string;
  to: string;
  /** Days that actually carry weigh-ins inside the window. */
  operatingDays: number;
  tonnes: number;
  loads: number;
  tonnesPerDay: number;
  /** Received waste that is not grease trap waste. */
  mswTonnes: number;
  mswLoads: number;
  /** Grease trap waste — its own stream, not part of the MSW intake. */
  gtwTonnes: number;
  gtwLoads: number;
  daily: WeighbridgeDay[];
  streams: WeighbridgeStream[];
  wasteTypes: WeighbridgeWasteType[];
  districts: WeighbridgeDistrict[];
}

/** ISO dates compare correctly as strings, so no Date objects are needed. */
export function daysInRange(
  station: WeighbridgeStation,
  from: string,
  to: string
): WeighbridgeDay[] {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  return station.daily.filter((d) => d.date >= lo && d.date <= hi);
}

/** Sum one code-keyed split across the selected days. */
function foldSplits(days: WeighbridgeDay[], pick: (d: WeighbridgeDay) => WeighbridgeDaySplit[]) {
  const totals = new Map<string, { tonnes: number; loads: number }>();
  for (const day of days) {
    for (const row of pick(day) ?? []) {
      const entry = totals.get(row.code) ?? { tonnes: 0, loads: 0 };
      entry.tonnes += row.tonnes;
      entry.loads += row.loads;
      totals.set(row.code, entry);
    }
  }
  return totals;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Recompute every figure for `from`..`to` inclusive, both ends clamped to the
 * days the station actually reports.
 *
 * Names, groups and the GTW flag are joined back on from the station-level
 * lists, so the per-day rows only have to carry codes.
 */
export function summariseStation(
  station: WeighbridgeStation,
  from: string,
  to: string
): WeighbridgeSummary {
  const available = station.period;
  const lo = (from || available.from) < available.from ? available.from : from || available.from;
  const hi = (to || available.to) > available.to ? available.to : to || available.to;
  const days = daysInRange(station, lo, hi);

  const sum = (pick: (d: WeighbridgeDay) => number) => days.reduce((a, d) => a + pick(d), 0);

  const tonnes = round(sum((d) => d.tonnes));
  const loads = sum((d) => d.loads);
  const gtwTonnes = round(sum((d) => d.gtw));
  const gtwLoads = sum((d) => d.gtwLoads);

  // Tonnage and loads per stream are both counted on the daily rows, so this
  // is a sum of real weigh-ins, not a share of the total re-divided.
  const byStream: Record<string, { tonnes: number; loads: number }> = {
    private: { tonnes: round(sum((d) => d.private)), loads: sum((d) => d.privateLoads) },
    public: { tonnes: round(sum((d) => d.public)), loads: sum((d) => d.publicLoads) },
    gtw: { tonnes: gtwTonnes, loads: gtwLoads },
  };

  const streams: WeighbridgeStream[] = station.streams
    .map((s) => {
      const v = byStream[s.key] ?? { tonnes: 0, loads: 0 };
      return { ...s, tonnes: v.tonnes, loads: v.loads, share: round(v.tonnes / (tonnes || 1)) };
    })
    .filter((s) => s.tonnes > 0)
    .sort((a, b) => b.tonnes - a.tonnes);

  const typeTotals = foldSplits(days, (d) => d.wasteTypes);
  const wasteTypes: WeighbridgeWasteType[] = station.wasteTypes
    .map((w) => ({
      ...w,
      tonnes: round(typeTotals.get(w.code)?.tonnes ?? 0),
      loads: typeTotals.get(w.code)?.loads ?? 0,
    }))
    .filter((w) => w.tonnes > 0)
    .sort((a, b) => b.tonnes - a.tonnes);

  const districtTotals = foldSplits(days, (d) => d.districts);
  const districts: WeighbridgeDistrict[] = station.districts
    .map((d) => ({
      ...d,
      tonnes: round(districtTotals.get(d.code)?.tonnes ?? 0),
      loads: districtTotals.get(d.code)?.loads ?? 0,
    }))
    .filter((d) => d.tonnes > 0)
    .sort((a, b) => b.tonnes - a.tonnes);

  const mswTonnes = round(tonnes - gtwTonnes);
  const mswLoads = loads - gtwLoads;

  return {
    from: lo,
    to: hi,
    operatingDays: days.length,
    tonnes,
    loads,
    tonnesPerDay: round(tonnes / (days.length || 1)),
    mswTonnes,
    mswLoads,
    gtwTonnes,
    gtwLoads,
    daily: days,
    streams,
    wasteTypes,
    districts,
  };
}

// ---------------------------------------------------------------------------
// Chart buckets
// ---------------------------------------------------------------------------

export type PeriodBucket = "day" | "month" | "quarter" | "year";

/** "2026-10-01" -> "2026-10-01" | "2026-10" | "2026-Q4" | "2026". */
export function bucketOf(date: string, bucket: PeriodBucket): string {
  const [y, m] = date.split("-");
  switch (bucket) {
    case "month":
      return `${y}-${m}`;
    case "quarter":
      return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
    case "year":
      return y;
    default:
      return date;
  }
}

export interface WeighbridgeBucket {
  /** Sortable key, e.g. `2026-Q4`. */
  key: string;
  tonnes: number;
  loads: number;
  private: number;
  public: number;
  gtw: number;
  /** How many days of data the bucket holds — a partial month reads as such. */
  days: number;
}

/** Group days into days / months / quarters / years, in ascending order. */
export function bucketDays(days: WeighbridgeDay[], bucket: PeriodBucket): WeighbridgeBucket[] {
  const map = new Map<string, WeighbridgeBucket>();
  for (const day of days) {
    const key = bucketOf(day.date, bucket);
    const entry =
      map.get(key) ?? { key, tonnes: 0, loads: 0, private: 0, public: 0, gtw: 0, days: 0 };
    entry.tonnes = round(entry.tonnes + day.tonnes);
    entry.loads += day.loads;
    entry.private = round(entry.private + day.private);
    entry.public = round(entry.public + day.public);
    entry.gtw = round(entry.gtw + day.gtw);
    entry.days += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Calendar years the station reports, ascending. */
export function stationYears(station: WeighbridgeStation): string[] {
  return [...new Set(station.daily.map((d) => d.date.slice(0, 4)))].sort();
}

/** First and last day of a year, clamped to what the station reports. */
export function yearRange(
  station: WeighbridgeStation,
  year: string
): { from: string; to: string } {
  const inYear = station.daily.filter((d) => d.date.startsWith(year));
  if (inYear.length === 0) return { from: station.period.from, to: station.period.to };
  return { from: inYear[0].date, to: inYear[inYear.length - 1].date };
}
