/**
 * Bounded verification of the /api/waste-data payload after the official-data
 * migration. Polls until the dev server answers, then asserts the data-honesty
 * invariants, prints a summary, and always exits non-zero on any failure.
 */
const BASE = "http://localhost:3000";

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
