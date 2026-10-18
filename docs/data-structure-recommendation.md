# Weighbridge data structure — recommendation for long search periods

> Reference for the structure that backs the `WeighbridgeSection` in the
> facility drawer. The goal is fast loads over long date ranges, and a
> straightforward way to add new RTS stations or more months of records.

## TL;DR

Keep the raw exports exactly as they are. Run **one** ingest step that
pre-aggregates them into a **per-station, per-year split** on disk. The
API then reads only the year files that cover the requested range, so a
5-year search touches 5 small JSON files in parallel instead of the
entire history.

This is what is already wired and running in the app.

## 1. Keep the raw exports as-is

Drop every operator export into a gitignored `data/` folder, unchanged, filed
under its station:

```
data/
  WKTS/
    wkts202608.json   # one file per month, as received
    wkts202609.json
    wkts202610.json
  IETS/
    iets202610.json
  NENT/               # landfills and I·PARK1 have their own folders
  HKIWMF/
  OITF/               # all seven outlying-island sites, one folder
```

The folder is the station: `WKTS IETS IWTS STTS NLTS NWNTTS` (standalone RTS),
`NENT WENT` (landfills), `HKIWMF` (I·PARK1), `OITF` (the group). Files are found
recursively, so `WKTS/2026/10/…` works too. Do **not** reshape them at the
source — the ingest reads every `*.json` under `data/`, merges the months into
one year file per station, and reconciles per-day breakdowns against period
totals, failing fast if the export's own totals don't add up. Re-aggregating on
ingest means future format tweaks stay a one-file change in
`scripts/ingest-weighbridge.mjs`, not a re-export from the operator.

Because each run is a full rebuild from the files on disk, the folder has to
stay **complete and deduplicated**: deleting a month's file removes that month
from the aggregate, and a re-sent copy beside the original is counted twice
(the ingest reports the overlapping dates, naming both files).

The root is configurable, so the exports can stay where they already live
(NAS share, synced drive) instead of being copied into the repo:

```bash
WASTEMAP_DATA_DIR='\\NAS\weighbridge' npm run ingest
```

An externally supplied root is read-only to the ingest — it will not create
station folders there, and a missing root is an error rather than a directory
to create. This is what lets the map and another consumer of the same exports
(a dashboard, a BI tool) read one dataset side by side, with no API between
them.

### Raw export format

Each file is a JSON **array** of weigh-in rows. The ingest reads only these
keys — anything else is ignored, and `賬戶號碼` / `車牌` are never read:

| Key | Example | Used for |
|---|---|---|
| `日期` | `"01/10/2026"` (DD/MM/YYYY) | the day the row belongs to |
| `交收狀態` | `"完成"` | only `完成` is counted; `取消` / `拒絕` are reported in `meta.excluded` |
| `車輛任務` | `"P99 私人車傾倒"` | the leading code (P99 / C31 / G01 / P97 / F04) picks the stream |
| `物料重量` | `"2.39"` | tonnes (string or number) |
| `廢物類別` | `"P01.00 商業垃圾 - 混合垃圾"` | waste-type code + description |
| `來源` | `"15 觀塘區"` | source district code + name |
| `StationId` | `"WKTS"` | which station |

Minimal row:

```json
{
  "日期": "01/10/2026",
  "交收狀態": "完成",
  "車輛任務": "P99 私人車傾倒",
  "物料重量": "2.39",
  "廢物類別": "P01.00 商業垃圾 - 混合垃圾",
  "來源": "15 觀塘區",
  "StationId": "WKTS"
}
```

The filename does not matter to the ingest — **every** `*.json` under `data/`
is read (case-insensitive), so use a clear convention such as
`<station><yyyymm>.json` (`wkts202610.json`). Save as UTF-8. Do not drop
unrelated JSON in `data/`; a non-array file is skipped with a warning.

A new **station folder** must exist in `STATIONS` in
`scripts/ingest-weighbridge.mjs` (currently WKTS, IETS, IWTS, STTS, NLTS,
NWNTTS, NENT, WENT, HKIWMF, OITF); the ingest creates the folder if it is
missing, and reports — rather than guesses at — a folder it does not know.
Rows whose `StationId` is unknown but which sit in a known folder are
attributed to that folder; when the two disagree the row wins and a warning is
recorded.

## 2. Pre-aggregate to a per-year split (live layout)

`npm run ingest` (script: `scripts/ingest-weighbridge.mjs`) reads every
`*.json` under `data/` and emits a tree under `src/data/weighbridge/`:

```
src/data/weighbridge/
  index.json                  # registry: which stations, which years, meta
  WKTS/
    meta.json                 # station shell: names, period, streams,
                              #   vehicle tasks, waste types, districts
    2026.json                 # 2026 daily rows + per-year waste/district totals
  OPEK/
    meta.json
    2026.json
    2027.json                 # add a year, the loader just picks it up
```

- `index.json` is small (≈ 1 KB today) and changes only when stations
  are added or removed. It carries the meta block (`sourceFiles`,
  `excluded`, `stations`) so the default API call keeps returning the
  same shape the UI already consumes.
- Each `<STATION>/meta.json` is a station's static shell — names, the
  reporting period, the stream / vehicle-task / waste-type / district
  dictionaries. It is read on every request and is small (≈ 8 KB).
- Each `<STATION>/<YEAR>.json` holds that year's `daily[]` rows plus
  pre-summed `wasteTypes` and `districts` for the year. It is the only
  thing a range query reads selectively.

This split is what makes long search periods fast: the loader computes
the set of years that intersect the requested window and reads only
those files. Six parallel reads, not one 200 MB blob.

## 3. Range queries read only intersecting years

`/api/station-data` accepts `?from=YYYY-MM-DD` and `?to=YYYY-MM-DD`. The
loader (`src/lib/weighbridgeServer.ts`, marked `server-only`):

1. Reads `index.json` to find which years the station has.
2. Filters to the years that overlap the window.
3. Reads those year files **in parallel** and merges their `daily[]`,
   summing `wasteTypes` / `districts` across the chosen years.
4. Returns a `WeighbridgeStation` whose `period` reflects the window,
   so the client's `summariseStation(records, from, to)` clamps
   correctly and the day/month/quarter/year chart can never disagree
   with the totals.

Default (no range) reads every year file but goes through the same
loader, so existing clients keep working unchanged.

Verified: a request for `2026-10-05 → 2026-10-10` against the current
data returns 6 operating days and 20,653.7 t — it only touches
`WKTS/2026.json` (one file). With five years of history, a one-week
search would still read one file; a five-year search would read five.

## 4. What the per-day breakdown carries (and why it stays)

Each `daily` row already carries, per day:

- `wasteTypes[]` — `{code, tonnes, loads}` (codes only; names and the
  GTW flag are joined from `meta.json`).
- `districts[]` — same shape, district codes.
- `privateLoads` / `publicLoads` / `gtwLoads` — the three streams
  (P99 / C31+G01 / P97), reported per-weigh-in by the operator, not
  derived by tonnage split.

These per-day breakdowns are the reason the card can be re-sliced to
any sub-period after a single load. Without them, only the period
totals and the stream split could honour a date filter; both ranked
lists (waste types, districts) would stay pinned to the whole history.
Re-deriving them by tonnage split would be inventing a number.

The split layout does not change this. The per-day rows live in the
year file; the loader returns them all (or only the in-range subset
for a range query) and `summariseStation` / `bucketDays` re-slices
client-side as before.

## 5. How to add more RTS records or new stations

There is no other moving part. The workflow:

1. **More months for an existing station.** Drop the new export in the
   station's folder (e.g. `data/WKTS/wkts202611.json`) and run
   `npm run ingest`. It reads every file, merges by station, emits a new
   `WKTS/2026.json` (or `WKTS/2027.json` if the month spans the year
   boundary) and a fresh `WKTS/meta.json`. The route picks up the new year
   automatically. Keep the earlier months in place — the run is a full
   rebuild, so a removed file removes its month.
2. **A new RTS station.** Drop its exports in its folder and run
   `npm run ingest`. A new `<STATION>/` directory is created with its
   `meta.json` and the year files the data covers, and the index is
   updated. The folder name selects the facility via `STATIONS`; a
   disagreement with the rows' `StationId` is reported, and rows with no
   usable `StationId` fall back to the folder.
3. **A typo or code change in the export.** The ingest normalises
   `S42.00` / case duplicates into one row and maps `P99 → private`,
   `C31`+`G01 → public/FEHD`, `P97 → GTW` (its own stream). Codes
   outside the known dictionary fail reconciliation so they surface
   before they reach the UI.
4. **PII guard.** The ingest still aborts if an export carries an
   account or vehicle-plate field, so a future export change cannot
   silently leak identifiers into the committed JSON.

The split files are committed; the raw `data/` is gitignored.

## 6. Why JSON, and when to revisit

JSON is kept for the same reasons as the existing monolith: it is
human-readable, diff-friendly, and the static / server layer gzips it
on the wire. At the current scale (one station, one year ≈ 52 KB
pretty-printed) the gzip overhead of a few small files is negligible
and the loader reads them in parallel.

Switch to a binary format (Parquet, Arrow, MessagePack) only if:

- station count grows past the point where a default full-dataset call
  gets heavy enough to need columnar reads, or
- a single year file approaches the point where the gzipped JSON
  transfer is larger than a binary equivalent.

Neither is true today. When either becomes true, the swap is
contained to `weighbridgeServer.ts` and the ingest's final write block
— the per-day row shape is already flat enough to map 1:1.

## 7. What not to change

- Keep the re-slicers (`summariseStation`, `daysInRange`, `bucketDays`)
  unchanged. They already consume a `WeighbridgeStation` and the loader
  hands them the same shape they had before.
- Keep `交收狀態 === "完成"` as the only kept status; the
  `meta.excluded` block continues to report the count and tonnage of
  `取消` / `拒絕` rows so nothing is hidden.
- Keep the station's own maintenance loads (`F04`) reported
  separately. They live in `meta.wasteTypesMaintenance` and are not
  folded into intake.

## 8. Files touched by this design

- `src/lib/weighbridge.ts` — types and pure re-slicers (client-safe).
- `src/lib/weighbridgeServer.ts` — `server-only` loader with mtime
  cache and `from` / `to` range support.
- `src/app/api/station-data/route.ts` — accepts `?station=`,
  `?facility=`, `?from=`, `?to=`, `?pretty=1`. 400 on malformed dates,
  404 on unknown station / facility, 503 if the split layout has not
  been ingested.
- `scripts/ingest-weighbridge.mjs` — emits the split layout.
- `src/data/weighbridge/` — generated; `index.json` + per-station
  `meta.json` + per-year files.

When you are ready to send the next batch of RTS records, the only
thing to do is drop the exports in `data/` and rerun the ingest — no
code change needed.
