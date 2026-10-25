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

export interface RawPoint {
  t: number;
  lat: number;
  lng: number;
  sog: number | null;
  cog: number | null;
  nav: number | null;
}

export interface RawVessel {
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
 * Turn a raw vessel array into drawable tracks, oldest point first.
 *
 * Exported because two sources feed it and they must be parsed identically:
 * the JSON bundled at build time, and the app's own store served by
 * `GET /api/vessel-tracks`. Anything that only one of them went through would
 * be a difference between "what you see locally" and "what you see deployed".
 *
 * Points are re-sorted by timestamp because AIS delivery order is not
 * guaranteed, and the interpolation helpers assume a monotonic series. A track
 * with fewer than two points is dropped: one point cannot define a route.
 */
export function parseTracks(vessels: RawVessel[] | null | undefined): VesselTrack[] {
  return (vessels ?? [])
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
}

/**
 * The recording bundled into the build.
 *
 * This is the floor, not the ceiling: the map asks `GET /api/vessel-tracks`
 * for anything newer stored in the app, and falls back to this when the store
 * is empty or unreachable — which is the normal state on a static host.
 */
export const VESSEL_TRACKS: VesselTrack[] = parseTracks(file.vessels);

/** Total AIS reports across a set of tracks. */
export function reportCount(tracks: VesselTrack[]): number {
  return tracks.reduce((sum, t) => sum + t.points.length, 0);
}

/** When the track file was last written, or null if it never has been. */
export const VESSEL_TRACKS_GENERATED_AT: string | null = file.generatedAt ?? null;

/**
 * One colour per tracked vessel.
 *
 * Lives here rather than in the map component because two places need it: the
 * map draws the marker and route with it, and the vessel switch beside the
 * font control lists the same vessels. They must not drift — a picker swatch
 * that does not match the route it selects is worse than no swatch.
 *
 * The hues deliberately avoid the facility category colours (red / green /
 * emerald / amber / violet) so a ship can never be mistaken for a site.
 */
export const VESSEL_COLORS: Record<
  string,
  { hex: string; rgb: [number, number, number] }
> = {
  "477997242": { hex: "#38bdf8", rgb: [56, 189, 248] }, // NGON SHUEN II
  "477997306": { hex: "#f472b6", rgb: [244, 114, 182] }, // LAI WAN II
};

const VESSEL_COLOR_FALLBACK = { hex: "#e2e8f0", rgb: [226, 232, 240] };

export function vesselColor(mmsi: string) {
  return VESSEL_COLORS[mmsi] ?? VESSEL_COLOR_FALLBACK;
}

/** Total recorded duration of a track, in milliseconds. */
export function trackDurationMs(track: VesselTrack): number {
  const { points } = track;
  return points[points.length - 1].t - points[0].t;
}

/** First and last recorded report of a track, in epoch milliseconds. */
export function trackSpan(track: VesselTrack): { from: number; to: number } {
  const { points } = track;
  return { from: points[0].t, to: points[points.length - 1].t };
}

/**
 * A position at an arbitrary moment, together with the two recorded reports it
 * was interpolated between.
 *
 * The bracket matters: a vessel reports every few minutes at best, so most
 * moments on the timeline fall between two reports. Anything presenting a
 * position at a chosen time has to be able to say which two measurements it
 * came from rather than implying the ship was observed there.
 */
export interface VesselSample {
  position: [number, number];
  course: number | null;
  sog: number | null;
  /** AIS navigational status (0 under way, 1 at anchor, 5 moored, …). */
  nav: number | null;
  /** Timestamp of the recorded report at or before the sample. */
  fromT: number;
  /** Timestamp of the recorded report at or after it (equals `fromT` when exact). */
  toT: number;
}

/**
 * Sample a track at an arbitrary moment. Returns null outside the recorded
 * span — the timeline never extrapolates past what the ship actually reported.
 */
export function sampleAt(track: VesselTrack, timeMs: number): VesselSample | null {
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
    // The status of the report at or before the sample: it describes the leg
    // the vessel is on, not the one it is about to start.
    nav: a.nav ?? b.nav ?? null,
    fromT: a.t,
    toT: b.t,
  };
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
  const s = sampleAt(track, timeMs);
  return s ? { position: s.position, course: s.course, sog: s.sog } : null;
}

/**
 * Marks every `stepMs` across a time window — the regular dots along the route.
 *
 * Marks are aligned to the step boundary rather than to the track start, so a
 * 10-minute step lands on :00, :10, :20 … and the times read as a clock rather
 * than as "eleven minutes after the ship left". The window is intersected with
 * the recorded span first: there is no honest mark outside the data.
 *
 * Every mark carries the reports it sits between (`fromT` / `toT`), so a hover
 * can say "between 14:12 and 14:41" instead of presenting an interpolation as
 * an observation.
 */
export function sampleTrack(
  track: VesselTrack,
  fromMs: number,
  toMs: number,
  stepMs: number,
): VesselTimeMark[] {
  const { points } = track;
  if (points.length < 2 || stepMs <= 0) return [];

  const lo = Math.max(fromMs, points[0].t);
  const hi = Math.min(toMs, points[points.length - 1].t);
  if (hi < lo) return [];

  const marks: VesselTimeMark[] = [];
  // First boundary at or after the window opens.
  for (let t = Math.ceil(lo / stepMs) * stepMs; t <= hi; t += stepMs) {
    const s = sampleAt(track, t);
    if (!s) continue;
    marks.push({
      t,
      position: s.position,
      course: s.course,
      sog: s.sog,
      nav: s.nav,
      fromT: s.fromT,
      toT: s.toT,
    });
  }
  return marks;
}

/** One sampled position along a route, at a fixed time interval. */
export interface VesselTimeMark {
  /** Epoch milliseconds of the mark. */
  t: number;
  position: [number, number];
  course: number | null;
  sog: number | null;
  /** AIS navigational status at the mark. */
  nav: number | null;
  fromT: number;
  toT: number;
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
