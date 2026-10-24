/**
 * AIS vessel-track collector
 * =========================================================================
 *
 * Streams live AIS positions from AISStream.io and records the tracks of
 * the project's own vessels into `src/data/vessel-tracks/tracks.json`,
 * which the map animates.
 *
 * WHY A LOCAL COLLECTOR RATHER THAN THE SERVER
 * --------------------------------------------
 * AISStream forbids direct browser connections (the key would leak), and
 * Vercel serverless functions cannot hold a long-lived WebSocket. Vercel's
 * Hobby cron also runs only once a day, which would never catch a 1-hour
 * barge trip. So collection runs here, locally, while the vessel is sailing.
 * The JSON it writes is committed, which is how the deployed site gets it.
 *
 * USAGE
 *   npm run ais:collect              # collect until Ctrl-C
 *   npm run ais:collect -- --minutes 90
 *   npm run ais:collect -- --status  # just print what is on file
 *
 * Requires AISSTREAM_API_KEY in `.env` (gitignored; never committed).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src/data/vessel-tracks/tracks.json");

/** The vessels we track. MMSI is the AIS identity; IMO/name are for labels. */
const VESSELS = [
  { mmsi: "477997242", imo: "1046453", name: "NGON SHUEN II", short: "NGON SHUEN II" },
  { mmsi: "477997306", imo: "1046465", name: "LAI WAN II", short: "LAI WAN II" },
];

/** Hong Kong waters. AISStream takes [[south, west], [north, east]]. */
const BBOX = [[[22.10, 113.85], [22.40, 114.35]]];

/**
 * Ignore a position report if it is within this many metres of the last.
 *
 * 5 m is deliberately tight. AISStream relays roughly one report per vessel
 * per minute, so a short run only ever sees a handful of points; at 15 m a
 * slow or moored vessel produced a track so short it could only be drawn as a
 * straight segment. 5 m keeps genuine manoeuvring — a berth shift, a slow
 * swing — while still rejecting GPS jitter while moored (typically 1–3 m).
 */
const MIN_MOVE_M = 5;
/** Ignore reports older than this (a stale replay is not a real sighting). */
const MAX_AGE_MS = 10 * 60 * 1000;

function readKey() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    console.error("No .env file. Create one with:  AISSTREAM_API_KEY=<your key>");
    process.exit(1);
  }
  const m = fs.readFileSync(envPath, "utf8").match(/^\s*AISSTREAM_API_KEY\s*=\s*(.+)\s*$/m);
  if (!m) {
    console.error(".env has no AISSTREAM_API_KEY= line. Expected format: AISSTREAM_API_KEY=xxxx");
    process.exit(1);
  }
  return m[1].trim();
}

function loadTracks() {
  if (!fs.existsSync(OUT)) return { version: 1, generatedAt: null, vessels: [] };
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    console.error("tracks.json is corrupt; back it up and delete it to start fresh.");
    process.exit(1);
  }
}

function saveTracks(data) {
  data.generatedAt = new Date().toISOString();
  const tmp = OUT + ".tmp";
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, OUT); // atomic: never leaves a half-written file
}

function distM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function parseTime(s) {
  const t = Date.parse(s.replace(" +0000 UTC", "Z").replace(" ", "T"));
  return Number.isFinite(t) ? t : Date.now();
}

function ensureVessel(data, v) {
  let rec = data.vessels.find((x) => x.mmsi === v.mmsi);
  if (!rec) {
    rec = { mmsi: v.mmsi, imo: v.imo, name: v.name, points: [] };
    data.vessels.push(rec);
  }
  return rec;
}

async function collect({ minutes }) {
  const API_KEY = readKey();
  const data = loadTracks();
  const targets = new Map(VESSELS.map((v) => [v.mmsi, v]));
  let added = 0;
  let dropped = 0;

  const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
  socket.binaryType = "arraybuffer";

  const stop = () => {
    try { socket.close(); } catch {}
    saveTracks(data);
    const summary = data.vessels
      .map((v) => `  ${v.name} (${v.mmsi}): ${v.points.length} points`)
      .join("\n");
    console.log(`\nStopped. ${added} points added, ${dropped} ignored.`);
    console.log(`Track file: ${path.relative(ROOT, OUT)}`);
    if (summary) console.log(summary);
    process.exit(0);
  };

  socket.addEventListener("open", () => {
    console.log("AISStream connected. Listening for:", VESSELS.map((v) => `${v.name} (${v.mmsi})`).join(", "));
    console.log("Ctrl-C to stop and save.\n");
    socket.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: BBOX,
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    }));
  });

  socket.addEventListener("message", async (ev) => {
    let raw;
    if (typeof ev.data === "string") raw = ev.data;
    else if (ev.data instanceof ArrayBuffer) raw = Buffer.from(ev.data).toString("utf8");
    else raw = await ev.data.text();

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const meta = msg.MetaData;
    if (!meta) return;
    const mmsi = String(meta.MMSI);
    const target = targets.get(mmsi);
    if (!target) return;

    const rec = ensureVessel(data, target);

    if (msg.MessageType === "ShipStaticData") {
      const s = msg.Message?.ShipStaticData;
      if (s) {
        if (s.ImoNumber) rec.imo = String(s.ImoNumber);
        if (s.Destination) rec.destination = String(s.Destination).trim();
        if (s.Draught) rec.draught = s.Draught;
        if (meta.ShipName) rec.name = String(meta.ShipName).trim();
      }
      return;
    }

    if (msg.MessageType !== "PositionReport") return;
    const p = msg.Message?.PositionReport;
    if (!p) return;

    const t = parseTime(meta.time_utc || "");
    if (Date.now() - t > MAX_AGE_MS) { dropped++; return; }

    const lat = p.Latitude ?? meta.latitude;
    const lng = p.Longitude ?? meta.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return;

    const point = { t, lat, lng, sog: p.Sog ?? null, cog: p.Cog ?? null, nav: p.NavigationalStatus ?? null };
    const last = rec.points[rec.points.length - 1];
    if (last) {
      if (point.t <= last.t) { dropped++; return; }
      if (distM(last, point) < MIN_MOVE_M) { dropped++; return; }
    }
    rec.points.push(point);
    added++;

    const ago = Math.round((Date.now() - t) / 1000);
    console.log(
      `+ ${rec.name.padEnd(14)} ${lat.toFixed(5)}, ${lng.toFixed(5)}  ` +
      `${(point.sog ?? 0).toFixed(1)} kn  (${ago}s ago)  [${rec.points.length} pts]`
    );
  });

  socket.addEventListener("error", (e) => console.error("socket error:", e.message || e));
  socket.addEventListener("close", (e) => {
    if (e.code !== 1000 && e.code !== 1005) console.error(`socket closed unexpectedly (code ${e.code})`);
    stop();
  });

  process.on("SIGINT", stop);
  if (minutes) setTimeout(stop, minutes * 60 * 1000);
}

function status() {
  const data = loadTracks();
  if (!data.vessels.length) { console.log("No tracks recorded yet."); return; }
  console.log(`Track file: ${path.relative(ROOT, OUT)}`);
  console.log(`Generated:  ${data.generatedAt || "(never)"}\n`);
  for (const v of data.vessels) {
    if (!v.points.length) { console.log(`${v.name} (${v.mmsi}): no points`); continue; }
    const first = new Date(v.points[0].t);
    const last = new Date(v.points[v.points.length - 1].t);
    const mins = Math.round((last - first) / 60000);
    const span = v.points.reduce((acc, p, i) => (i ? acc + distM(v.points[i - 1], p) : 0), 0) / 1000;
    console.log(`${v.name} (${v.mmsi})${v.imo ? ` IMO ${v.imo}` : ""}`);
    console.log(`  ${v.points.length} points, ${span.toFixed(1)} km, ${mins} min`);
    console.log(`  ${first.toISOString()} -> ${last.toISOString()}`);
    if (v.destination) console.log(`  destination: ${v.destination}`);
  }
}

const args = process.argv.slice(2);
if (args.includes("--status")) status();
else {
  const mi = args.indexOf("--minutes");
  collect({ minutes: mi >= 0 ? Number(args[mi + 1]) : null });
}
