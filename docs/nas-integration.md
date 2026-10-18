# NAS integration — working notes

> Status: **open**. The dataset and the app already share a folder contract;
> how the NAS dashboard fits in is still to be decided, pending a look at its
> folders. This file records what is settled, what is implemented, and exactly
> what to collect at the office.

## The question

The operator's raw exports (July 2023 – October 2026, all six RTS plus WENT,
NENT and I·PARK, ~1 GB) live on a NAS. A dashboard runs there in Docker and
reads that data. Can the map app use the same dataset?

## What is settled

**The app does not need to talk to the dashboard.** They are two independent
readers of one folder tree, not a client and a server. The contract is the
layout — `<STATION>/<export>.json` — not the location. Neither becomes the
other's data source, and neither can break the other.

**The public site cannot reach a private LAN.** `hkwastemap.vercel.app` runs in
the visitor's browser; `192.168.x.x` is not routable from there, and an HTTPS
page cannot fetch plain HTTP from it. Making the live site read the NAS
directly would mean exposing the NAS to the internet — and it holds raw
per-weigh-in records with account numbers and licence plates. Not acceptable.

**Only the aggregate ever leaves the NAS.** The map consumes ~36 MB of daily
totals (1,218 days × 9 stations at the measured 3,435 B/station-day), not the
1 GB of weigh-ins. The reduction happens in `npm run ingest`.

## What is implemented

`WASTEMAP_DATA_DIR` (commit `baee325`) points the ingest at any readable folder,
so the exports can stay on the NAS instead of being copied into the repo:

```bash
WASTEMAP_DATA_DIR='\\NAS\weighbridge' npm run ingest
```

- Default stays `<repo>/data`.
- An **external root is read-only** to the ingest — no station folders are
  created there, so a read-only mount works.
- A **missing root is an error, not a directory to create**, so a mistyped
  mount point cannot silently become an empty tree.
- `meta.sourceFiles` is relative to the data root (`WKTS/wkts202610.json`), so
  a local mount path never reaches the public repo.

Verified against an external root (identical figures: 12,015 loads /
50,033.36 t) and against a bad path (clear error, exit 1).

## The three ways it could work

| Option | How | Cost | Keeps PII on the NAS |
|---|---|---|---|
| **A. NAS publishes the aggregate** | Scheduled job on the NAS runs the ingest and pushes the regenerated aggregate; Vercel rebuilds. | Needs a deploy key/token on the NAS; data freshness = job interval. | Yes |
| **B. Run the map on the NAS too** | Dockerise the app beside the dashboard; it reads the mount directly. | Needs `output: "standalone"` re-added (deliberately removed — see the comment in `next.config.mjs`); reachable only on the LAN or over VPN. | Yes |
| **C. Live fetch from the NAS** | Public site calls the NAS. | Requires exposing the NAS (tunnel/DDNS + TLS) and serving PII-bearing data from home. | **No — rejected** |

Option A keeps the public site public and fast. Option B is right if the map
is for internal use only.

## Open question — what does the dashboard actually read?

This decides whether the map needs an adapter:

- **It reads the monthly exports directly** → nothing to build. Point
  `WASTEMAP_DATA_DIR` at the share and the two coexist.
- **It loads them into its own database** → the map needs either an export step
  from that database back to the monthly-file shape, or an adapter that queries
  it. That is a real piece of work and needs the schema.

## What to collect at the office

Bring back these, and the decision is straightforward. **Do not paste
credentials into this file** — redact them.

1. **Containers.** `docker ps` — names and images, so I can tell whether it is
   Grafana / Metabase / a custom app.
2. **Compose file or run command.** Especially the volume mounts: which host
   path maps to which container path. That is the folder the map would read.
3. **The folder tree.** `find <mount> -maxdepth 3 | head -100`, plus file counts
   and total size — is it one folder per station, one file per month, or
   something else?
4. **Sample filenames.** Two or three real names per station, so I can see
   whether the `<station><yyyymm>.json` convention already holds.
5. **Is there a database?** A `pgdata`/`mysql` volume, a `.db`/`.sqlite` file, or
   nothing but files. If there is one, a schema dump (`\d` in psql, or
   `.schema` in sqlite) and one anonymised sample row.
6. **Does the dashboard write anything back?** A watch folder, a normalised copy,
   a cache — anything it produces that the map could read instead of the
   originals.
7. **How it is triggered.** Cron inside a container, a host timer, or a manual
   import. This decides how option A would be scheduled.
8. **How it is exposed.** LAN only, or behind a reverse proxy / tunnel. If it is
   already exposed to the internet, that changes the security conversation
   before anything else.
9. **One real export per kind** (RTS, landfill, I·PARK) into `samples/` at the
   repo root — outside `data/`, so nothing is ingested by accident. Needed for
   the Excel adapter regardless of how the NAS question resolves.

## Constraints to keep in mind

- **The stream model is RTS-shaped.** `P99 → private`, `C31`+`G01 → FEHD`,
  `P97 → GTW`, `F04 → maintenance`, and the card shows *Total received (MSW)* +
  *(GTW)* with a private/public/GTW chart. Landfill and I·PARK weighbridges
  measure disposal with different task codes and possibly no source district;
  dropped in as-is, every row would land in `other` and the card would be
  arithmetically right but meaningless. Those cards need a decision first.
- **Each ingest run is a full rebuild**, so the data root must stay complete and
  deduplicated (a re-sent month is reported, with both filenames).
- **Row-level records only.** A monthly summary/pivot sheet cannot feed the
  pipeline — the date-range picker and the per-day chart need individual
  weigh-in rows.
- **Size.** ~36 MB of aggregate, ~72 MB with the current `src/data` +
  `public/` duplicate. Fine for GitHub and Vercel, but the first load grows from
  3.5 KB to ~3.3 MB brotli, which is what makes lazy per-station loading
  necessary before the full import.

## Sequence once the folder structure is known

1. Decide A or B (C is rejected).
2. Lazy per-station loading in the app — the gate for the full import.
3. Import the six RTS only, 2023–2026; measure the real aggregate sizes.
4. Decide what a landfill / I·PARK card should show, then import those.
