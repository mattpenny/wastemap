/**
 * Browser smoke test for the Waste Map app — collapsed-by-default + RTS-default
 * revision. Boots the page in system Chrome, captures console/page errors, and
 * verifies:
 *   1. the opening state — all three cards collapsed, RTS filter pre-selected;
 *   2. the header stats, the ranking card, the facility drawer (the published
 *      EPD figures and everything else sit behind the Detail toggle, which must
 *      also bring the revealed section into view — it opens ~1,500px down the
 *      drawer's scroller);
 *   3. that the Hong Kong-wide trend chart lives in its own panel rather than in
 *      the drawer.
 * Saves screenshots to out/verify/.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./_playwright.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "out", "verify");
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await launchChromium();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
});

const BASE = process.env.BASE ?? "http://localhost:3000";

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
// Let the map + deck.gl layers settle (tile streams never go idle, so waiting
// for networkidle would hang indefinitely). Wait for the map's loading overlay
// to disappear (style `load` event or the 12s fallback), then let pillars frame.
// Case-insensitive: the header's stat labels are CSS-uppercased, and innerText
// reflects text-transform, so the rendered text is "FACILITIES".
await page.waitForFunction(
  () => /facilities/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForFunction(
  () => !document.body.innerText.includes("Loading facility data"),
  { timeout: 30000 }
);
await page.waitForTimeout(4000);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
};

// Panel headers carry aria-label="Expand"/"Collapse", which overrides their
// visible text as the accessible name — locate them by text instead.
// `:not([data-dock-tab])` excludes the phone bottom dock: its "Legend" tab
// carries the same label as the legend card's own header.
const rankingHeader = page.locator("button:not([data-dock-tab])", {
  hasText: "Reported throughput by facility",
});
const legendHeader = page.locator("button:not([data-dock-tab])", {
  hasText: /^Legend$/,
});
const trendHeader = page.locator("button:not([data-dock-tab])", {
  hasText: "Hong Kong-wide annual waste disposal",
});

// =====================================================================
// 1. Opening state — everything collapsed, RTS pre-selected
// =====================================================================
let bodyText = await page.evaluate(() => document.body.innerText);

check("app title present", /Waste/i.test(bodyText));
check("three panel headers rendered", (await rankingHeader.count()) === 1 &&
  (await legendHeader.count()) === 1 && (await trendHeader.count()) === 1);

check("ranking body not rendered", (await page.locator("button", { hasText: /^All$/ }).count()) === 0);
check("legend body not rendered",
  (await page.locator("button", { hasText: "Strategic Landfill" }).count()) === 0);
check("trend chart not rendered", (await page.locator(".recharts-wrapper").count()) === 0);

const chevrons = await Promise.all(
  [rankingHeader, legendHeader, trendHeader].map(async (h) =>
    /chevron-down/.test((await h.locator("svg").last().getAttribute("class")) ?? "")
  )
);
check("all collapsed cards show a down chevron", chevrons.every(Boolean), JSON.stringify(chevrons));

// Each card must stay in the corner it has always occupied, and the phone dock
// must be entirely absent up here. Both regressed while the dock was built: its
// tabs leaked onto desktop as loose buttons (their wrapper is `lg:contents`),
// and a stray `ml-1` pushed the info button 4px off its corner.
const layout = await page.evaluate(() => {
  const at = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), right: Math.round(b.right) };
  };
  return {
    ranking: at('[data-testid="ranking-sheet"]'),
    legend: at('[data-testid="legend-sheet"]'),
    trend: at('[data-testid="trend-sheet"]'),
    info: at('[data-testid="map-info"]'),
    toolbar: at('[data-testid="display-toolbar"]'),
    header: at("header"),
    dockTabs: [...document.querySelectorAll("[data-dock-tab]")].filter(
      (el) => el.getBoundingClientRect().height > 0
    ).length,
    // The phone disclosures must not exist up here: the figures are always on
    // from md up, and the toolbar is its own row beside the header.
    phoneDisclosures: [
      '[data-testid="header-detail-toggle"]',
      '[data-testid="display-toggle"]',
    ].filter((sel) => (document.querySelector(sel)?.getBoundingClientRect().height ?? 0) > 0).length,
  };
});
check("desktop: ranking card is top-right", layout.ranking.x > 1000 && layout.ranking.y < 120, JSON.stringify(layout.ranking));
check("desktop: legend card is bottom-left", layout.legend.x < 60 && layout.legend.y > 700, JSON.stringify(layout.legend));
check("desktop: trend card is bottom-right", layout.trend.x > 1000 && layout.trend.y > 700, JSON.stringify(layout.trend));
check("desktop: info button is bottom-left", layout.info.x === 12, JSON.stringify(layout.info));
check("desktop: phone dock is hidden", layout.dockTabs === 0, `visibleTabs=${layout.dockTabs}`);
check("desktop: display toolbar is its own row beside the header",
  layout.toolbar.x > layout.header.right && layout.toolbar.y < 120,
  `toolbar=${JSON.stringify(layout.toolbar)} header=${JSON.stringify(layout.header)}`);
check("desktop: phone header disclosures are not rendered",
  layout.phoneDisclosures === 0, `visible=${layout.phoneDisclosures}`);

// RTS is the default filter: 13 RTS sites (6 standalone + 7 OITF), 6 with a
// published rate, 7 without.
check("header stats show RTS-only subset (13 facilities)", /(^|\s)13(\s|$)/.test(bodyText) &&
  /facilit/i.test(bodyText), bodyText.match(/FACILITIES[^\n]*\n?[^\n]*/)?.[0] ?? "");
check("header stats show 6/13 published", bodyText.includes("6/13"));
await page.screenshot({ path: path.join(OUT_DIR, "opening-state-collapsed.png") });

// =====================================================================
// 2. Trend panel — its own card on the map, not inside the drawer
// =====================================================================
await trendHeader.click();
await page.waitForTimeout(1200);
bodyText = await page.evaluate(() => document.body.innerText);
// MetaRow/card labels are CSS-uppercased, so match the rendered casing.
check("HK-wide trend panel on map", /HONG KONG-WIDE ANNUAL WASTE DISPOSAL/i.test(bodyText));
check("trend panel states not-facility scope", /Not any single facility/i.test(bodyText));
const chartsOnMap = await page.locator(".recharts-wrapper").count();
check("one recharts panel (trend card) while no drawer open", chartsOnMap === 1, `charts=${chartsOnMap}`);
await page.screenshot({ path: path.join(OUT_DIR, "map-with-trend.png") });

// =====================================================================
// 3. Ranking card under the default RTS filter
// =====================================================================
await rankingHeader.click();
await page.waitForTimeout(800);
check("RTS quick filter pre-selected",
  (await page.getByRole("button", { name: /^RTS$/ }).getAttribute("aria-pressed")) === "true");
check("All quick filter not selected",
  (await page.getByRole("button", { name: /^All$/ }).getAttribute("aria-pressed")) === "false");

const rtsRows = await page.locator("aside ul > li").count();
check("ranking lists 7 RTS entries (6 stations + OITF group)", rtsRows === 7, `rows=${rtsRows}`);

// =====================================================================
// 4. Open an RTS drawer: default view must be clean
// =====================================================================
const iets = page.locator("button", { hasText: "Island East Transfer Station" }).first();
check("IETS row present in ranking", (await iets.count()) === 1);
await iets.click();
await page.waitForTimeout(1500);

const drawer = page.locator('aside[role="dialog"]');
check("drawer open", (await drawer.count()) === 1);
let drawerText = await drawer.innerText();
// The published throughput and design capacity now live behind the Detail
// toggle, so a facility with no weighbridge records opens on the hint that
// points at it — not on the figures themselves.
check("drawer default hides the published throughput", !drawerText.includes("1,225"));
check("drawer default hides Design capacity", !/DESIGN CAPACITY/.test(drawerText));
check("drawer default offers the Detail hint",
  (await drawer.locator('[data-testid="detail-hint"]').count()) === 1);
// Note: the provenance note legitimately mentions "coordinates" in prose, so
// match the uppercase MetaRow label specifically.
check("drawer default hides Location", !/LOCATION/.test(drawerText));
check("drawer default hides Coordinates", !/COORDINATES/.test(drawerText));
check("drawer default hides Operational note", !/OPERATIONAL NOTE/.test(drawerText));
check("drawer default hides Opening hours", !/OPENING HOURS/.test(drawerText));
check("no chart inside drawer", (await drawer.locator(".recharts-wrapper").count()) === 0);
check("trend card hidden while drawer open", (await page.locator(".recharts-wrapper").count()) === 0);
await page.screenshot({ path: path.join(OUT_DIR, "drawer-iets-default.png") });

// =====================================================================
// 5. Detail toggle reveals the full EPD record
// =====================================================================
const detailBtn = drawer.getByRole("button", { name: /show facility detail/i });
check("Detail toggle present next to name", (await detailBtn.count()) === 1);
await detailBtn.click();
// Smooth scroll of the revealed section takes a moment to settle.
await page.waitForTimeout(1500);
drawerText = await drawer.innerText();

// The toggle used to look broken: the section did open, but a long way down
// the drawer's scroller, so nothing on screen changed. Assert the revealed
// content is actually inside the drawer's viewport.
{
  const drawerBox = await drawer.boundingBox();
  const locBox = await drawer.getByText("Location", { exact: true }).first().boundingBox();
  check("detail scrolls the revealed section into view",
    Boolean(locBox && drawerBox) &&
      locBox.y > drawerBox.y &&
      locBox.y < drawerBox.y + drawerBox.height,
    JSON.stringify({ locY: locBox?.y, drawerY: drawerBox?.y, h: drawerBox?.height }));
}

check("detail shows the published throughput 1,225", drawerText.includes("1,225"));
check("detail shows Design capacity", /DESIGN CAPACITY/.test(drawerText));
check("detail shows Location", /LOCATION/.test(drawerText));
check("detail shows Sun Yip Street address", /Sun Yip Street/i.test(drawerText));
check("detail shows November 1992", /November 1992/i.test(drawerText));
check("detail shows Operator", /OPERATOR/.test(drawerText));
check("detail shows Opening hours", /OPENING HOURS/.test(drawerText));
check("detail shows Contractor", /CONTRACTOR/.test(drawerText));
check("detail shows capital cost", /\$381 million/i.test(drawerText));
check("detail shows waste delivered to", /WASTE DELIVERED TO/.test(drawerText));
check("detail shows major plant", /MAJOR PLANT/.test(drawerText));
check("detail shows Coordinates", /COORDINATES/.test(drawerText));
check("detail shows Operational note", /OPERATIONAL NOTE/.test(drawerText));
check("detail shows EPD facility page link", (await drawer.getByRole("link", { name: /EPD facility page/i }).count()) === 1);
await page.screenshot({ path: path.join(OUT_DIR, "drawer-iets-detail.png") });

// --- toggle collapses again ---
await drawer.getByRole("button", { name: /hide facility detail/i }).click();
await page.waitForTimeout(500);
drawerText = await drawer.innerText();
check("detail collapses back", !/CONTRACTOR/.test(drawerText));
await page.locator('button[aria-label="Close" i]').first().click().catch(() => {});
await page.waitForTimeout(600);

// =====================================================================
// 6. "All" filter — the other 6 sites come back
// =====================================================================
await page.getByRole("button", { name: /^All$/ }).click();
await page.waitForTimeout(1200);
bodyText = await page.evaluate(() => document.body.innerText);
check("All filter restores 19 facilities", /(^|\s)19(\s|$)/.test(bodyText) && /facilit/i.test(bodyText));
check("All filter restores 11/19 published", bodyText.includes("11/19"));

// =====================================================================
// 7. WENT landfill drawer (void volume)
// =====================================================================
const went = page.locator("button", { hasText: "West New Territories Landfill" }).first();
await went.click();
await page.waitForTimeout(1200);
const wentDrawer = page.locator('aside[role="dialog"]');
// Both figures sit behind the Detail toggle now.
await wentDrawer.getByRole("button", { name: /show facility detail/i }).click();
await page.waitForTimeout(1500);
const wentText = await wentDrawer.innerText();
check("WENT detail shows 6,400 tpd", wentText.includes("6,400"));
check("WENT detail shows 61 Mm3 void", /61/.test(wentText));
await page.locator('button[aria-label="Close" i]').first().click().catch(() => {});
await page.waitForTimeout(600);

// =====================================================================
// 8. OITF expand
// =====================================================================
const oitf = page.locator("button", { hasText: /Outlying Islands Transfer/ }).first();
if (await oitf.count()) {
  await oitf.click();
  await page.waitForTimeout(800);
  const afterExpand = await page.evaluate(() => document.body.innerText);
  check("OITF expands to substations", afterExpand.includes("Mui Wo Transfer Facility"));
  check("substations show N/A label", /N\/A/.test(afterExpand));
} else {
  check("OITF group row found", false);
}

// =====================================================================
// 9. WKTS weighbridge records — the measured-intake block
// =====================================================================
// A different source from the EPD facility record: real per-weigh-in records
// from the station's own weighbridge. Only WKTS reports any, so this section
// also proves the block stays absent for every other station (see the IETS
// drawer checks in section 4, which assert no chart appears there).
{
  const wkts = page.locator("button", { hasText: "West Kowloon Transfer Station" }).first();
  check("WKTS row present in ranking", (await wkts.count()) === 1);
  await wkts.click();
  await page.waitForTimeout(2000);

  const drawer = page.locator('aside[role="dialog"]');
  const section = drawer.locator('[data-testid="weighbridge-section"]');
  check("WKTS drawer shows the weighbridge block", (await section.count()) === 1);

  const wbText = await section.innerText();
  // The intake is split MSW / GTW, so the two tiles sum to the period total
  // (42,507 + 7,526 = 50,033) rather than showing it as one figure.
  check("weighbridge: total received MSW 42,507 t", wbText.includes("42,507"), wbText.slice(0, 160));
  check("weighbridge: total received GTW 7,526 t", wbText.includes("7,526"));
  check("weighbridge: 12,015 weigh-ins", wbText.includes("12,015"));
  check("weighbridge: 15 operating days", /\b15\b/.test(wbText));
  check("weighbridge: labelled as measured, not published", /MEASURED INTAKE/i.test(wbText));
  // Both were removed on request: the card no longer sets a measured intake
  // against the EPD published rate, nor shows the station's maintenance loads.
  check("weighbridge: no measured-vs-published paragraph",
    !/against an EPD published rate/i.test(wbText));
  check("weighbridge: maintenance note removed", !/Station maintenance/i.test(wbText));
  check("weighbridge: provenance footnote removed", !/not an EPD publication/i.test(wbText));

  // GTW is its own delivery stream and its own tile, so it is no longer a row
  // in the waste-type list.
  check("weighbridge: GTW is a delivery stream", /Grease trap waste/i.test(wbText));
  check("weighbridge: says WKTS is the only station taking GTW",
    /only transfer station/i.test(wbText));
  check("weighbridge: GTW row removed from the waste-type list",
    !/grease trap waste \(GTW\)/i.test(wbText));

  // Private vs public, as specified.
  check("weighbridge: private vehicles row", /Private vehicles/i.test(wbText));
  check("weighbridge: FEHD / public row", /FEHD \/ public/i.test(wbText));
  check("weighbridge: private is 52.2%", wbText.includes("52.2%"), "");
  check("weighbridge: public is 32.8%", wbText.includes("32.8%"));
  check("weighbridge: GTW is 15.0%", wbText.includes("15.0%"));

  check("weighbridge: source district section", /SOURCE DISTRICT/i.test(wbText));
  check("weighbridge: lists Kwai Tsing", /Kwai Tsing/i.test(wbText));
  check("weighbridge: waste type section", /WASTE TYPE/i.test(wbText));

  // The intake chart is three lines by delivery stream, not a stack of bars.
  const chartKind = await section.evaluate((el) => {
    const w = el.querySelector(".recharts-wrapper");
    return {
      lines: w?.querySelectorAll(".recharts-line").length ?? 0,
      bars: w?.querySelectorAll(".recharts-bar").length ?? 0,
      // First and last x labels, to prove the series is daily and not a
      // running total.
      ticks: [...(w?.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value") ?? [])]
        .map((t) => t.textContent),
    };
  });
  check("weighbridge: intake chart is a 3-line chart",
    chartKind.lines === 3 && chartKind.bars === 0, JSON.stringify(chartKind));
  check("weighbridge: intake chart is the daily series",
    chartKind.ticks[0] === "01/10" && chartKind.ticks.includes("15/10"),
    JSON.stringify(chartKind.ticks));
  check("weighbridge: exactly one chart in the drawer",
    (await drawer.locator(".recharts-wrapper").count()) === 1);

  // --- bar geometry ---
  // Bars are sized from each row's share of its list's denominator. An earlier
  // build passed Array.map's index as the share, so the bars read 0%, 100%,
  // 200%… and every one past the first was clipped to full width — which looked
  // plausible on screen. Assert the geometry, not just the text.
  const readList = (id) =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      return [...root.querySelectorAll("div.space-y-1")].map((row) => {
        const label = row.querySelector("span")?.innerText?.trim() ?? "";
        const value = row.querySelector("span.font-semibold.tabular-nums")?.innerText ?? "";
        const pctText = row.querySelector("span.w-28")?.innerText?.replace(/\s+/g, " ").trim() ?? "";
        const bar = row.querySelector('div[style*="width"]');
        return {
          label,
          value: Number.parseFloat(value.replace(/,/g, "")),
          pctText,
          width: Number.parseFloat(bar?.style?.width ?? "0"),
          color: bar?.style?.backgroundColor ?? "",
        };
      });
    }, `[data-testid="${id}"]`);

  const wbStreams = await readList("wb-streams");
  const wbWaste = await readList("wb-waste-types");
  const wbDistricts = await readList("wb-districts");

  const allBars = [...(wbStreams ?? []), ...(wbWaste ?? []), ...(wbDistricts ?? [])];
  check("weighbridge: bars are proportional, not index-sized",
    allBars.length > 0 && allBars.every((b) => b.width > 0 && b.width <= 100),
    JSON.stringify(allBars.map((b) => b.width)));

  // Streams are drawn against total intake, so their width IS the printed
  // share. The two ranked lists are drawn against their own largest row so the
  // long tail stays visible; their printed % is still the share of intake.
  check("weighbridge: stream bars match their printed share",
    wbStreams?.every((b) => {
      const printed = Number.parseFloat(b.pctText);
      return Number.isFinite(printed) && Math.abs(printed - b.width) < 0.15;
    }),
    JSON.stringify(wbStreams?.map((b) => `${b.width}/${b.pctText}`)));
  check("weighbridge: stream bars are 52.2 / 32.8 / 15.0",
    wbStreams?.length === 3 &&
      Math.abs(wbStreams[0].width - 52.2) < 0.2 &&
      Math.abs(wbStreams[1].width - 32.8) < 0.2 &&
      Math.abs(wbStreams[2].width - 15.0) < 0.2,
    JSON.stringify(wbStreams?.map((b) => b.width)));

  check("weighbridge: waste-type bars scale to the largest type and descend",
    wbWaste?.[0] && Math.abs(wbWaste[0].width - 100) < 0.2 &&
      wbWaste.every((b, i) => i === 0 || b.width <= wbWaste[i - 1].width),
    JSON.stringify(wbWaste?.map((b) => b.width)));

  // Shares are of MSW now that the GTW row is gone, so the top type reads 45.3%
  // (19,272 of 42,507) rather than 38.5% of all intake.
  check("weighbridge: top waste type is 45.3% of MSW",
    wbWaste?.[0] && Math.abs(Number.parseFloat(wbWaste[0].pctText) - 45.3) < 0.2,
    JSON.stringify(wbWaste?.[0]));

  // The district complaint: the bars were drawn against all intake, so the
  // largest district filled only 17.6% of its track. They now scale to the
  // largest district, and each row carries its own colour.
  check("weighbridge: district bars scale to the largest district and descend",
    wbDistricts?.[0] && Math.abs(wbDistricts[0].width - 100) < 0.2 &&
      wbDistricts.every((b, i) => i === 0 || b.width <= wbDistricts[i - 1].width),
    JSON.stringify(wbDistricts?.map((b) => b.width)));
  check("weighbridge: district rows are differently coloured",
    new Set((wbDistricts ?? []).map((b) => b.color)).size === wbDistricts?.length,
    JSON.stringify(wbDistricts?.map((b) => b.color)));
  check("weighbridge: top district is still 17.6% of intake",
    wbDistricts?.[0] && Math.abs(Number.parseFloat(wbDistricts[0].pctText) - 17.6) < 0.2,
    JSON.stringify(wbDistricts?.[0]?.pctText));

  // --- the Per day / Total switch ---
  check("weighbridge: Per day / Total switch present",
    (await section.locator('[data-testid="wb-mode"]').count()) === 1);
  check("weighbridge: opens on Total",
    (await section.locator('[data-testid="wb-mode-total"]').getAttribute("aria-pressed")) === "true");

  await section.locator('[data-testid="wb-mode-perday"]').click();
  await page.waitForTimeout(600);
  const perDayText = await section.innerText();
  check("weighbridge: Per day relabels the tiles",
    /MSW PER DAY/i.test(perDayText) && /GTW PER DAY/i.test(perDayText));
  // 42,507.25 / 15 and 7,526.11 / 15.
  check("weighbridge: Per day rescales the tiles",
    perDayText.includes("2,834") && perDayText.includes("502") && perDayText.includes("801"),
    perDayText.slice(0, 160));
  // The chart stays the daily series in both modes — the switch only rescales
  // the totals and averages around it.
  check("weighbridge: the daily chart is unaffected by the switch",
    /DAILY WASTE INTAKE/i.test(perDayText));
  const perDayWaste = await readList("wb-waste-types");
  check("weighbridge: Per day rescales the ranked lists",
    perDayWaste?.[0] && Math.abs(perDayWaste[0].value - 1285) < 2 &&
      Math.abs(Number.parseFloat(perDayWaste[0].pctText) - 45.3) < 0.2,
    JSON.stringify(perDayWaste?.[0]));
  await page.screenshot({ path: path.join(OUT_DIR, "wkts-weighbridge-perday.png") });

  await section.locator('[data-testid="wb-mode-total"]').click();
  await page.waitForTimeout(600);
  const backToTotal = await section.innerText();
  check("weighbridge: switching back restores the period totals",
    backToTotal.includes("42,507") && /TOTAL RECEIVED \(MSW\)/i.test(backToTotal));

  // --- ranked lists expand ---
  const moreButtons = section.locator('[data-testid="ranked-more"]');
  check("weighbridge: both ranked lists offer an expander",
    (await moreButtons.count()) === 2, `buttons=${await moreButtons.count()}`);
  await moreButtons.first().click();
  await page.waitForTimeout(600);
  const expandedWaste = await readList("wb-waste-types");
  check("weighbridge: +N reveals the remaining rows",
    (expandedWaste?.length ?? 0) > (wbWaste?.length ?? 0),
    `${wbWaste?.length} -> ${expandedWaste?.length}`);

  await page.screenshot({ path: path.join(OUT_DIR, "wkts-weighbridge.png") });
  await page.locator('button[aria-label="Close" i]').first().click().catch(() => {});
  await page.waitForTimeout(600);
}

// =====================================================================
// 10. Mobile layout — bottom dock, one sheet at a time, one-line title
// =====================================================================
// History, in order: (a) the ranking card and the trend panel were `hidden`
// below lg, so on a phone they — and the ranking card's quick filters — did not
// exist at all, and the title wrapped onto two lines under ~412px; (b) with
// them restored as three always-on cards plus a 48px gap they ate ~190px of a
// 667px screen. The cards now live behind a dock pinned to the bottom edge, so
// these checks cover the dock, the sheet each tab opens, and how much map is
// left over.
{
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The header figures are collapsed on a phone, so "Facilities" is not in the
  // rendered text on load — waiting on /facilities/i here would time out.
  // Wait on the title and on the map's loading overlay instead.
  await mobile.waitForFunction(() => /waste management/i.test(document.body.innerText), { timeout: 60000 });
  await mobile.waitForFunction(() => !/Loading facility data/.test(document.body.innerText), { timeout: 30000 });
  await mobile.waitForTimeout(6000);

  const tab = (name) => mobile.locator(`[data-dock-tab="${name}"]`);
  /** Is this sheet on screen right now? */
  const sheetShown = (id) =>
    mobile.evaluate(
      (sel) => {
        const el = document.querySelector(sel);
        return Boolean(el && el.getBoundingClientRect().height > 0);
      },
      `[data-testid="${id}"]`
    );

  const m = await mobile.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        w: Math.round(r.width),
        h: Math.round(r.height),
        shown: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none",
      };
    };
    const h1 = document.querySelector("h1");
    const cs = h1 ? getComputedStyle(h1) : null;
    // Is any *visible* element rendering the given exact text? innerText only
    // covers rendered nodes, so this is a true visibility test.
    const textShown = (re) =>
      [...document.querySelectorAll("span, p, button")].some(
        (el) => re.test(el.innerText?.trim() ?? "") && el.getBoundingClientRect().height > 0
      );
    return {
      titleLines: h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(cs.lineHeight)) : null,
      titleText: h1?.innerText,
      header: rect(document.querySelector("header")),
      dock: rect(document.querySelector('[data-testid="bottom-dock"]')),
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
      vh: innerHeight,
      figuresShown: textShown(/^(facilities|設施)$/i),
      publishedShown: textShown(/^(with published rate|有公布處理量)$/i),
      toolbarShown: rect(document.querySelector('[data-testid="display-toolbar-phone"]'))?.shown ?? null,
      // The desktop copy of the toolbar lives in the DOM but must never show
      // down here — that is what `md:flex` is for.
      desktopToolbarShown: rect(document.querySelector('[data-testid="display-toolbar"]'))?.shown ?? null,
      detailToggle: rect(document.querySelector('[data-testid="header-detail-toggle"]')),
      displayToggle: rect(document.querySelector('[data-testid="display-toggle"]')),
    };
  });

  check("mobile: title stays on one line", m.titleLines === 1, `lines=${m.titleLines} text="${m.titleText}"`);
  check("mobile: dock is pinned to the bottom edge", Math.abs(m.dock.bottom - m.vh) <= 1, JSON.stringify(m.dock));
  check(
    "mobile: dock carries all three tabs",
    (await tab("list").count()) === 1 &&
      (await tab("legend").count()) === 1 &&
      (await tab("trend").count()) === 1
  );
  check(
    "mobile: no sheet is open on load",
    !(await sheetShown("ranking-sheet")) &&
      !(await sheetShown("legend-sheet")) &&
      !(await sheetShown("trend-sheet"))
  );
  check("mobile: no horizontal overflow", m.scrollW <= m.vw, `scrollW=${m.scrollW} vw=${m.vw}`);

  // The whole point of the dock: the map gets the screen back. Header and dock
  // are the only chrome, so everything between them is map.
  const mapShare = (m.dock.top - m.header.bottom) / m.vh;
  check("mobile: map keeps most of the viewport", mapShare >= 0.75, `${Math.round(mapShare * 100)}%`);

  // -----------------------------------------------------------------
  // The two phone disclosures — header figures and the display toolbar.
  // Both start closed, so the opening view is the title and nothing else.
  // -----------------------------------------------------------------
  check("mobile: header figures are collapsed on load", !m.figuresShown && !m.publishedShown,
    `facilities=${m.figuresShown} published=${m.publishedShown}`);
  // The phone toolbar is not rendered at all until its pill is tapped, and the
  // desktop copy that does exist in the DOM must stay `display: none`.
  check("mobile: display toolbar is collapsed on load", !m.toolbarShown && !m.desktopToolbarShown,
    `phone=${m.toolbarShown} desktopCopy=${m.desktopToolbarShown}`);
  check("mobile: both header chevrons are on screen",
    m.detailToggle?.shown === true && m.displayToggle?.shown === true,
    `detail=${JSON.stringify(m.detailToggle)} display=${JSON.stringify(m.displayToggle)}`);
  check("mobile: header stays short with both disclosures shut", m.header.h <= 90, `h=${m.header.h}`);

  // Chevron -> figures on, chevron -> figures off again.
  const figuresVisible = () =>
    mobile.evaluate(() =>
      [...document.querySelectorAll("span")].some(
        (el) => /^(facilities|設施)$/i.test(el.innerText?.trim() ?? "") && el.getBoundingClientRect().height > 0
      )
    );

  await mobile.locator('[data-testid="header-detail-toggle"]').click();
  await mobile.waitForTimeout(700);
  const opened = await mobile.evaluate(() => {
    const vis = (re) =>
      [...document.querySelectorAll("span")].some(
        (el) => re.test(el.innerText?.trim() ?? "") && el.getBoundingClientRect().height > 0
      );
    return {
      figures: vis(/^(facilities|設施)$/i),
      published: vis(/^(with published rate|有公布處理量)$/i),
      noFigure: vis(/^(no site figure|無各站數據)$/i),
      expanded: document
        .querySelector('[data-testid="header-detail-toggle"]')
        ?.getAttribute("aria-expanded"),
    };
  });
  check("mobile: chevron reveals the facility figures",
    opened.figures && opened.published && opened.noFigure, JSON.stringify(opened));
  check("mobile: chevron reports aria-expanded", opened.expanded === "true", `aria-expanded=${opened.expanded}`);
  await mobile.screenshot({ path: path.join(OUT_DIR, "mobile-390-header-detail.png") });

  await mobile.locator('[data-testid="header-detail-toggle"]').click();
  await mobile.waitForTimeout(700);
  check("mobile: chevron collapses the figures again", !(await figuresVisible()));

  // Pill -> toolbar. It must open inside the header card, not as a loose row
  // over the map, and the desktop copy of the toolbar must stay hidden.
  await mobile.locator('[data-testid="display-toggle"]').click();
  await mobile.waitForTimeout(700);
  const toolbar = await mobile.evaluate(() => {
    const el = document.querySelector('[data-testid="display-toolbar-phone"]');
    const card = document.querySelector("header > div");
    const t = el?.getBoundingClientRect();
    const c = card?.getBoundingClientRect();
    const reachable = (label) =>
      [...document.querySelectorAll("button")].filter(
        (b) => b.getAttribute("aria-label") === label && b.getBoundingClientRect().height > 0
      ).length;
    return {
      shown: (t?.height ?? 0) > 0,
      insideCard: Boolean(t && c && t.left >= c.left - 1 && t.right <= c.right + 1),
      plusControls: reachable("Increase font size"),
      minusControls: reachable("Decrease font size"),
      fs: getComputedStyle(document.documentElement).getPropertyValue("--fs").trim(),
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });
  check("mobile: display pill opens the toolbar", toolbar.shown && toolbar.plusControls === 1,
    JSON.stringify(toolbar));
  check("mobile: toolbar sits inside the header card", toolbar.insideCard, JSON.stringify(toolbar));
  check("mobile: desktop toolbar copy stays hidden", toolbar.plusControls === 1 && toolbar.minusControls === 1,
    `A+=${toolbar.plusControls} A-=${toolbar.minusControls}`);
  check("mobile: opening the toolbar causes no horizontal overflow", toolbar.scrollW <= toolbar.vw,
    `${toolbar.scrollW}/${toolbar.vw}`);
  await mobile.screenshot({ path: path.join(OUT_DIR, "mobile-390-display-open.png") });

  // The toolbar must still work from inside the card. Scope the locators to the
  // header so they can only ever hit the phone copy.
  const plus = mobile.locator('header button[aria-label="Increase font size"]');
  await plus.click();
  await mobile.waitForTimeout(400);
  const fsUp = await mobile.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()
  );
  check("mobile: A+ still scales the type", Number(fsUp) > Number(toolbar.fs), `${toolbar.fs} -> ${fsUp}`);

  const titleAtLargest = await mobile.evaluate(() => {
    const h1 = document.querySelector("h1");
    return {
      lines: Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)),
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });
  check("mobile: title stays on one line with the type scaled up", titleAtLargest.lines === 1,
    JSON.stringify(titleAtLargest));

  await mobile.locator('header button[aria-label="Decrease font size"]').click();
  await mobile.waitForTimeout(400);
  const fsBack = await mobile.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()
  );
  check("mobile: A- restores the type", Number(fsBack) === Number(toolbar.fs), `${fsUp} -> ${fsBack}`);

  await mobile.locator('[data-testid="display-toggle"]').click();
  await mobile.waitForTimeout(600);
  check("mobile: display pill collapses the toolbar again", !(await mobile.evaluate(() =>
    (document.querySelector('[data-testid="display-toolbar-phone"]')?.getBoundingClientRect().height ?? 0) > 0)));
  check("mobile: header is short again with both disclosures shut",
    (await mobile.evaluate(() => Math.round(document.querySelector("header").getBoundingClientRect().height))) <= 90);

  // Ranking tab -> sheet with the quick filters (the "toggles" that used to be
  // missing on mobile entirely).
  await tab("list").click();
  await mobile.waitForTimeout(900);
  const chips = await mobile.getByRole("button", { name: /^RTS$/ }).count();
  check("mobile: ranking tab opens its sheet with filter toggles", chips === 1, `rtsChips=${chips}`);
  await mobile.screenshot({ path: path.join(OUT_DIR, "mobile-390-sheet-ranking.png") });

  // Accordion: opening the legend must close the ranking sheet, or two sheets
  // stack and push the map off screen.
  await tab("legend").click();
  await mobile.waitForTimeout(900);
  check("mobile: legend tab opens the legend sheet", await sheetShown("legend-sheet"));
  check("mobile: sheets are mutually exclusive", !(await sheetShown("ranking-sheet")));
  await mobile.screenshot({ path: path.join(OUT_DIR, "mobile-390-sheet-legend.png") });

  await tab("trend").click();
  await mobile.waitForTimeout(1200);
  const charts = await mobile.locator(".recharts-wrapper").count();
  check("mobile: trend tab renders the chart", charts === 1, `charts=${charts}`);
  check("mobile: trend sheet is on screen", await sheetShown("trend-sheet"));
  await mobile.screenshot({ path: path.join(OUT_DIR, "mobile-390-sheet-trend.png") });

  // Tapping the active tab again must close it, leaving the map alone.
  await tab("trend").click();
  await mobile.waitForTimeout(700);
  check("mobile: tapping the active tab closes its sheet", !(await sheetShown("trend-sheet")));

  // The weighbridge block has to survive the phone drawer too — it is the
  // densest thing in the app, and the mobile drawer is a bottom sheet rather
  // than the desktop side panel.
  await tab("list").click();
  await mobile.waitForTimeout(1000);
  await mobile.locator("button", { hasText: "West Kowloon Transfer Station" }).first().click();
  await mobile.waitForTimeout(2500);
  const mobileWb = await mobile.evaluate(() => {
    const sec = document.querySelector('[data-testid="weighbridge-section"]');
    const drawer = document.querySelector('aside[role="dialog"]');
    const text = drawer?.innerText ?? "";
    const bars = [...(sec?.querySelectorAll("div.space-y-1") ?? [])].map((row) =>
      Number.parseFloat(row.querySelector('div[style*="width"]')?.style?.width ?? "0")
    );
    return {
      shown: Boolean(sec),
      width: sec ? Math.round(sec.getBoundingClientRect().width) : 0,
      hasMsw: /42,507/.test(text),
      hasGtw: /grease trap waste/i.test(text),
      modeToggle: Boolean(sec?.querySelector('[data-testid="wb-mode"]')),
      charts: drawer?.querySelectorAll(".recharts-wrapper").length ?? 0,
      barsInRange: bars.length > 0 && bars.every((w) => w > 0 && w <= 100),
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });
  check("mobile: WKTS drawer shows the weighbridge block", mobileWb.shown, JSON.stringify(mobileWb));
  check("mobile: weighbridge figures render in the bottom sheet",
    mobileWb.hasMsw && mobileWb.hasGtw && mobileWb.charts === 1, JSON.stringify(mobileWb));
  check("mobile: weighbridge mode switch renders in the bottom sheet", mobileWb.modeToggle);
  check("mobile: weighbridge bars stay proportional", mobileWb.barsInRange);
  check("mobile: weighbridge drawer causes no horizontal overflow",
    mobileWb.scrollW <= mobileWb.vw, `${mobileWb.scrollW}/${mobileWb.vw}`);
  await mobile.screenshot({ path: path.join(OUT_DIR, "mobile-390-wkts-weighbridge.png") });

  await mobile.close();
}

// =====================================================================
// 11. No runtime errors
// =====================================================================
const realErrors = errors.filter(
  (e) => !/favicon|Download the React DevTools|WebGL|SwiftShader|GPU stall/i.test(e)
);
check("no uncaught runtime errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await browser.close();

// --- report ---
const failed = results.filter((r) => !r.ok);
console.log(`\n=== Browser verification: ${results.length - failed.length}/${results.length} passed ===`);
for (const r of failed) console.log(`FAIL  ${r.name} ${r.detail}`);
for (const e of realErrors.slice(0, 8)) console.log(`ERR   ${e}`);
process.exit(failed.length === 0 ? 0 : 1);
