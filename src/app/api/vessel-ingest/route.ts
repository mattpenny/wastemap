import { NextResponse } from "next/server";

import {
  DEFAULT_RETAIN_HOURS,
  emptyStore,
  mergeReports,
  prune,
  readStore,
  storeReportCount,
  writeStore,
  type IngestReport,
} from "@/lib/vesselStore";

/**
 * POST /api/vessel-ingest
 * -------------------------------------------------------------------------
 * The write half of the app's own vessel store: anything that can reach this
 * route can add AIS position reports, and they persist.
 *
 *     curl -X POST http://localhost:3942/api/vessel-ingest \
 *       -H 'Content-Type: application/json' \
 *       -d '{"points":[{"mmsi":"477997242","t":1792845834885,
 *                       "lat":22.3275,"lng":114.1413,"sog":0,"cog":195,"nav":5}]}'
 *
 * `npm run ais:collect -- --post http://localhost:3942` uses this route
 * instead of writing files, which is the difference between "the collector
 * wrote a JSON file" and "the app stored the data".
 *
 * Body
 *   { points: [{ mmsi, t, lat, lng, sog?, cog?, nav? }],   // required
 *     vessels?: [{ mmsi, name?, imo? }] }                  // optional labels
 *
 * Responses
 *   200 { ok: true, accepted, duplicate, rejected, reasons, totals }
 *   400 BAD_BODY / TOO_MANY / NO_POINTS
 *   413 — not used; the batch cap is enforced as 400 TOO_MANY
 *   503 READ_ONLY_STORE — the filesystem is not writable (a static host)
 *   500 INTERNAL_SERVER_ERROR
 *
 * The read-only case is not a bug to hide. Vercel runs the app on a read-only
 * filesystem, so storage works when the app runs on a machine (locally, the
 * NAS) and not on a static host; the response says exactly that, and the map
 * keeps serving the bundled snapshot.
 */

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** One request may not hand over more than this. */
const MAX_POINTS = 5000;

function json(status: number, payload: unknown) {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": JSON_CONTENT_TYPE },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, {
      error: "BAD_BODY",
      message: "Body must be JSON: { points: [{ mmsi, t, lat, lng, ... }] }",
    });
  }

  const payload = body as { points?: unknown; vessels?: unknown };
  if (!payload || !Array.isArray(payload.points)) {
    return json(400, {
      error: "NO_POINTS",
      message: "`points` must be an array of position reports.",
    });
  }
  if (payload.points.length === 0) {
    return json(400, { error: "NO_POINTS", message: "`points` is empty." });
  }
  if (payload.points.length > MAX_POINTS) {
    return json(400, {
      error: "TOO_MANY",
      message: `At most ${MAX_POINTS} points per request; got ${payload.points.length}.`,
    });
  }

  // Shape-check loosely here and let `mergeReports` do the field validation —
  // it owns the rules (bounds, age, MMSI format) and reporting them twice in
  // two places is how the two drift apart.
  const reports: IngestReport[] = payload.points.map((raw) => {
    const p = raw as Record<string, unknown>;
    return {
      mmsi: String(p.mmsi ?? ""),
      t: Number(p.t),
      lat: Number(p.lat),
      lng: Number(p.lng),
      sog: p.sog == null ? null : Number(p.sog),
      cog: p.cog == null ? null : Number(p.cog),
      nav: p.nav == null ? null : Number(p.nav),
    };
  });

  const vessels = Array.isArray(payload.vessels)
    ? (payload.vessels as Record<string, unknown>[])
        .map((v) => ({
          mmsi: String(v.mmsi ?? ""),
          name: v.name == null ? undefined : String(v.name),
          imo: v.imo == null ? null : String(v.imo),
        }))
        .filter((v) => /^\d{9}$/.test(v.mmsi))
    : [];

  try {
    const store = readStore() ?? emptyStore(DEFAULT_RETAIN_HOURS);
    const outcome = mergeReports(store, reports, vessels);
    const dropped = prune(store, store.retainHours || DEFAULT_RETAIN_HOURS);
    writeStore(store);

    return json(200, {
      ok: true,
      accepted: outcome.accepted,
      duplicate: outcome.duplicate,
      rejected: outcome.rejected,
      reasons: outcome.reasons,
      pruned: dropped,
      totals: {
        reports: storeReportCount(store),
        vessels: store.vessels.map((v) => ({ mmsi: v.mmsi, points: v.points.length })),
        generatedAt: store.generatedAt,
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const message = (error as Error)?.message ?? "";
    // A static host refuses writes in several different ways depending on the
    // runtime and the mount: EROFS on a read-only bind mount, EACCES/EPERM on a
    // permission-denied one, and some hosts report a plain "read-only file
    // system" with no errno at all. Match the class, not one spelling of it.
    const readOnly =
      code === "EROFS" ||
      code === "EACCES" ||
      code === "EPERM" ||
      /read-only|readonly|EROFS/i.test(message);

    if (readOnly) {
      // Say so plainly rather than returning a 500 the caller has to decode —
      // and never pretend the write happened.
      return json(503, {
        error: "READ_ONLY_STORE",
        message:
          "This deployment's filesystem is read-only, so reports cannot be stored here. " +
          "Run the app on a writable machine (locally, or the NAS) to store vessel data; " +
          "a static host keeps serving the snapshot bundled at build time.",
      });
    }
    console.error("[api/vessel-ingest] Failed to store reports:", error);
    return json(500, {
      error: "INTERNAL_SERVER_ERROR",
      message: "Could not write the vessel store.",
      // The errno is the whole diagnosis for a storage failure, and it is not
      // sensitive — a 500 with no reason forces a redeploy just to find out.
      reason: code ?? message.slice(0, 120),
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
