import { NextResponse } from "next/server";
import {
  WEIGHBRIDGE_DATA,
  WEIGHBRIDGE_STATION_IDS,
  findStationRecords,
  findStationRecordsByFacilityId,
} from "@/lib/weighbridge";

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
 * Query parameters
 *   (none)                  Every station with weighbridge coverage
 *   ?station=WKTS           One station, by operator code
 *   ?facility=rts-west-kowloon   One station, by map facility id
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

function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return new NextResponse(JSON.stringify({ error: code, message, ...extra }, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": JSON_CONTENT_TYPE },
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pretty = searchParams.get("pretty") === "1";
    const stationParam = searchParams.get("station");
    const facilityParam = searchParams.get("facility");

    let stations = WEIGHBRIDGE_DATA.stations;

    if (stationParam) {
      const found = findStationRecords(stationParam);
      if (!found) {
        return jsonError(
          404,
          "STATION_NOT_FOUND",
          `No weighbridge coverage for station "${stationParam}".`,
          { stationsWithCoverage: WEIGHBRIDGE_STATION_IDS }
        );
      }
      stations = { [found.stationId]: found };
    } else if (facilityParam) {
      const found = findStationRecordsByFacilityId(facilityParam);
      if (!found) {
        return jsonError(
          404,
          "NO_WEIGHBRIDGE_COVERAGE",
          `No weighbridge coverage for facility "${facilityParam}".`,
          {
            stationsWithCoverage: WEIGHBRIDGE_STATION_IDS,
            facilitiesWithCoverage: Object.values(WEIGHBRIDGE_DATA.stations).map(
              (s) => s.facilityId
            ),
          }
        );
      }
      stations = { [found.stationId]: found };
    }

    const body = JSON.stringify(
      { meta: WEIGHBRIDGE_DATA.meta, stations },
      null,
      pretty ? 2 : 0
    );
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
        // Regenerated only when a new export is ingested, so cache hard.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[api/station-data] Unexpected failure:", error);
    return jsonError(500, "INTERNAL_SERVER_ERROR", "Failed to generate station data.");
  }
}

/** CORS preflight. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
