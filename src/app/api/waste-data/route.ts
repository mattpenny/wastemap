import { NextResponse } from "next/server";
import {
  WASTE_FACILITIES_DATA,
  FACILITY_CATEGORIES,
  DATA_PROVENANCE,
  findFacilityById,
  type FacilityProperties,
  type FacilityCategory,
} from "@/data/waste-facilities";

/**
 * GET /api/waste-data
 * -------------------------------------------------------------------------
 * Data proxy returning the Hong Kong EPD waste facilities as a GeoJSON
 * FeatureCollection.
 *
 * Query parameters
 *   ?category=Landfill,RTS   Filter to one or more categories (comma separated)
 *   ?id=landfill-went        Return a single facility as a FeatureCollection
 *   ?lang=zh                 Hint for consumers; properties carry both languages
 *   ?pretty=1                Pretty-print the JSON (handy when debugging)
 *
 * Responses
 *   200 application/geo+json  FeatureCollection
 *   400 application/json      Invalid `category` value
 *   404 application/json      Unknown `id`
 *   500 application/json      Unexpected failure
 *
 * CORS is open (`*`) so the map can be embedded from any origin, and an ETag
 * is emitted so repeat requests can be answered with 304.
 */

export const dynamic = "force-dynamic";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const GEOJSON_CONTENT_TYPE = "application/geo+json; charset=utf-8";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

interface GeoJsonFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: FacilityProperties;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  /** Non-standard but widely tolerated; consumers may ignore it. */
  metadata: {
    version: string;
    updatedAt: string;
    coordinateSource: string;
    throughputSource: string;
    oitfSource: string;
    facilityPageSource: string;
    weighbridgeSource: string;
    datasetUpdatedAt: string;
    disclaimerEn: string;
    disclaimerZh: string;
    count: number;
    categories: FacilityCategory[];
  };
  features: GeoJsonFeature[];
}

function toFeature(facility: FacilityProperties): GeoJsonFeature {
  return {
    type: "Feature",
    id: facility.id,
    geometry: {
      type: "Point",
      // GeoJSON mandates [longitude, latitude] — same order as our source data.
      coordinates: facility.coordinates,
    },
    properties: facility,
  };
}

function toFeatureCollection(facilities: FacilityProperties[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    metadata: {
      ...DATA_PROVENANCE,
      count: facilities.length,
      categories: FACILITY_CATEGORIES,
    },
    features: facilities.map(toFeature),
  };
}

/** Weak ETag over the payload + status so caching stays correct. */
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
  return new NextResponse(
    JSON.stringify({ error: code, message, ...extra }, null, 2),
    {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": JSON_CONTENT_TYPE },
    }
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pretty = searchParams.get("pretty") === "1";
    const idParam = searchParams.get("id");
    const categoryParam = searchParams.get("category");

    // --- Single facility lookup ---------------------------------------
    if (idParam) {
      const facility = findFacilityById(idParam);
      if (!facility) {
        return jsonError(
          404,
          "FACILITY_NOT_FOUND",
          `No facility with id "${idParam}".`,
          { availableIds: WASTE_FACILITIES_DATA.map((f) => f.id) }
        );
      }
      const body = JSON.stringify(toFeatureCollection([facility]), null, pretty ? 2 : 0);
      return new NextResponse(body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": GEOJSON_CONTENT_TYPE,
          ETag: etagFor(body),
        },
      });
    }

    // --- Category filter ----------------------------------------------
    let facilities: FacilityProperties[] = WASTE_FACILITIES_DATA;

    if (categoryParam) {
      const requested = categoryParam
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

      const normalised = requested.map((c) => c.toUpperCase());
      const known = FACILITY_CATEGORIES.map((c) => c.toUpperCase());

      const unknown = requested.filter(
        (_, i) => !known.includes(normalised[i])
      );
      if (unknown.length > 0) {
        return jsonError(
          400,
          "INVALID_CATEGORY",
          `Unknown category value(s): ${unknown.join(", ")}.`,
          { validCategories: FACILITY_CATEGORIES }
        );
      }

      facilities = WASTE_FACILITIES_DATA.filter((f) =>
        normalised.includes(f.category.toUpperCase())
      );
    }

    // --- Build payload -------------------------------------------------
    const collection = toFeatureCollection(facilities);
    const body = JSON.stringify(collection, null, pretty ? 2 : 0);
    const etag = etagFor(body);

    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ...CORS_HEADERS, ETag: etag },
      });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": GEOJSON_CONTENT_TYPE,
        ETag: etag,
        // Baseline data changes rarely; allow generous shared caching while
        // keeping stale-while-revalidate so the map never blocks on a refresh.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[api/waste-data] Unexpected failure:", error);
    return jsonError(
      500,
      "INTERNAL_SERVER_ERROR",
      "Failed to generate waste facilities data."
    );
  }
}

/** CORS preflight. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
