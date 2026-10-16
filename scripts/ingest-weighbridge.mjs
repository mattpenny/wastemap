#!/usr/bin/env node
/**
 * Ingest raw RTS weighbridge exports into the compact aggregate the app serves.
 * -------------------------------------------------------------------------
 * Input   data/*.json — raw station weighbridge exports, one row per weigh-in.
 *         Fields used: 日期, 交收狀態, 車輛任務, 物料重量, 廢物類別, 來源,
 *         StationId. (賬戶號碼 and 車牌 are deliberately never read.)
 * Output  src/data/weighbridge.json — aggregates only, no account numbers and
 *         no licence plates, so the file is safe to commit to a public repo.
 *
 * Rules, in the order they are applied:
 *   1. Keep 交收狀態 === "完成" only. 取消 / 拒絕 rows are counted and reported
 *      in `meta.excluded`, never summed.
 *   2. Split each row into a *stream* from 車輛任務: private (P99), public
 *      (C31 + G01), grease trap waste (P97), or station maintenance (F04).
 *      Maintenance is the station's own upkeep, not waste received from a
 *      customer, so it is reported separately and excluded from intake totals.
 *   3. Canonicalise 廢物類別. The source has real inconsistencies — "S42.00
 *      Specia Waste - Dewatered" (typo) and "S42.00 Special Waste - Dewatered"
 *      (case) are the same category and must not be two rows.
 *   4. Group by station, then by day, waste type, source district and vehicle
 *      task.
 *
 * The waste-type and district breakdowns are emitted **per day as well as for
 * the period** (`daily[].wasteTypes` / `daily[].districts`). That is what lets
 * the app re-slice the card by an arbitrary date range: without it the only
 * date-filterable numbers would be the headline totals and the stream split,
 * and the two ranked lists would have to stay pinned to the whole period. The
 * per-day rows carry codes only — names and the GTW flag live once on the
 * station, and the app joins them back on.
 *
 * Run:  npm run ingest
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "src", "data", "weighbridge");
const INDEX_FILE = path.join(OUT_DIR, "index.json");
const STATIONS_DIR = path.join(OUT_DIR, "stations");
const MANIFEST_FILE = path.join(ROOT, "src", "data", "weighbridge", "manifest.ts");

/** Every day row the month files hold for a station, in date order. */
function monthFilesFor(stationId) {
  return [...monthFiles.entries()]
    .filter(([key]) => key.startsWith(`${stationId}/`))
    .flatMap(([, data]) => data.daily);
}

// ---------------------------------------------------------------------------
// Station code -> facility id in src/data/waste-facilities.ts
// ---------------------------------------------------------------------------
// The six standalone RTS. OITF substations are not weighbridge stations.
const STATION_TO_FACILITY = {
  WKTS: "rts-west-kowloon",
  IETS: "rts-island-east",
  IWTS: "rts-island-west",
  STTS: "rts-shatin",
  NLTS: "rts-north-lantau",
  NWNTTS: "rts-nwnt",
};

// ---------------------------------------------------------------------------
// Vehicle task -> stream
// ---------------------------------------------------------------------------
// Matched on the leading code so a reworded Chinese suffix cannot break it.
const TASK_STREAM = [
  { prefix: "P97", stream: "gtw" },
  { prefix: "C31", stream: "public" },
  { prefix: "G01", stream: "public" },
  { prefix: "P99", stream: "private" },
  { prefix: "F04", stream: "maintenance" },
];

const STREAM_META = {
  private: { labelEn: "Private vehicles", labelZh: "私人車" },
  public: { labelEn: "FEHD / public", labelZh: "食環署" },
  gtw: { labelEn: "Grease trap waste", labelZh: "隔油池廢物" },
  maintenance: { labelEn: "Station maintenance", labelZh: "維護車" },
  other: { labelEn: "Other", labelZh: "其他" },
};

/** Streams that count as waste received from a customer. */
const INTAKE_STREAMS = new Set(["private", "public", "gtw", "other"]);

// ---------------------------------------------------------------------------
// Waste type codes -> English label + group
// ---------------------------------------------------------------------------
// The source only carries Chinese descriptions. These English labels are
// translations of the EPD waste classification codes, not a separate source.
const WASTE_TYPES = {
  "A01.00": { en: "Pulp production facility – light residue", group: "Other" },
  "D01.00": { en: "Domestic – mixed", group: "Domestic" },
  "D03.00": { en: "Domestic – furniture (bulky)", group: "Domestic" },
  "D05.00": { en: "Domestic – other bulky mixed", group: "Domestic" },
  "D06.00": { en: "Domestic – gully waste, grit, sand and rubble", group: "Domestic" },
  "D09.00": { en: "Domestic – marine (floating) refuse", group: "Domestic" },
  "I01.00": { en: "Industrial – mixed", group: "Industrial" },
  "I06.00": { en: "Industrial – other bulky mixed", group: "Industrial" },
  "P01.00": { en: "Commercial – mixed", group: "Commercial" },
  "P03.00": { en: "Commercial – furniture (bulky)", group: "Commercial" },
  "P04.02": { en: "Commercial – leaves, grass cuttings and twigs", group: "Commercial" },
  "P05.00": { en: "Commercial – other bulky mixed", group: "Commercial" },
  "P07.00": { en: "Commercial – market waste", group: "Commercial" },
  "P09.02": { en: "Commercial – wooden pallets", group: "Commercial" },
  "P13.00": { en: "Commercial – textiles / rags", group: "Commercial" },
  "S40.00": { en: "Special – grease trap waste (GTW)", group: "Special" },
  "S40.03": { en: "Special – LRA", group: "Special" },
  "S42.00": { en: "Special – dewatered", group: "Special" },
};

/** Waste codes that are grease trap waste. Only WKTS takes this stream. */
const GTW_CODES = new Set(["S40.00"]);

// ---------------------------------------------------------------------------
// Source district codes -> English label
// ---------------------------------------------------------------------------
const DISTRICTS = {
  "11": "Yau Tsim Mong",
  "12": "Sham Shui Po",
  "13": "Kowloon City",
  "14": "Wong Tai Sin",
  "15": "Kwun Tong",
  "21": "Central and Western",
  "22": "Wan Chai",
  "23": "Eastern",
  "24": "Southern",
  "31": "Kwai Tsing",
  "32": "Tsuen Wan",
  "33": "Tuen Mun",
  "34": "Yuen Long",
  "35": "North",
  "36": "Tai Po",
  "37": "Sha Tin",
  "38": "Sai Kung",
  // The operator splits Lantau rather than using a single Islands code.
  "41": "North Lantau (other)",
  "51": "Tung Chung",
  "52": "Airport / cross-boundary transfer",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "01/10/2026" -> "2026-10-01". */
function toIsoDate(ddmmyyyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function toNumber(value) {
  const n = Number.parseFloat(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** Round to 3dp so the committed file stays small but stays accurate. */
const round = (n) => Math.round(n * 1000) / 1000;

/** "P01.00 商業垃圾 - 混合垃圾" -> { code: "P01.00", desc: "商業垃圾 - 混合垃圾" }. */
function parseWasteType(raw) {
  const text = String(raw ?? "").trim();
  const m = /^([A-Z]\d{2}\.\d{2})\s*(.*)$/.exec(text);
  if (m) return { code: m[1], desc: m[2].trim() };
  // "S40.03 LRA" and anything else unparseable keeps its whole text as the code.
  return { code: text, desc: "" };
}

/** "31 葵青區" -> { code: "31", nameZh: "葵青區" }. */
function parseDistrict(raw) {
  const text = String(raw ?? "").trim();
  const m = /^(\d+)\s*(.*)$/.exec(text);
  if (m) return { code: m[1], nameZh: m[2].trim() };
  return { code: text, nameZh: text };
}

function streamForTask(task) {
  const text = String(task ?? "").trim();
  for (const { prefix, stream } of TASK_STREAM) {
    if (text.startsWith(prefix)) return stream;
  }
  return "other";
}

/** Accumulator: a Map keyed by a string, holding {tonnes, loads}. */
function bump(map, key, tonnes) {
  const entry = map.get(key) ?? { tonnes: 0, loads: 0 };
  entry.tonnes += tonnes;
  entry.loads += 1;
  map.set(key, entry);
}

// ---------------------------------------------------------------------------
// Read the raw exports
// ---------------------------------------------------------------------------
if (!fs.existsSync(DATA_DIR)) {
  console.error(`No ${path.relative(ROOT, DATA_DIR)}/ directory — nothing to ingest.`);
  process.exit(1);
}

const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.toLowerCase().endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error(`No .json files in ${path.relative(ROOT, DATA_DIR)}/ — nothing to ingest.`);
  process.exit(1);
}

const rows = [];
for (const file of files) {
  const full = path.join(DATA_DIR, file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch (err) {
    console.error(`  ! ${file}: not valid JSON (${err.message}) — skipped`);
    continue;
  }
  if (!Array.isArray(parsed)) {
    console.error(`  ! ${file}: expected an array of rows — skipped`);
    continue;
  }
  for (const r of parsed) rows.push({ ...r, __file: file });
  console.log(`  read ${file}: ${parsed.length} rows`);
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
const excluded = {
  notCompleted: { records: 0, tonnes: 0, byStatus: {} },
  unparseableWeight: 0,
  unknownStation: 0,
};

const stations = new Map();

for (const row of rows) {
  const status = String(row["交收狀態"] ?? "").trim();
  const weight = toNumber(row["物料重量"]);

  // 1. 完成 only.
  if (status !== "完成") {
    excluded.notCompleted.records += 1;
    excluded.notCompleted.tonnes += weight ?? 0;
    excluded.notCompleted.byStatus[status] = (excluded.notCompleted.byStatus[status] ?? 0) + 1;
    continue;
  }
  if (weight === null) {
    excluded.unparseableWeight += 1;
    continue;
  }

  const stationId = String(row["StationId"] ?? "").trim();
  if (!STATION_TO_FACILITY[stationId]) {
    excluded.unknownStation += 1;
    continue;
  }

  const iso = toIsoDate(String(row["日期"] ?? ""));
  if (!iso) continue;

  const task = String(row["車輛任務"] ?? "").trim();
  const stream = streamForTask(task);
  const { code: wasteCode, desc: wasteZh } = parseWasteType(row["廢物類別"]);
  const district = parseDistrict(row["來源"]);

  let station = stations.get(stationId);
  if (!station) {
    station = {
      stationId,
      facilityId: STATION_TO_FACILITY[stationId],
      days: new Map(),
      streams: new Map(),
      tasks: new Map(),
      wasteTypes: new Map(),
      wasteTypesMaintenance: new Map(),
      districts: new Map(),
      totals: { tonnes: 0, loads: 0, maintenanceTonnes: 0, maintenanceLoads: 0 },
      wasteDescZh: new Map(),
      districtZh: new Map(),
      gtwByTask: 0,
      gtwByCode: 0,
    };
    stations.set(stationId, station);
  }

  station.wasteDescZh.set(wasteCode, wasteZh);

  const isMaintenance = !INTAKE_STREAMS.has(stream);
  if (isMaintenance) {
    station.totals.maintenanceTonnes += weight;
    station.totals.maintenanceLoads += 1;
    bump(station.wasteTypesMaintenance, wasteCode, weight);
    // Maintenance is reported on its own and never enters the intake
    // aggregates below — including `streams`, which is the received-waste
    // split and must add up to `totals.tonnes`.
    continue;
  }

  station.totals.tonnes += weight;
  station.totals.loads += 1;
  station.gtwByTask += stream === "gtw" ? 1 : 0;
  station.gtwByCode += GTW_CODES.has(wasteCode) ? 1 : 0;

  const day = station.days.get(iso) ?? {
    tonnes: 0,
    loads: 0,
    private: 0,
    public: 0,
    gtw: 0,
    privateLoads: 0,
    publicLoads: 0,
    gtwLoads: 0,
    wasteTypes: new Map(),
    districts: new Map(),
  };
  day.tonnes += weight;
  day.loads += 1;
  // Per-stream tonnage *and* per-stream loads: the app re-slices both, and
  // splitting loads by tonnage to recover them later would be inventing a
  // number rather than counting one.
  if (stream === "gtw") {
    day.gtw += weight;
    day.gtwLoads += 1;
  } else if (stream === "public") {
    day.public += weight;
    day.publicLoads += 1;
  } else if (stream === "private") {
    day.private += weight;
    day.privateLoads += 1;
  }
  // The per-day splits the date picker re-slices. Same rows, same rules as the
  // period aggregates — these are not a second source.
  bump(day.wasteTypes, wasteCode, weight);
  bump(day.districts, district.code, weight);
  station.days.set(iso, day);

  bump(station.streams, stream, weight);
  bump(station.tasks, task, weight);
  bump(station.wasteTypes, wasteCode, weight);
  bump(station.districts, district.code, weight);
  station.districtZh.set(district.code, district.nameZh);
}

// ---------------------------------------------------------------------------
// Shape the output
// ---------------------------------------------------------------------------
// Split per station-month instead of one file for everything:
//
//   index.json                   one row per station, without day detail: the
//                                period, the totals, the stream split and the
//                                waste-type / district splits, plus the list of
//                                months that exist. This is what the app loads
//                                at start-up, and its size grows with the
//                                number of *stations*, not with the number of
//                                days — which is what keeps a three-year search
//                                cheap.
//   stations/<ST>/<YYYY-MM>.json  the day rows for one month, with their own
//                                splits. Fetched only for the station that is
//                                actually open.
//   manifest.ts                  static imports of every month file. A computed
//                                import path is not traced by the bundler, so
//                                the serverless function would not carry them.
//
// The month files map 1:1 onto the operator's own monthly exports, so adding a
// month is "drop the file in and re-run the ingest" — no renumbering, no
// rewriting of the months already ingested.
const warnings = [];
/** Keyed `STATION/YYYY-MM`; written out below, one file each. */
const monthFiles = new Map();
const out = {
  meta: {
    source:
      "Station weighbridge exports supplied by the operator (per-weigh-in records).",
    sourceZh: "由營運方提供的轉運站地磅記錄（逐次過磅）。",
    statusKept: "完成",
    generatedAt: new Date().toISOString(),
    sourceFiles: files,
    stations: [...stations.keys()].sort(),
    excluded: {
      notCompletedRecords: excluded.notCompleted.records,
      notCompletedTonnes: round(excluded.notCompleted.tonnes),
      notCompletedByStatus: excluded.notCompleted.byStatus,
      unparseableWeight: excluded.unparseableWeight,
      unknownStation: excluded.unknownStation,
      noteEn:
        "Only 完成 (completed) weigh-ins are counted. Cancelled and rejected weigh-ins are excluded, as is the station's own maintenance-vehicle tonnage.",
      noteZh:
        "只計算「完成」的過磅記錄；「取消」及「拒絕」記錄，以及轉運站自身維護車的噸數，均不計入。",
    },
  },
  stations: {},
};

for (const [stationId, s] of [...stations].sort(([a], [b]) => a.localeCompare(b))) {
  const dayKeys = [...s.days.keys()].sort();
  const from = dayKeys[0];
  const to = dayKeys[dayKeys.length - 1];
  const operatingDays = dayKeys.length;

  if (s.gtwByTask !== s.gtwByCode) {
    warnings.push(
      `${stationId}: ${s.gtwByTask} loads arrive on grease vehicles but ${s.gtwByCode} carry a GTW waste code — check the stream/type mapping.`
    );
  }

  const sum = (map, pick) =>
    [...map.values()].reduce((acc, v) => acc + pick(v), 0);

  // One file per calendar month, keyed off the day keys already collected.
  const monthOf = (iso) => iso.slice(0, 7);
  const monthKeys = [...new Set(dayKeys.map(monthOf))].sort();

  for (const month of monthKeys) {
    const rows = dayKeys
      .filter((d) => monthOf(d) === month)
      .map((d) => {
        const day = s.days.get(d);
        const split = (map) =>
          [...map.entries()]
            .map(([code, v]) => ({ code, tonnes: round(v.tonnes), loads: v.loads }))
            .sort((a, b) => b.tonnes - a.tonnes);
        return {
          date: d,
          tonnes: round(day.tonnes),
          loads: day.loads,
          private: round(day.private),
          public: round(day.public),
          gtw: round(day.gtw),
          privateLoads: day.privateLoads,
          publicLoads: day.publicLoads,
          gtwLoads: day.gtwLoads,
          wasteTypes: split(day.wasteTypes),
          districts: split(day.districts),
        };
      });
    monthFiles.set(`${stationId}/${month}`, {
      stationId,
      facilityId: s.facilityId,
      month,
      days: rows.length,
      daily: rows,
    });
  }

  out.stations[stationId] = {
    stationId,
    facilityId: s.facilityId,
    period: { from, to, operatingDays },
    /** Months on disk for this station, ascending. Drives the date picker. */
    months: monthKeys,
    totals: {
      tonnes: round(s.totals.tonnes),
      loads: s.totals.loads,
      tonnesPerDay: round(s.totals.tonnes / operatingDays),
      maintenanceTonnes: round(s.totals.maintenanceTonnes),
      maintenanceLoads: s.totals.maintenanceLoads,
    },
    streams: [...s.streams.entries()]
      .map(([key, v]) => ({
        key,
        labelEn: STREAM_META[key]?.labelEn ?? key,
        labelZh: STREAM_META[key]?.labelZh ?? key,
        tonnes: round(v.tonnes),
        loads: v.loads,
        share: round(v.tonnes / (s.totals.tonnes || 1)),
      }))
      .sort((a, b) => b.tonnes - a.tonnes),
    vehicleTasks: [...s.tasks.entries()]
      .map(([task, v]) => ({
        task,
        stream: streamForTask(task),
        tonnes: round(v.tonnes),
        loads: v.loads,
      }))
      .sort((a, b) => b.tonnes - a.tonnes),
    wasteTypes: [...s.wasteTypes.entries()]
      .map(([code, v]) => ({
        code,
        nameZh: s.wasteDescZh.get(code) ?? "",
        nameEn: WASTE_TYPES[code]?.en ?? code,
        group: WASTE_TYPES[code]?.group ?? "Other",
        tonnes: round(v.tonnes),
        loads: v.loads,
        gtw: GTW_CODES.has(code),
      }))
      .sort((a, b) => b.tonnes - a.tonnes),
    wasteTypesMaintenance: [...s.wasteTypesMaintenance.entries()]
      .map(([code, v]) => ({
        code,
        nameZh: s.wasteDescZh.get(code) ?? "",
        nameEn: WASTE_TYPES[code]?.en ?? code,
        tonnes: round(v.tonnes),
        loads: v.loads,
      }))
      .sort((a, b) => b.tonnes - a.tonnes),
    districts: [...s.districts.entries()]
      .map(([code, v]) => ({
        code,
        nameZh: s.districtZh.get(code) ?? code,
        nameEn: DISTRICTS[code] ?? code,
        tonnes: round(v.tonnes),
        loads: v.loads,
      }))
      .sort((a, b) => b.tonnes - a.tonnes),
  };

  const st = out.stations[stationId];
  console.log(
    `  ${stationId} -> ${s.facilityId}: ${st.totals.loads} loads, ` +
      `${st.totals.tonnes.toLocaleString()} t over ${operatingDays} days ` +
      `(${st.totals.tonnesPerDay.toLocaleString()} tpd)`
  );
  const gtw = st.wasteTypes.find((w) => w.gtw);
  if (gtw) console.log(`      GTW: ${gtw.loads} loads, ${gtw.tonnes.toLocaleString()} t`);
}

if (warnings.length > 0) {
  out.meta.warnings = warnings;
  console.log("\nWarnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}

// ---------------------------------------------------------------------------
// Reconciliation: every per-day breakdown must add back up to the period
// aggregate it was cut from. If these ever disagree the app would show a
// date-filtered figure that no longer matches the full-period one, which is
// exactly the kind of quiet inconsistency this project is built to avoid.
// ---------------------------------------------------------------------------
const reconcileErrors = [];
for (const st of Object.values(out.stations)) {
  // Everything the station claims must be reproducible from the month files,
  // which are now the only place day-level rows live.
  const daily = monthFilesFor(st.stationId);
  const sums = {
    "daily tonnage": daily.reduce((a, d) => a + d.tonnes, 0),
    "daily loads": daily.reduce((a, d) => a + d.loads, 0),
    "daily waste types": daily.reduce(
      (a, d) => a + d.wasteTypes.reduce((x, w) => x + w.tonnes, 0),
      0
    ),
    "daily districts": daily.reduce(
      (a, d) => a + d.districts.reduce((x, v) => x + v.tonnes, 0),
      0
    ),
  };
  const expected = st.totals.tonnes;
  for (const [label, value] of Object.entries(sums)) {
    const want = label === "daily loads" ? st.totals.loads : expected;
    if (Math.abs(value - want) > 0.02) {
      reconcileErrors.push(
        `${st.stationId}: ${label} sum to ${value.toFixed(3)}, but the period total is ${want}`
      );
    }
  }

  // The month list in the index has to describe what is actually on disk, or
  // the date picker would offer a month that cannot be loaded.
  const onDisk = [...monthFiles.keys()]
    .filter((key) => key.startsWith(`${st.stationId}/`))
    .map((key) => key.split("/")[1])
    .sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(st.months)) {
    reconcileErrors.push(
      `${st.stationId}: index months ${st.months.join(",")} != files on disk ${onDisk.join(",")}`
    );
  }

  // Per-stream loads, which the app re-slices but does not recompute.
  for (const stream of st.streams) {
    const key = `${stream.key}Loads`;
    const total = daily.reduce((a, d) => a + (d[key] ?? 0), 0);
    if (total !== stream.loads) {
      reconcileErrors.push(
        `${st.stationId}: daily ${stream.key} loads sum to ${total}, but the period stream has ${stream.loads}`
      );
    }
  }
}
if (reconcileErrors.length > 0) {
  console.error("\nABORT: per-day breakdowns do not reconcile with the period totals:");
  for (const e of reconcileErrors) console.error(`  ! ${e}`);
  process.exit(1);
}
console.log("\nReconciled: per-day breakdowns sum to the period totals for every station.");

// ---------------------------------------------------------------------------
// Safety: the aggregate must not carry any account number or licence plate.
// ---------------------------------------------------------------------------
const serialised = JSON.stringify(out) + JSON.stringify([...monthFiles.values()]);
const leaked = new Set();
for (const row of rows) {
  for (const key of ["賬戶號碼", "車牌"]) {
    const v = String(row[key] ?? "").trim();
    if (v.length >= 4 && serialised.includes(v)) leaked.add(`${key}=${v}`);
  }
  if (leaked.size > 0) break;
}
if (leaked.size > 0) {
  console.error(
    `\nABORT: the aggregate appears to contain identifier data: ${[...leaked].join(", ")}`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write: index.json, one file per station-month, and the manifest that ties
// them together for the bundler.
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(INDEX_FILE, `${JSON.stringify(out, null, 2)}\n`, "utf-8");

// Clear month files that are no longer backed by an input, so removing an
// export cannot leave a stale month behind for the API to serve.
for (const stationDir of fs.existsSync(STATIONS_DIR) ? fs.readdirSync(STATIONS_DIR) : []) {
  const dir = path.join(STATIONS_DIR, stationDir);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir)) {
    const key = `${stationDir}/${file.replace(/\.json$/, "")}`;
    if (!monthFiles.has(key)) fs.unlinkSync(path.join(dir, file));
  }
}

let monthBytes = 0;
for (const [key, data] of [...monthFiles].sort(([a], [b]) => a.localeCompare(b))) {
  const [stationId, month] = key.split("/");
  const dir = path.join(STATIONS_DIR, stationId);
  fs.mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(data, null, 2)}\n`;
  monthBytes += body.length;
  fs.writeFileSync(path.join(dir, `${month}.json`), body, "utf-8");
}

// The manifest exists because a computed import path is invisible to the
// bundler: without static imports the month files would be missing from the
// deployed function and every request for one would 404 in production.
const manifest = [
  "/**",
  " * GENERATED by scripts/ingest-weighbridge.mjs — do not edit by hand.",
  " *",
  " * Static imports of every station-month file. The API route reads from here",
  " * rather than from disk, so the bundler carries the data into the deployed",
  " * function. Re-run `npm run ingest` after adding an export.",
  " */",
  'import type { WeighbridgeMonthFile } from "@/lib/weighbridge";',
  "",
  ...[...monthFiles.keys()]
    .sort()
    .map((key) => {
      const [stationId, month] = key.split("/");
      const ident = `${stationId}_${month.replace("-", "_")}`;
      return `import ${ident} from "./stations/${stationId}/${month}.json";`;
    }),
  "",
  "export const STATION_MONTHS: Record<string, Record<string, WeighbridgeMonthFile>> = {",
  ...[...new Set([...monthFiles.keys()].map((k) => k.split("/")[0]))].sort().map((stationId) => {
    const months = [...monthFiles.keys()]
      .filter((k) => k.startsWith(`${stationId}/`))
      .sort();
    return [
      `  ${stationId}: {`,
      ...months.map((key) => {
        const month = key.split("/")[1];
        return `    "${month}": ${stationId}_${month.replace("-", "_")} as WeighbridgeMonthFile,`;
      }),
      "  },",
    ].join("\n");
  }),
  "};",
  "",
].join("\n");
fs.writeFileSync(MANIFEST_FILE, manifest, "utf-8");

console.log(
  `\nWrote ${path.relative(ROOT, INDEX_FILE)} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB) ` +
    `and ${monthFiles.size} month file(s) (${(monthBytes / 1024).toFixed(1)} KB) — ` +
    `no account numbers or plates.`
);
