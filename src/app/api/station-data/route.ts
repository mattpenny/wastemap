import { NextResponse } from "next/server";

import {
  assembleStation,
  listFacilityIds,
  listStationIds,
  loadDataset,
  loadMeta,
  WeighbridgeDataError,
} from "@/lib/weighbridgeServer";

/**
 * GET /api/station-data
 * -------------------------------------------------------------------------
 * Measured station intake, aggregated from operator weighbridge exports.
 *
 * This is deliberately a separate route from `/api/waste-data`. That one
 * serves the EPD/CSDI facility register, which carries no per-facility
 * throughput; this one carries real measured tonnage for the stations that
 * report it. Keeping them apart stops the two sources being read as one.
 *
 * The data is stored in a split layout under `src/data/weighbridge/`
 * (index + per-station meta + per-year files). This route reads only the
 * files it needs to answer the request, so a date-range query never
 * transfers years that fall outside the window.
 *
 * Query parameters
 *   (none)                  Every station with weighbridge coverage
 *   ?station=WKTS           One station, by operator code
 *   ?facility=rts-west-kowloon   One station, by map facility id
 *   ?from=YYYY-MM-DD        Earliest day to include (inclusive)
 *   ?to=YYYY-MM-DD          Latest day to include (inclusive)
 *   ?pretty=1               Pretty-print the JSON
 *
 * Responses
 *   200 application/json   { meta, stations }
 *   404 application/json   Unknown station / facility, or no coverage for it
 *   500 application/json   Unexpected failure
 */

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** Weak ETag over the payload so repeat requests can be answered with 304. */
function etagFor(body: string): string {
  let hash = 5381;
  for (let i = 0; i < body.length; i++) {
    hash = ((hash << 5) + hash + body.charCodeAt(i)) | 0;
  }
  return `W/"${(hash >>> 0).toString(36)}-${body.length.toString(36)}"`;
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
) {
  return new NextResponse(JSON.stringify({ error: code, message, ...extra }, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": JSON_CONTENT_TYPE },
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pretty = searchParams.get("pretty") === "1";
    const stationParam = searchParams.get("station");
    const facilityParam = searchParams.get("facility");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    if (fromParam && !ISO_DATE.test(fromParam)) {
      return jsonError(400, "BAD_FROM", "`from` must be an ISO date YYYY-MM-DD.");
    }
    if (toParam && !ISO_DATE.test(toParam)) {
      return jsonError(400, "BAD_TO", "`to` must be an ISO date YYYY-MM-DD.");
    }

    const meta = await loadMeta();

    if (stationParam) {
      const station = await assembleStation(stationParam, {
        from: fromParam ?? undefined,
        to: toParam ?? undefined,
      });
      if (!station) {
        return jsonError(
          404,
          "STATION_NOT_FOUND",
          `No weighbridge coverage for station "${stationParam}".`,
          { stationsWithCoverage: await listStationIds() }
        );
      }
      return respond({ meta, stations: { [station.stationId]: station } }, pretty, request);
    }

    if (facilityParam) {
      const ids = await listStationIds();
      let found = null;
      for (const id of ids) {
        const candidate = await assembleStation(id, {
          from: fromParam ?? undefined,
          to: toParam ?? undefined,
        });
        if (candidate && candidate.facilityId === facilityParam) {
          found = candidate;
          break;
        }
      }
      if (!found) {
        return jsonError(
          404,
          "NO_WEIGHBRIDGE_COVERAGE",
          `No weighbridge coverage for facility "${facilityParam}".`,
          {
            stationsWithCoverage: await listStationIds(),
            facilitiesWithCoverage: await listFacilityIds(),
          }
        );
      }
      return respond({ meta, stations: { [found.stationId]: found } }, pretty, request);
    }

    // Default: every station. We still build each one through the loader so
    // the response is shape-compatible with the old monolithic file.
    const dataset = await loadDataset();
    return respond(dataset, pretty, request);
  } catch (error) {
    if (error instanceof WeighbridgeDataError && error.code === "MISSING_FILE") {
      console.error("[api/station-data] Data layout missing:", error.message);
      return jsonError(
        503,
        "WEIGHBRIDGE_NOT_INGESTED",
        "Weighbridge data has not been ingested yet. Run `npm run ingest`."
      );
    }
    console.error("[api/station-data] Unexpected failure:", error);
    return jsonError(500, "INTERNAL_SERVER_ERROR", "Failed to generate station data.");
  }
}

function respond(
  payload: { meta: Awaited<ReturnType<typeof loadMeta>>; stations: Record<string, unknown> },
  pretty: boolean,
  request: Request
) {
  const body = JSON.stringify(payload, null, pretty ? 2 : 0);
  const etag = etagFor(body);

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...CORS_HEADERS, ETag: etag } });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": JSON_CONTENT_TYPE,
      ETag: etag,
      // Each split file is content-addressed by its path; the index changes
      // only when an ingest adds/removes stations. Cache hard at the edge and
      // let SWR serve stale-but-cheap while the origin revalidates.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

/** CORS preflight. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
