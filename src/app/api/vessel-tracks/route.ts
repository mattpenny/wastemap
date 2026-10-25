import { NextResponse } from "next/server";

import {
  DEFAULT_RETAIN_HOURS,
  readStore,
  storeReportCount,
} from "@/lib/vesselStore";

/**
 * GET /api/vessel-tracks
 * -------------------------------------------------------------------------
 * The vessel positions the app has stored, read back out of it.
 *
 * This is the read half of the app's own vessel store (see
 * `@/lib/vesselStore`). The map calls it on mount: when the store has data the
 * map uses it, and when it does not — a static deployment, a fresh clone — the
 * response says `source: "none"` and the client keeps the recording bundled
 * into the build. That fallback is why the API returning nothing is a normal
 * answer rather than an error.
 *
 * Responses
 *   200 { source: "store", generatedAt, retainHours, reportCount, vessels }
 *   200 { source: "none", generatedAt: null, retainHours, reportCount: 0, vessels: [] }
 *
 * Never cached: the whole point is that a new report shows up without a
 * rebuild.
 */

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export async function GET() {
  const store = readStore();
  const usable = store?.vessels.filter((v) => v.points.length >= 2) ?? [];

  if (!store || usable.length === 0) {
    return new NextResponse(
      JSON.stringify({
        source: "none",
        generatedAt: null,
        retainHours: DEFAULT_RETAIN_HOURS,
        reportCount: 0,
        vessels: [],
      }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": JSON_CONTENT_TYPE,
          "Cache-Control": "no-store",
        },
      }
    );
  }

  return new NextResponse(
    JSON.stringify({
      source: "store",
      generatedAt: store.generatedAt,
      retainHours: store.retainHours,
      reportCount: storeReportCount(store),
      vessels: usable.map((v) => ({
        mmsi: v.mmsi,
        imo: v.imo ?? null,
        name: v.name,
        destination: v.destination,
        draught: v.draught,
        points: v.points,
      })),
    }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": JSON_CONTENT_TYPE,
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
