#!/usr/bin/env node
/**
 * Ingest raw RTS weighbridge exports into the split aggregate the app serves.
 * -------------------------------------------------------------------------
 * Input   <DATA_ROOT>/<STATION>/*.json — raw station weighbridge exports, one
 *         row per weigh-in, filed under the station's own folder so a drop is
 *         self-describing:
 *
 *           WKTS/wkts202610.json
 *           IETS/iets202610.json
 *           HKIWMF/hkiwmf202610.json
 *
 *         `DATA_ROOT` is `<repo>/data` unless `WASTEMAP_DATA_DIR` says otherwise
 *         (a NAS share, a synced folder, an external drive). Only the repo-local
 *         root is written to — an external one is read as-is, so a read-only
 *         mount works. The layout, not the location, is the contract: any other
 *         reader of the same exports (a NAS dashboard, a BI tool) can sit beside
 *         this one without either depending on the other.
 *
 *         Folders are discovered recursively, so `WKTS/2026/10/…` works
 *         too, and a stray file left at the data root is still read (its rows
 *         are attributed from StationId) for backwards compatibility.
 *         Recognised folders: WKTS IETS IWTS STTS NLTS NWNTTS (the six
 *         standalone RTS), NENT WENT (landfills), HKIWMF (I·PARK1), and OITF
 *         (the seven outlying-island facilities, kept as ONE folder — the app
 *         collapses them into a single group row, so there are no per-site
 *         folders and no per-site facility to attach data to).
 *
 *         Fields used: 日期, 交收狀態, 車輛任務, 物料重量, 廢物類別, 來源,
 *         StationId. (賬戶號碼 and 車牌 are deliberately never read — they are
 *         only collected to prove they did not leak into the output.)
 *
 *         Exports are monthly (wkts202610.json = October 2026). They are NOT
 *         kept monthly in the output: every file for a station is merged, then
 *         re-split by calendar year, so `WKTS/2026.json` holds all of 2026 and
 *         the app re-slices it by date. Each run is a full rebuild from the
 *         files on disk — never incremental — so the folder must stay complete:
 *         deleting a month's file after ingesting removes that month from the
 *         aggregate, and keeping two copies of a month counts it twice (which
 *         is reported, see `overlaps` below).
 * Output  src/data/weighbridge/ — split layout, aggregates only (no account
 *         numbers, no licence plates, safe to commit):
 *
 *           index.json              small registry: stations → years
 *           <STATION>/meta.json     station shell: names, period, totals
 *           <STATION>/<YEAR>.json   one calendar year: daily + year totals
 *
 *         The split layout means the API can answer a date-range request by
 *         reading only the intersecting year files instead of transferring
 *         the whole multi-year history. See `src/lib/weighbridgeServer.ts`
 *         for the loader and `src/lib/weighbridge.ts` for the types.
 *
 * Rules, in the order they are applied:
 *   0. Attribute each file to a station from the folder it sits in, then
 *      cross-check the rows' own StationId. If the two disagree the row wins
 *      (it is the operator's label for the weighbridge) and the mismatch is
 *      reported, because a silently mis-filed export would otherwise move
 *      tonnage to the wrong facility.
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
 *   5. Merge every monthly file for a station, then re-split the days by
 *      calendar year. If two files claim the same date they are both counted —
 *      nothing in a weigh-in row distinguishes a re-sent copy from a real
 *      second delivery — but the overlap is reported with both filenames, so
 *      it cannot pass as a real increase in tonnage.
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
 *       WASTEMAP_DATA_DIR=\\\\NAS\\weighbridge npm run ingest   (read a share)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Where the raw exports live. Defaults to `<repo>/data`, but `WASTEMAP_DATA_DIR`
// can point it anywhere the process can read — a NAS share mounted as a UNC
// path, a synced folder, an external drive. The pipeline does not care where
// the files are, only that they are laid out as `<STATION>/<export>.json`; this
// is what lets the map and any other reader (a NAS dashboard, a BI tool) use
// one dataset without either becoming the other's data source.
const DATA_DIR = path.resolve(process.env.WASTEMAP_DATA_DIR ?? path.join(ROOT, "data"));
/** The repo-local drop folder, as opposed to an externally supplied root. */
const DATA_DIR_IS_LOCAL = DATA_DIR === path.join(ROOT, "data");

const OUT_ROOT = path.join(ROOT, "src", "data", "weighbridge");

// ---------------------------------------------------------------------------
// Station registry: folder name -> facility id in src/data/waste-facilities.ts
// ---------------------------------------------------------------------------
// The folder name under `data/` is the station code, and it is the thing the
// operator files against. `facilityId` is what the map keys on, so this table
// is the single join between "a folder of exports" and "a site on the map".
//
// `kind` is documentation only — it keeps the list readable and lets the
// report group the folders the way the legend does.
const STATIONS = {
  // Six standalone RTS, one weighbridge each.
  WKTS: { facilityId: "rts-west-kowloon", kind: "rts" },
  IETS: { facilityId: "rts-island-east", kind: "rts" },
  IWTS: { facilityId: "rts-island-west", kind: "rts" },
  STTS: { facilityId: "rts-shatin", kind: "rts" },
  NLTS: { facilityId: "rts-north-lantau", kind: "rts" },
  NWNTTS: { facilityId: "rts-nwnt", kind: "rts" },

  // The seven outlying-island transfer facilities are ONE group in the app:
  // EPD publishes only a combined ~90 t/d figure and the ranking card collapses
  // them into a single row, so there is no per-site facility id to attach a
  // weighbridge station to. The folder is reserved for a combined export; rows
  // filed here are reported and skipped rather than guessed at.
  OITF: { facilityId: null, kind: "group" },

  // Landfills and I·PARK1 — no exports yet, folders reserved for future drops.
  NENT: { facilityId: "landfill-nent", kind: "landfill" },
  WENT: { facilityId: "landfill-went", kind: "landfill" },
  HKIWMF: { facilityId: "ipark-shek-kwu-chau", kind: "ipark" },
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

/**
 * Remember the identifiers on a row so the finished aggregate can be checked
 * against them. Values repeat heavily (one haulier, many loads), so the set
 * stays small; the point is to be able to prove none of them was copied into
 * the output, not to keep the raw records.
 */
function noteIdentifiers(row) {
  for (const key of ["賬戶號碼", "車牌"]) {
    const value = String(row[key] ?? "").trim();
    if (value.length >= 4) identifiers.add(value);
  }
}

// ---------------------------------------------------------------------------
// Aggregation state (declared up front: rows are aggregated file-by-file)
// ---------------------------------------------------------------------------
const excluded = {
  notCompleted: { records: 0, tonnes: 0, byStatus: {} },
  unparseableWeight: 0,
  unknownStation: 0,
  noFacility: 0,
};
const stations = new Map();

/** Station codes seen in the files' own StationId, so we can report drift. */
const seenRowStations = new Set();
/** Files whose station had to be taken from the folder (rows had no usable id). */
const attributedByFolder = new Set();
/** `${folder} folder holds ${rowStation} rows` — one entry per distinct pair. */
const folderMismatches = new Set();
/** Folders that are not in STATIONS — reported, then resolved from StationId. */
const unknownFolders = new Set();
/** Account numbers / plates seen, kept only to prove none reached the output. */
const identifiers = new Set();

// ---------------------------------------------------------------------------
// Read the raw exports
// ---------------------------------------------------------------------------
// One folder per station, discovered recursively. A file's station comes from
// the folder it lives in; the row's StationId is a cross-check, not the source
// of truth — the point of the folder layout is that filing an export is enough
// to place it.
//
// The folder skeleton is part of the contract, so create any missing folder
// rather than making the operator read this file to learn the names. `data/`
// is gitignored (raw exports carry account numbers and plates), so a fresh
// clone has none of them and the first ingest is what puts them on disk.
//
// Only for the repo-local folder. An externally supplied root is someone
// else's tree — possibly a read-only share — so we read it and never write to
// it. A missing external root is an error rather than something to create:
// silently making a directory at a mistyped mount point hides the mistake.
if (!DATA_DIR_IS_LOCAL) {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(
      `Data root not found: ${DATA_DIR}\n` +
        `WASTEMAP_DATA_DIR must point at an existing folder laid out as ` +
        `<STATION>/<export>.json (is the share mounted?).`
    );
    process.exit(1);
  }
} else {
  for (const code of Object.keys(STATIONS)) {
    fs.mkdirSync(path.join(DATA_DIR, code), { recursive: true });
  }
}

/** Every .json under `dir`, at any depth, sorted for a stable run order. */
function findExports(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.toLowerCase().endsWith(".json")) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * The station folder a file sits in, or null when it is at the data root.
 * Only the first path segment counts, so `WKTS/2026/10/…` is still WKTS.
 */
function folderStationFor(absPath) {
  const parts = path.relative(DATA_DIR, absPath).split(path.sep);
  if (parts.length < 2) return null;
  return parts[0].trim().toUpperCase();
}

const files = findExports(DATA_DIR);

if (files.length === 0) {
  console.error(
    `No .json files under ${DATA_DIR}/ — nothing to ingest.\n` +
      `Drop the operator's exports into a station folder, e.g. ` +
      `${path.join(DATA_DIR, "WKTS", "wkts202610.json")}, then run this again.`
  );
  process.exit(1);
}

// Printed, not committed: `meta.sourceFiles` stays relative to the data root so
// a local mount path never ends up in the public repo.
console.log(`Data root: ${DATA_DIR}`);

// Which folders exist, including empty ones — the report shows the whole
// skeleton so a folder the operator has prepared but not filled yet is
// visibly "empty" rather than just missing from the output.
const foldersSeen = {};
for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
  if (entry.isDirectory()) foldersSeen[entry.name.trim().toUpperCase()] = 0;
}
const sourceFiles = [];
for (const full of files) {
  const code = folderStationFor(full) ?? "(root)";
  foldersSeen[code] = (foldersSeen[code] ?? 0) + 1;
}

for (const full of files) {
  // Relative to the data root, never to the repo: the root may be a NAS share,
  // and these strings are committed to a public repo via `meta.sourceFiles`.
  const rel = path.relative(DATA_DIR, full).split(path.sep).join("/");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch (err) {
    console.error(`  ! ${rel}: not valid JSON (${err.message}) — skipped`);
    continue;
  }
  if (!Array.isArray(parsed)) {
    console.error(`  ! ${rel}: expected an array of rows — skipped`);
    continue;
  }
  const folderStation = folderStationFor(full);
  // Aggregate straight into the accumulators and let the parsed array go, so
  // memory stays bounded to one file even with years of monthly exports.
  for (const r of parsed) {
    noteIdentifiers(r);
    addRow(r, folderStation, rel);
  }
  sourceFiles.push(rel);
  console.log(
    `  read ${rel}: ${parsed.length} rows` +
      (folderStation ? ` (folder ${folderStation})` : " (no station folder)")
  );
}

// ---------------------------------------------------------------------------
// Aggregate one row (called per row as each file is read)
// ---------------------------------------------------------------------------

/**
 * Which station a row belongs to.
 *
 * The folder is the operator's filing decision and the reason this script
 * walks subdirectories at all; StationId is the operator's own label on the
 * weighbridge that produced the row. They normally agree. When they do not,
 * the row wins — a folder is one keystroke away from being wrong, while the
 * row travelled with the data — and the mismatch is reported so the folder
 * can be fixed. A row with no usable StationId (a landfill export may not
 * carry one) falls back to the folder it was filed in.
 */
function resolveStation(rowStation, folderStation, rel) {
  const rowKnown = rowStation && STATIONS[rowStation] ? rowStation : null;
  const folderKnown = folderStation && STATIONS[folderStation] ? folderStation : null;

  if (folderStation && !folderKnown) unknownFolders.add(folderStation);

  if (rowKnown) {
    seenRowStations.add(rowStation);
    if (folderKnown && folderKnown !== rowKnown) {
      folderMismatches.add(`${folderKnown}/ holds ${rowStation} rows`);
    }
    return rowKnown;
  }
  if (folderKnown) {
    attributedByFolder.add(rel);
    return folderKnown;
  }
  return null;
}

function addRow(row, folderStation, rel) {
  const status = String(row["交收狀態"] ?? "").trim();
  const weight = toNumber(row["物料重量"]);

  // 1. 完成 only.
  if (status !== "完成") {
    excluded.notCompleted.records += 1;
    excluded.notCompleted.tonnes += weight ?? 0;
    excluded.notCompleted.byStatus[status] = (excluded.notCompleted.byStatus[status] ?? 0) + 1;
    return;
  }
  if (weight === null) {
    excluded.unparseableWeight += 1;
    return;
  }

  const rowStation = String(row["StationId"] ?? "").trim().toUpperCase();
  const stationId = resolveStation(rowStation, folderStation, rel);
  if (!stationId) {
    excluded.unknownStation += 1;
    return;
  }
  const facilityId = STATIONS[stationId].facilityId;
  if (!facilityId) {
    // A reserved group folder (OITF) has no single facility to attach to.
    excluded.noFacility += 1;
    return;
  }

  const iso = toIsoDate(String(row["日期"] ?? ""));
  if (!iso) return;

  const task = String(row["車輛任務"] ?? "").trim();
  const stream = streamForTask(task);
  const { code: wasteCode, desc: wasteZh } = parseWasteType(row["廢物類別"]);
  const district = parseDistrict(row["來源"]);

  let station = stations.get(stationId);
  if (!station) {
    station = {
      stationId,
      facilityId,
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
      // Which export each counted date came from, and the dates claimed by
      // more than one file. Monthly exports are merged into one year file, so
      // a re-sent or copied month is the one way to double-count silently.
      dayFile: new Map(),
      overlaps: new Set(),
    };
    stations.set(stationId, station);
  }

  const sameDay = station.dayFile.get(iso);
  if (!sameDay) {
    station.dayFile.set(iso, rel);
  } else if (sameDay !== rel) {
    station.overlaps.add(`${iso} appears in ${sameDay} and ${rel}`);
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
    return;
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
const warnings = [];
const out = {
  meta: {
    source:
      "Station weighbridge exports supplied by the operator (per-weigh-in records).",
    sourceZh: "由營運方提供的轉運站地磅記錄（逐次過磅）。",
    statusKept: "完成",
    generatedAt: new Date().toISOString(),
    // Paths relative to the data root, folder included (`WKTS/wkts202610.json`),
    // so a figure can be traced back to the export it came from without
    // publishing where the data root happens to be mounted.
    sourceFiles,
    // Which station folders were present at ingest time, and how many files
    // each held (0 = folder prepared but still empty).
    folders: foldersSeen,
    stations: [...stations.keys()].sort(),
    excluded: {
      notCompletedRecords: excluded.notCompleted.records,
      notCompletedTonnes: round(excluded.notCompleted.tonnes),
      notCompletedByStatus: excluded.notCompleted.byStatus,
      unparseableWeight: excluded.unparseableWeight,
      unknownStation: excluded.unknownStation,
      noFacility: excluded.noFacility,
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

  // A date claimed by two files means those rows were counted twice, and no
  // downstream figure can tell. Naming the files is the only way to fix it.
  if (s.overlaps.size > 0) {
    const examples = [...s.overlaps].sort().slice(0, 3);
    warnings.push(
      `${stationId}: ${s.overlaps.size} date(s) appear in more than one export, so their rows are counted twice — ` +
        `${examples.join("; ")}${s.overlaps.size > examples.length ? "; …" : ""}. ` +
        `Keep one file per month and remove re-sent copies.`
    );
  }

  const sum = (map, pick) =>
    [...map.values()].reduce((acc, v) => acc + pick(v), 0);

  out.stations[stationId] = {
    stationId,
    facilityId: s.facilityId,
    period: { from, to, operatingDays },
    totals: {
      tonnes: round(s.totals.tonnes),
      loads: s.totals.loads,
      tonnesPerDay: round(s.totals.tonnes / operatingDays),
      maintenanceTonnes: round(s.totals.maintenanceTonnes),
      maintenanceLoads: s.totals.maintenanceLoads,
    },
    daily: dayKeys.map((d) => {
      const day = s.days.get(d);
      const split = (map) =>
        [...map.entries()]
          .map(([code, v]) => ({
            code,
            tonnes: round(v.tonnes),
            loads: v.loads,
          }))
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
    }),
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

// Folder findings join the station-level warnings: a mis-filed export is the
// same class of problem as a mismatched stream/type mapping — quiet, and it
// moves tonnage to the wrong place.
for (const f of [...folderMismatches].sort()) {
  warnings.push(`${f} — attributed to the row's StationId; move the export to the matching folder.`);
}
for (const f of [...unknownFolders].sort()) {
  warnings.push(
    `data/${f}/ is not a known station folder — its rows were attributed from StationId only.`
  );
}
if (attributedByFolder.size > 0) {
  warnings.push(
    `${attributedByFolder.size} file(s) carried no usable StationId and were attributed by folder: ` +
      [...attributedByFolder].sort().join(", ")
  );
}
if (excluded.noFacility > 0) {
  warnings.push(
    `${excluded.noFacility} row(s) were filed in a group folder (OITF) that has no single facility to attach to and were skipped.`
  );
}

if (warnings.length > 0) {
  out.meta.warnings = warnings;
  console.log("\nWarnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}

// ---------------------------------------------------------------------------
// Folder report
// ---------------------------------------------------------------------------
// The folder skeleton is the filing system now, so say which folders were read
// and which are still empty. An empty folder is normal (a site with no export
// yet) — it is only a problem if it stays empty when you expected data.
console.log("\nStation folders:");
for (const [code, count] of Object.entries(foldersSeen).sort()) {
  if (code === "(root)") continue;
  const known = STATIONS[code];
  console.log(
    `  ${code}/`.padEnd(12) +
      `${String(count).padStart(3)} file${count === 1 ? "" : "s"}` +
      (count === 0 ? "  (empty)" : "") +
      (known ? "" : "  <- not a known station folder")
  );
}
if (foldersSeen["(root)"] > 0) {
  console.log(
    `  (root)          ${String(foldersSeen["(root)"]).padStart(3)} file(s) ` +
      `— attributed from StationId; move them into a station folder`
  );
}

// ---------------------------------------------------------------------------
// Reconciliation: every per-day breakdown must add back up to the period
// aggregate it was cut from. If these ever disagree the app would show a
// date-filtered figure that no longer matches the full-period one, which is
// exactly the kind of quiet inconsistency this project is built to avoid.
// ---------------------------------------------------------------------------
const reconcileErrors = [];
for (const st of Object.values(out.stations)) {
  const sums = {
    "daily tonnage": st.daily.reduce((a, d) => a + d.tonnes, 0),
    "daily loads": st.daily.reduce((a, d) => a + d.loads, 0),
    "daily waste types": st.daily.reduce(
      (a, d) => a + d.wasteTypes.reduce((x, w) => x + w.tonnes, 0),
      0
    ),
    "daily districts": st.daily.reduce(
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

  // Per-stream loads, which the app re-slices but does not recompute.
  for (const stream of st.streams) {
    const key = `${stream.key}Loads`;
    const daily = st.daily.reduce((a, d) => a + (d[key] ?? 0), 0);
    if (daily !== stream.loads) {
      reconcileErrors.push(
        `${st.stationId}: daily ${stream.key} loads sum to ${daily}, but the period stream has ${stream.loads}`
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
// Every identifier seen while reading was collected in `identifiers`; if any of
// them appears anywhere in the serialised aggregate, a field has been copied
// through that should only have been aggregated.
const serialised = JSON.stringify(out);
const leaked = [...identifiers].filter((v) => serialised.includes(v));
if (leaked.length > 0) {
  console.error(
    `\nABORT: the aggregate appears to contain identifier data (${leaked.length} value(s), ` +
      `e.g. ${leaked.slice(0, 3).join(", ")})`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit the split layout
// ---------------------------------------------------------------------------
// The aggregate in `out` was reconciled and PII-checked above; here we just
// partition it into the on-disk shape the server loader reads. We do NOT
// delete the output root first — any stale year / station file from a
// previous layout simply becomes unreferenced (the index won't list it) and
// the loader will not read it. That keeps the write step safe under the
// bulk-delete guard even if the layout has grown a lot.
fs.mkdirSync(OUT_ROOT, { recursive: true });

const indexStations = {};
let totalYearFiles = 0;
for (const stationId of Object.keys(out.stations).sort()) {
  const st = out.stations[stationId];
  const stationDir = path.join(OUT_ROOT, stationId);
  fs.mkdirSync(stationDir, { recursive: true });

  // Partition the station's daily rows by calendar year.
  const byYear = new Map();
  for (const day of st.daily) {
    const y = day.date.slice(0, 4);
    let arr = byYear.get(y);
    if (!arr) {
      arr = [];
      byYear.set(y, arr);
    }
    arr.push(day);
  }
  const years = [...byYear.keys()].sort();

  // The station shell: names + period totals, no daily. Year files cover
  // daily + year totals so a date-range request can skip the rest.
  const meta = {
    stationId: st.stationId,
    facilityId: st.facilityId,
    period: st.period,
    streams: st.streams,
    vehicleTasks: st.vehicleTasks,
    wasteTypes: st.wasteTypes,
    wasteTypesMaintenance: st.wasteTypesMaintenance,
    districts: st.districts,
  };
  fs.writeFileSync(
    path.join(stationDir, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf-8"
  );

  for (const y of years) {
    const days = byYear.get(y);
    const wtTotals = new Map();
    const distTotals = new Map();
    for (const d of days) {
      for (const row of d.wasteTypes) {
        const cur = wtTotals.get(row.code) ?? { tonnes: 0, loads: 0 };
        cur.tonnes += row.tonnes;
        cur.loads += row.loads;
        wtTotals.set(row.code, cur);
      }
      for (const row of d.districts) {
        const cur = distTotals.get(row.code) ?? { tonnes: 0, loads: 0 };
        cur.tonnes += row.tonnes;
        cur.loads += row.loads;
        distTotals.set(row.code, cur);
      }
    }
    const yearFile = {
      year: Number(y),
      daily: days,
      wasteTypes: [...wtTotals.entries()]
        .map(([code, v]) => ({ code, tonnes: round(v.tonnes), loads: v.loads }))
        .sort((a, b) => b.tonnes - a.tonnes),
      districts: [...distTotals.entries()]
        .map(([code, v]) => ({ code, tonnes: round(v.tonnes), loads: v.loads }))
        .sort((a, b) => b.tonnes - a.tonnes),
    };
    fs.writeFileSync(
      path.join(stationDir, `${y}.json`),
      `${JSON.stringify(yearFile, null, 2)}\n`,
      "utf-8"
    );
    totalYearFiles += 1;
  }

  indexStations[stationId] = { facilityId: st.facilityId, years };
}

const indexPayload = { meta: out.meta, stations: indexStations };
fs.writeFileSync(
  path.join(OUT_ROOT, "index.json"),
  `${JSON.stringify(indexPayload, null, 2)}\n`,
  "utf-8"
);

// Mirror the split layout into /public so the client can fetch it same-origin
// (no serverless round-trip or cold start). The aggregate carries no account
// numbers or licence plates, so committing the copy is safe.
const PUBLIC_DIR = path.join(ROOT, "public", "weighbridge");
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.cpSync(OUT_ROOT, PUBLIC_DIR, { recursive: true });
console.log(`  mirrored to ${path.relative(ROOT, PUBLIC_DIR)}/`);

const stationCount = Object.keys(out.stations).length;
console.log(
  `\nWrote split layout to ${path.relative(ROOT, OUT_ROOT)}/ ` +
    `(index + ${stationCount} station${stationCount === 1 ? "" : "s"} + ${totalYearFiles} year ` +
    `file${totalYearFiles === 1 ? "" : "s"}) — no account numbers or plates.`
);
