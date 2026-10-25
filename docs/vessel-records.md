# Vessel AIS records

Every position report the project holds for the two waste-carrier vessels, as a
readable record. This is the *data* companion to `vessels.md`, which documents the
code.

- Generated: **25/10/2026 19:24:23 HKT** (2026-10-25T11:24:23.304Z)
- Sources merged: the committed snapshot `src/data/vessel-tracks/tracks.json` and
  the runtime store `data/vessels/tracks.json`
- Duplicates are removed on `(MMSI, timestamp)`; the two files overlap by design
- All times are given in both **HKT (UTC+8)** and **UTC**
- A machine-readable copy sits beside this file as `vessel-records.csv`

## Summary

| Vessel | MMSI | IMO | Reports | First (HKT) | Last (HKT) | Span | Track length | Max SOG |
| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: |
| NGON SHUEN II | 477997242 | 1046453 | 4 | 24/10/2026 19:38:53 | 24/10/2026 20:43:54 | 65 min | 4.27 km | 7.5 kn |
| LAI WAN II | 477997306 | 1046465 | 2 | 24/10/2026 20:28:03 | 24/10/2026 20:34:20 | 6 min | 0.16 km | 3.7 kn |

**Total: 6 reports across 2 vessels.**

This is a thin recording, and the reason matters: AISStream relays roughly one
report per vessel per minute *while the vessel is moving*, and a Class A
transponder at a berth drops to one report every **3 minutes**. Both ships sit
moored for most of the day, so a collection run that lasts minutes can legitimately
return nothing at all. The recording only thickens when collection is left running
for hours — see `vessels.md` §6.

## NGON SHUEN II — MMSI 477997242

IMO 1046453 · 4 reports · 65 min · 4.27 km · peak 7.5 kn

| # | Time (HKT) | Time (UTC) | Latitude | Longitude | SOG (kn) | COG (°) | Nav status | Seen in |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 24/10/2026 19:38:53 | 2026-10-24T11:38:53.480Z | 22.29845 | 114.13068 | 0.0 | 318.5 | 0 · Under way using engine | snapshot |
| 2 | 24/10/2026 20:26:04 | 2026-10-24T12:26:04.909Z | 22.32332 | 114.14900 | 7.5 | 319.3 | 0 · Under way using engine | snapshot |
| 3 | 24/10/2026 20:32:04 | 2026-10-24T12:32:04.933Z | 22.32703 | 114.14168 | 1.6 | 306.2 | 0 · Under way using engine | snapshot |
| 4 | 24/10/2026 20:43:54 | 2026-10-24T12:43:54.885Z | 22.32753 | 114.14135 | 0.0 | 195.1 | 0 · Under way using engine | snapshot |

### Legs between consecutive reports

| Leg | From (HKT) | To (HKT) | Gap | Distance | Implied speed | Course over ground |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 24/10/2026 19:38:53 | 24/10/2026 20:26:04 | 47.2 min | 3.347 km | 2.3 kn | 319.3 |
| 2 | 24/10/2026 20:26:04 | 24/10/2026 20:32:04 | 6.0 min | 0.858 km | 4.6 kn | 306.2 |
| 3 | 24/10/2026 20:32:04 | 24/10/2026 20:43:54 | 11.8 min | 0.065 km | 0.2 kn | 195.1 |

Read this table before trusting the drawn line. The route on the map is a
straight segment per row: AIS gives positions, not the water between them. Where
the gap is tens of minutes and the implied speed disagrees with the reported SOG,
the ship took a path the data does not describe.

## LAI WAN II — MMSI 477997306

IMO 1046465 · 2 reports · 6 min · 0.16 km · peak 3.7 kn

| # | Time (HKT) | Time (UTC) | Latitude | Longitude | SOG (kn) | COG (°) | Nav status | Seen in |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 24/10/2026 20:28:03 | 2026-10-24T12:28:03.323Z | 22.29853 | 114.13175 | 3.7 | 284.3 | 5 · Moored | snapshot |
| 2 | 24/10/2026 20:34:20 | 2026-10-24T12:34:20.787Z | 22.29746 | 114.13069 | 0.5 | 183.8 | 5 · Moored | snapshot |

### Legs between consecutive reports

| Leg | From (HKT) | To (HKT) | Gap | Distance | Implied speed | Course over ground |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 24/10/2026 20:28:03 | 24/10/2026 20:34:20 | 6.3 min | 0.161 km | 0.8 kn | 183.8 |

Read this table before trusting the drawn line. The route on the map is a
straight segment per row: AIS gives positions, not the water between them. Where
the gap is tens of minutes and the implied speed disagrees with the reported SOG,
the ship took a path the data does not describe.

## Field reference

| Field | Meaning |
| --- | --- |
| `t` | Epoch milliseconds, UTC. The single time value stored; every display converts it. |
| `lat` / `lng` | Decimal degrees, WGS-84, from the AIS position report. |
| `sog` | Speed over ground in knots. `0.0` is ambiguous on its own — see `nav`. |
| `cog` | Course over ground, degrees clockwise from north. **A stopped ship keeps broadcasting its last course**, so this is not a heading when `sog` is 0. |
| `nav` | AIS navigational status. `0` under way using engine, `5` moored, `1` at anchor. |

## Nav status codes

| Code | Label |
| ---: | --- |
| 0 | Under way using engine |
| 1 | At anchor |
| 2 | Not under control |
| 3 | Restricted manoeuvrability |
| 4 | Constrained by draught |
| 5 | Moored |
| 6 | Aground |
| 7 | Fishing |
| 8 | Under way sailing |
| 15 | Undefined |
