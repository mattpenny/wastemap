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

Drop every operator export into a gitignored `data/` folder, unchanged:

```
data/
  wkts202610.json     # one file per station per month, as received
  wkts202611.json
  ...
  opek202609.json     # next station
  opek202610.json
```

Do **not** reshape them at the source — the ingest reads every
`data/*.json` and reconciles per-day breakdowns against period totals,
failing fast if the export's own totals don't add up. Re-aggregating on
ingest means future format tweaks stay a one-file change in
`scripts/ingest-weighbridge.mjs`, not a re-export from the operator.

## 2. Pre-aggregate to a per-year split (live layout)

`npm run ingest` (script: `scripts/ingest-weighbridge.mjs`) reads every
`data/*.json` and emits a tree under `src/data/weighbridge/`:

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

1. **More months for an existing station.** Drop the new export in
   `data/` (e.g. `wkts202611.json`) and run `npm run ingest`. It reads
   every file, merges by station, emits a new `WKTS/2026.json` (or
   `WKTS/2027.json` if the month spans the year boundary) and a fresh
   `WKTS/meta.json`. The route picks up the new year automatically.
2. **A new RTS station.** Drop its exports in `data/` and run
   `npm run ingest`. A new `<STATION>/` directory is created with its
   `meta.json` and the year files the data covers, and the index is
   updated. The facility id in the export must match the map's
   `facilityId` for `?facility=rts-…` to resolve; the ingest
   reconciles this and aborts on an unknown station.
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
