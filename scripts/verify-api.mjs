/**
 * Bounded verification of the /api/waste-data payload after the official-data
 * migration. Polls until the dev server answers, then asserts the data-honesty
 * invariants, prints a summary, and always exits non-zero on any failure.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

async function waitForServer(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/waste-data`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Server did not answer /api/waste-data within timeout");
}

const checks = [];
function check(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail });
}

(async () => {
  await waitForServer();

  const res = await fetch(`${BASE}/api/waste-data?pretty=1`);
  check("HTTP 200", res.status === 200, `status=${res.status}`);
  const json = await res.json();

  // --- structure ---
  check("FeatureCollection", json.type === "FeatureCollection");
  check("19 features", Array.isArray(json.features) && json.features.length === 19,
    `got ${json.features?.length}`);
  check("metadata present", json.metadata && typeof json.metadata === "object");

  // --- provenance metadata ---
  const md = json.metadata;
  check("metadata.version = 2026.10-official", md.version === "2026.10-official", md.version);
  check("metadata.throughputSource present", typeof md.throughputSource === "string" && md.throughputSource.length > 10);
  check("metadata.datasetUpdatedAt present", typeof md.datasetUpdatedAt === "string" && /\d{4}-\d{2}-\d{2}/.test(md.datasetUpdatedAt), md.datasetUpdatedAt);

  // --- no modelled fields anywhere in the payload ---
  const raw = JSON.stringify(json);
  check("no currentIntakeTonnesPerDay in payload", !raw.includes("currentIntakeTonnesPerDay"));
  check("no utilizationRatePercentage in payload", !raw.includes("utilizationRatePercentage"));
  check("no utilisationRate in payload", !raw.includes("utilisationRate"));
  check("no historicalData in payload", !raw.includes("historicalData"));

  // --- per-facility honesty ---
  const byId = new Map(json.features.map((f) => [f.properties.id, f.properties]));

  const oitfIds = [
    "rts-oitf-mui-wo", "rts-oitf-cheung-chau", "rts-oitf-peng-chau",
    "rts-oitf-hei-ling-chau", "rts-oitf-yung-shue-wan", "rts-oitf-sok-kwu-wan",
    "rts-oitf-ma-wan",
  ];
  check("all 7 OITF sites present", oitfIds.every((id) => byId.has(id)),
    oitfIds.filter((id) => !byId.has(id)).join(",") || "all present");
  for (const id of oitfIds) {
    const f = byId.get(id);
    if (!f) continue;
    check(`${id}: throughput null`, f.throughputTonnesPerDay === null, String(f.throughputTonnesPerDay));
    check(`${id}: basis not-published`, f.throughputBasis === "not-published");
    check(`${id}: group total 90`, f.groupThroughputTonnesPerDay === 90, String(f.groupThroughputTonnesPerDay));
    check(`${id}: group note present`, typeof f.groupThroughputNoteEn === "string" && f.groupThroughputNoteEn.length > 10);
  }

  // Landfills carry void volume, not tpd
  for (const [id, mv3] of [["landfill-went", 61], ["landfill-nent", 35], ["landfill-sent", 43]]) {
    const f = byId.get(id);
    check(`${id}: void ${mv3} Mm3`, f && f.voidCapacityMillionM3 === mv3, f && String(f.voidCapacityMillionM3));
    check(`${id}: official throughput`, f && f.throughputBasis === "official");
    check(`${id}: no design tpd`, f && f.designCapacityTonnesPerDay === null);
  }

  // I.PARK1: design capacity only, no operating throughput
  const ipark = byId.get("ipark-shek-kwu-chau");
  check("I-PARK1: throughput null", ipark && ipark.throughputTonnesPerDay === null);
  check("I-PARK1: design 3000 tpd", ipark && ipark.designCapacityTonnesPerDay === 3000);
  check("I-PARK1: commissioned 2025", ipark && ipark.commissionedYear === 2025);

  // Published RTS / parks
  for (const [id, tpd] of [
    ["rts-island-east", 1225], ["rts-island-west", 1153], ["rts-west-kowloon", 2700],
    ["rts-shatin", 1655], ["rts-north-lantau", 660], ["rts-nwnt", 1260],
    ["opark-siu-ho-wan", 200], ["ypark-tsang-tsui", 15],
    ["landfill-went", 6400], ["landfill-nent", 6000], ["landfill-sent", 2000],
  ]) {
    const f = byId.get(id);
    check(`${id}: throughput ${tpd}`, f && f.throughputTonnesPerDay === tpd, f && String(f.throughputTonnesPerDay));
  }

  // Exactly 11 sites with a published per-site throughput
  const published = json.features.filter((f) => f.properties.throughputTonnesPerDay !== null).length;
  check("exactly 11 published per-site figures", published === 11, `got ${published}`);

  // Geometry trusted: WGS84 within HK bbox
  const geoOk = json.features.every((f) => {
    const c = f.geometry.coordinates;
    return Array.isArray(c) && c.length === 2 && c[0] >= 113.8 && c[0] <= 114.5 && c[1] >= 22.15 && c[1] <= 22.6;
  });

  // --- filters still behave ---
  const landfillOnly = await (await fetch(`${BASE}/api/waste-data?category=Landfill`)).json();
  check("?category=Landfill -> 3", landfillOnly.features.length === 3, String(landfillOnly.features.length));
  const notFound = await fetch(`${BASE}/api/waste-data?id=does-not-exist`);
  check("?id=unknown -> 404", notFound.status === 404, String(notFound.status));

  // =====================================================================
  // /api/station-data — measured intake from operator weighbridge records
  // =====================================================================
  // A different source from /api/waste-data: EPD publishes no per-facility
  // throughput, these are real per-weigh-in records. The two must stay
  // separate, so this payload must never leak into the facility register.
  check("EPD metadata carries weighbridgeSource", typeof md.weighbridgeSource === "string" && md.weighbridgeSource.length > 20);

  const stationRes = await fetch(`${BASE}/api/station-data`);
  check("station-data: HTTP 200", stationRes.status === 200, `status=${stationRes.status}`);
  check("station-data: CORS open", stationRes.headers.get("access-control-allow-origin") === "*");
  const sd = await stationRes.json();

  check("station-data: has meta + stations", Boolean(sd.meta) && Boolean(sd.stations));
  check("station-data: only completed weigh-ins counted", sd.meta?.statusKept === "完成", sd.meta?.statusKept);
  check("station-data: reports 5 excluded weigh-ins",
    sd.meta?.excluded?.notCompletedRecords === 5, JSON.stringify(sd.meta?.excluded?.notCompletedByStatus));
  check("station-data: exclusion note present", typeof sd.meta?.excluded?.noteEn === "string" && sd.meta.excluded.noteEn.length > 20);

  const wkts = sd.stations?.WKTS;
  check("station-data: WKTS present", Boolean(wkts));
  check("station-data: WKTS joins to rts-west-kowloon", wkts?.facilityId === "rts-west-kowloon", wkts?.facilityId);

  // --- period ---
  check("WKTS period is 1-15 Oct 2026",
    wkts?.period?.from === "2026-10-01" && wkts?.period?.to === "2026-10-15",
    JSON.stringify(wkts?.period));
  check("WKTS has 15 operating days", wkts?.period?.operatingDays === 15, String(wkts?.period?.operatingDays));

  // --- headline totals ---
  check("WKTS totals 50,033.36 t", Math.abs((wkts?.totals?.tonnes ?? 0) - 50033.36) < 0.01, String(wkts?.totals?.tonnes));
  check("WKTS totals 12,015 weigh-ins", wkts?.totals?.loads === 12015, String(wkts?.totals?.loads));
  check("WKTS average 3,335.56 t/day", Math.abs((wkts?.totals?.tonnesPerDay ?? 0) - 3335.557) < 0.01, String(wkts?.totals?.tonnesPerDay));
  check("WKTS maintenance reported separately (50.42 t / 66 loads)",
    Math.abs((wkts?.totals?.maintenanceTonnes ?? 0) - 50.42) < 0.01 && wkts?.totals?.maintenanceLoads === 66,
    `${wkts?.totals?.maintenanceTonnes} / ${wkts?.totals?.maintenanceLoads}`);

  // --- the index must be light: no day rows, but the months are listed ---
  check("index lists the months on disk", JSON.stringify(wkts?.months) === JSON.stringify(["2026-10"]),
    JSON.stringify(wkts?.months));
  check("index carries no day rows", wkts?.daily === undefined, typeof wkts?.daily);

  // --- every dimension must reconcile to the same intake total ---
  const sum = (arr, key) => (arr ?? []).reduce((a, x) => a + (x[key] ?? 0), 0);
  const near = (a, b) => Math.abs(a - b) < 0.02;
  const total = wkts?.totals?.tonnes ?? 0;
  check("WKTS waste types sum to the total", near(sum(wkts?.wasteTypes, "tonnes"), total), String(sum(wkts?.wasteTypes, "tonnes")));
  check("WKTS districts sum to the total", near(sum(wkts?.districts, "tonnes"), total), String(sum(wkts?.districts, "tonnes")));
  check("WKTS streams sum to the total", near(sum(wkts?.streams, "tonnes"), total), String(sum(wkts?.streams, "tonnes")));

  // --- the delivery split, as the user specified it ---
  const streams = Object.fromEntries((wkts?.streams ?? []).map((s) => [s.key, s]));
  check("WKTS streams are private / public / gtw only",
    JSON.stringify(Object.keys(streams).sort()) === JSON.stringify(["gtw", "private", "public"]),
    JSON.stringify(Object.keys(streams)));
  check("private = P99 (26,114.94 t)", near(streams.private?.tonnes, 26114.94), String(streams.private?.tonnes));
  check("public = C31 + G01 (16,392.31 t)", near(streams.public?.tonnes, 16392.31), String(streams.public?.tonnes));
  check("gtw = P97 (7,526.11 t)", near(streams.gtw?.tonnes, 7526.11), String(streams.gtw?.tonnes));
  check("stream shares are fractions of intake, not of loads",
    near(streams.private?.share, 0.522) && near(streams.public?.share, 0.328) && near(streams.gtw?.share, 0.15),
    `${streams.private?.share} / ${streams.public?.share} / ${streams.gtw?.share}`);
  check("maintenance is NOT one of the intake streams", streams.maintenance === undefined);

  // --- GTW: WKTS is the only station that takes it ---
  const gtwTypes = (wkts?.wasteTypes ?? []).filter((w) => w.gtw);
  check("exactly one waste type is flagged GTW", gtwTypes.length === 1, String(gtwTypes.length));
  check("GTW is S40.00 grease trap waste",
    gtwTypes[0]?.code === "S40.00" && gtwTypes[0]?.loads === 848 && near(gtwTypes[0]?.tonnes, 7526.11),
    JSON.stringify(gtwTypes[0]));
  check("GTW is in the Special group", gtwTypes[0]?.group === "Special", gtwTypes[0]?.group);

  // --- normalisation: the S42 typo/case duplicate must be one row ---
  const s42 = (wkts?.wasteTypes ?? []).concat(wkts?.wasteTypesMaintenance ?? []).filter((w) => w.code === "S42.00");
  check("S42.00 de-duplicated to a single row", s42.length === 1, `rows=${s42.length}`);
  check("S42.00 was the maintenance vehicle only",
    (wkts?.wasteTypes ?? []).every((w) => w.code !== "S42.00"),
    JSON.stringify((wkts?.wasteTypes ?? []).map((w) => w.code)));

  // --- districts ---
  check("WKTS has 20 source districts", wkts?.districts?.length === 20, String(wkts?.districts?.length));
  check("largest district is Kwai Tsing (8,793.35 t)",
    wkts?.districts?.[0]?.code === "31" && near(wkts?.districts?.[0]?.tonnes, 8793.35),
    JSON.stringify(wkts?.districts?.[0]));
  check("districts carry an English label", wkts?.districts?.every((d) => typeof d.nameEn === "string" && d.nameEn.length > 1));

  // --- no raw identifiers may reach the payload ---
  const sdRaw = JSON.stringify(sd);
  check("station-data: no account numbers", !sdRaw.includes("賬戶號碼"));
  check("station-data: no licence plates", !sdRaw.includes("車牌"));
  check("station-data: no permitted-weight field", !sdRaw.includes("許可重量"));
  check("station-data: no station codes other than the covered ones",
    JSON.stringify(sd.meta?.stations) === JSON.stringify(["WKTS"]), JSON.stringify(sd.meta?.stations));

  // --- filters ---
  // ?station= and ?facility= return the *detail* response: one station, its
  // month files merged in, day rows included. This is the only way day-level
  // rows leave the server, and it is scoped to a single station on purpose.
  const detailRes = await fetch(`${BASE}/api/station-data?station=WKTS`);
  const oneStation = await detailRes.json();
  const wk = oneStation.station;
  check("?station=WKTS returns a station detail", Boolean(wk), JSON.stringify(Object.keys(oneStation)));
  check("?station=WKTS has no stations map", oneStation.stations === undefined);
  check("detail: day rows merged from the month files", wk?.daily?.length === 15, String(wk?.daily?.length));
  check("detail: months match the index", JSON.stringify(wk?.months) === JSON.stringify(["2026-10"]));
  check("detail: day rows sum to the total", near(sum(wk?.daily, "tonnes"), total), String(sum(wk?.daily, "tonnes")));
  check("detail: daily waste types sum to the total",
    near(
      (wk?.daily ?? []).reduce((a, d) => a + d.wasteTypes.reduce((x, w) => x + w.tonnes, 0), 0),
      total
    ));
  check("detail: daily districts sum to the total",
    near(
      (wk?.daily ?? []).reduce((a, d) => a + d.districts.reduce((x, v) => x + v.tonnes, 0), 0),
      total
    ));
  check("detail: per-stream loads reconcile",
    Object.values(streams).every((s) =>
      (wk?.daily ?? []).reduce((a, d) => a + (d[`${s.key}Loads`] ?? 0), 0) === s.loads
    ),
    JSON.stringify(Object.values(streams).map((s) => s.key)));
  const detailRaw = JSON.stringify(oneStation);
  check("detail: no account numbers", !detailRaw.includes("賬戶號碼"));
  check("detail: no licence plates", !detailRaw.includes("車牌"));

  const byFacility = await (await fetch(`${BASE}/api/station-data?facility=rts-west-kowloon`)).json();
  check("?facility=rts-west-kowloon -> WKTS detail", byFacility.station?.stationId === "WKTS");
  const noCoverage = await fetch(`${BASE}/api/station-data?facility=landfill-went`);
  check("?facility without coverage -> 404", noCoverage.status === 404, String(noCoverage.status));
  const unknownStation = await fetch(`${BASE}/api/station-data?station=ZZZZ`);
  check("?station=unknown -> 404", unknownStation.status === 404, String(unknownStation.status));

  // --- caching ---
  const etag = stationRes.headers.get("etag");
  check("station-data: ETag emitted", Boolean(etag), String(etag));
  const revalidated = await fetch(`${BASE}/api/station-data`, { headers: { "if-none-match": etag } });
  check("station-data: 304 on matching ETag", revalidated.status === 304, String(revalidated.status));

  // --- home page renders ---
  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  check("home page 200", home.status === 200, String(home.status));
  check("home page has app title", /Waste/i.test(html) && /港|廢物|Waste Management/i.test(html));

  // --- report ---
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== API verification: ${checks.length - failed.length}/${checks.length} passed ===`);
  for (const c of failed) console.log(`FAIL  ${c.name} ${c.detail}`);
  if (!geoOk) console.log("FAIL  geometry bbox");
  process.exit(failed.length === 0 && geoOk ? 0 : 1);
})().catch((err) => {
  console.error("VERIFY_ERROR:", err.message);
  process.exit(1);
});
