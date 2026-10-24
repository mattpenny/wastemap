/**
 * Recorded AIS vessel tracks
 * =========================================================================
 *
 * Loads the tracks written by `scripts/collect-ais.mjs` (see `npm run
 * ais:collect`) and turns them into the geometry the map animates.
 *
 * WHERE THIS DATA COMES FROM
 * --------------------------
 * Every point is a real AIS position report broadcast by the vessel itself
 * and received through AISStream.io. Nothing here is interpolated, smoothed
 * or invented — the file is a verbatim record of what the ship transmitted.
 * The only derived values are the interpolation helpers below, which place
 * the vessel *between* two recorded reports for a smooth animation.
 *
 * The file is committed (like the weighbridge aggregates) because that is how
 * the deployed site receives it: collection runs locally, on a machine that
 * can hold the long-lived WebSocket AISStream requires.
 *
 * A track with fewer than two points cannot define a route and is ignored, so
 * a vessel that has not yet sailed simply does not appear on the map.
 */

import raw from "@/data/vessel-tracks/tracks.json";

/** One recorded AIS position report. */
export interface VesselTrackPoint {
  /** Epoch milliseconds, from the AIS message's own UTC timestamp. */
  t: number;
  lat: number;
  lng: number;
  /** Speed over ground, knots. */
  sog: number | null;
  /** Course over ground, degrees clockwise from true north. */
  cog: number | null;
  /** AIS navigational status code (0 = under way using engine, 1 = at anchor, 5 = moored). */
  nav: number | null;
}

/** A vessel's recorded track, with the static data its AIS unit broadcast. */
export interface VesselTrack {
  mmsi: string;
  imo: string | null;
  name: string;
  /** Destination as broadcast by the vessel, if it sent one. */
  destination?: string;
  draught?: number;
  points: VesselTrackPoint[];
}

interface RawPoint {
  t: number;
  lat: number;
  lng: number;
  sog: number | null;
  cog: number | null;
  nav: number | null;
}

interface RawVessel {
  mmsi: string | number;
  imo?: string | number | null;
  name: string;
  destination?: string;
  draught?: number;
  points: RawPoint[];
}

interface RawFile {
  version: number;
  generatedAt: string | null;
  vessels: RawVessel[];
}

const file = raw as unknown as RawFile;

/**
 * Tracks that can actually be drawn, oldest point first.
 *
 * Points are re-sorted by timestamp because AIS delivery order is not
 * guaranteed, and the interpolation helpers assume a monotonic series.
 */
export const VESSEL_TRACKS: VesselTrack[] = (file.vessels ?? [])
  .map((v) => ({
    mmsi: String(v.mmsi),
    imo: v.imo == null ? null : String(v.imo),
    name: String(v.name ?? "").trim(),
    destination: v.destination,
    draught: v.draught,
    points: [...(v.points ?? [])]
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .sort((a, b) => a.t - b.t),
  }))
  .filter((v) => v.points.length >= 2);

/** When the track file was last written, or null if it never has been. */
export const VESSEL_TRACKS_GENERATED_AT: string | null = file.generatedAt ?? null;

/**
 * One colour per tracked vessel.
 *
 * Shared by the map and the legend/picker on purpose: the swatch in the picker
 * has to be the colour of the marker it turns on, and two copies of this table
 * would eventually disagree. The hues sit outside the facility category palette
 * (red / green / emerald / amber / violet) so a boat is never mistaken for a
 * landfill.
 */
export const VESSEL_COLORS: Record<string, { hex: string; rgb: [number, number, number] }> = {
  "477997242": { hex: "#38bdf8", rgb: [56, 189, 248] }, // NGON SHUEN II
  "477997306": { hex: "#f472b6", rgb: [244, 114, 182] }, // LAI WAN II
};
const VESSEL_COLOR_FALLBACK = { hex: "#e2e8f0", rgb: [226, 232, 240] };

/** Colour for a vessel, falling back to a neutral one for an unknown MMSI. */
export function vesselColor(mmsi: string) {
  return VESSEL_COLORS[mmsi] ?? VESSEL_COLOR_FALLBACK;
}

/**
 * How much history the project keeps. The collector prunes older points on
 * every save, so this is the contract for the whole app: the time search can
 * never offer a window wider than this, and nothing here assumes more.
 */
export const VESSEL_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The full recorded span across every track, or null when nothing is recorded.
 * Used to bound the time search — offering a window the data cannot cover would
 * just produce an empty map with no explanation.
 */
export const VESSEL_DATA_SPAN: { from: number; to: number } | null = (() => {
  let from = Infinity;
  let to = -Infinity;
  for (const track of VESSEL_TRACKS) {
    from = Math.min(from, track.points[0].t);
    to = Math.max(to, track.points[track.points.length - 1].t);
  }
  return Number.isFinite(from) && to > from ? { from, to } : null;
})();

/** Total recorded duration of a track, in milliseconds. */
export function trackDurationMs(track: VesselTrack): number {
  const { points } = track;
  return points[points.length - 1].t - points[0].t;
}

/**
 * Position and course at an arbitrary moment, interpolated between the two
 * recorded reports that bracket it. Returns null outside the recorded span —
 * the animation never extrapolates past what the ship actually reported.
 */
export function positionAtTime(
  track: VesselTrack,
  timeMs: number,
): { position: [number, number]; course: number | null; sog: number | null } | null {
  const { points } = track;
  if (points.length < 2) return null;
  if (timeMs < points[0].t || timeMs > points[points.length - 1].t) return null;

  // Binary search for the first point at or after timeMs.
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= timeMs) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  const span = b.t - a.t;
  // Guard the degenerate case of two reports sharing a timestamp.
  const f = span > 0 ? (timeMs - a.t) / span : 0;

  return {
    position: [a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f],
    course: a.cog ?? b.cog ?? null,
    sog: a.sog ?? b.sog ?? null,
  };
}

/**
 * One evenly spaced sample along a track, used for the 10-minute dots.
 *
 * `position` is interpolated, exactly like the playback clock — a sample is
 * "where the vessel was at 10:40", not a new measurement. The `t` it carries is
 * what the tooltip reports, so the dot never claims to be an AIS report.
 */
export interface VesselSample {
  t: number;
  position: [number, number];
  sog: number | null;
  course: number | null;
}

/**
 * The part of a track inside [fromMs, toMs], with interpolated endpoints.
 *
 * The ends are interpolated rather than snapped to the nearest report so the
 * route covers exactly the window the user asked for. Interior points are the
 * real AIS reports, untouched. Returns null when the window holds fewer than
 * two drawable positions — a single point cannot define a route.
 */
export function clipTrack(
  track: VesselTrack,
  fromMs: number,
  toMs: number,
): VesselTrack | null {
  const { points } = track;
  if (points.length < 2 || toMs <= fromMs) return null;

  const out: VesselTrackPoint[] = [];

  const atStart = positionAtTime(track, fromMs);
  if (atStart) {
    out.push({
      t: fromMs,
      lat: atStart.position[1],
      lng: atStart.position[0],
      sog: atStart.sog,
      cog: atStart.course,
      nav: null,
    });
  }
  // Strictly inside, so neither edge can be duplicated by the interpolated ends.
  for (const p of points) {
    if (p.t > fromMs && p.t < toMs) out.push(p);
  }
  const atEnd = positionAtTime(track, toMs);
  if (atEnd) {
    out.push({
      t: toMs,
      lat: atEnd.position[1],
      lng: atEnd.position[0],
      sog: atEnd.sog,
      cog: atEnd.course,
      nav: null,
    });
  }

  return out.length >= 2 ? { ...track, points: out } : null;
}

/**
 * A position every `stepMs` across the window, aligned to the wall clock.
 *
 * Aligned on purpose: a 10-minute grid that starts at 10:04 is unreadable, and
 * the tooltip is meant to answer "where was it at half past". Samples outside
 * the recorded span are skipped rather than extrapolated, so a window wider
 * than the data simply has fewer dots at the edges.
 */
export function sampleTrack(
  track: VesselTrack,
  fromMs: number,
  toMs: number,
  stepMs: number,
): VesselSample[] {
  if (stepMs <= 0 || toMs <= fromMs) return [];
  const samples: VesselSample[] = [];
  const first = Math.ceil(fromMs / stepMs) * stepMs;
  for (let t = first; t <= toMs; t += stepMs) {
    const at = positionAtTime(track, t);
    if (!at) continue;
    samples.push({ t, position: at.position, sog: at.sog, course: at.course });
  }
  return samples;
}

/** Straight-line length of a recorded track, in kilometres. */
export function trackLengthKm(track: VesselTrack): number {
  const { points } = track;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1], points[i]);
  }
  return total / 1000;
}

/**
 * The portion of a track sailed in the `trailMs` before `nowMs`, as a
 * drawable polyline — the wake behind the animated vessel.
 *
 * Returns null when fewer than two positions fall in the window, because a
 * single point cannot define a line. The window is opened and closed on the
 * interpolated position, so the wake ends exactly under the vessel marker
 * even when the reports either side of the edge are minutes apart.
 */
export function trailBefore(
  track: VesselTrack,
  nowMs: number,
  trailMs: number,
): [number, number][] | null {
  const { points } = track;
  if (points.length < 2) return null;

  const from = nowMs - trailMs;
  const inside = points
    .filter((p) => p.t >= from && p.t <= nowMs)
    .map((p) => [p.lng, p.lat] as [number, number]);

  const atStart = positionAtTime(track, from);
  if (atStart) inside.unshift(atStart.position);

  const atEnd = positionAtTime(track, nowMs);
  if (atEnd) inside.push(atEnd.position);

  return inside.length >= 2 ? inside : null;
}

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
