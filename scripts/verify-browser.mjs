/**
 * Browser smoke test for the Waste Map app — collapsed-by-default + RTS-default
 * revision. Boots the page in system Chrome, captures console/page errors, and
 * verifies:
 *   1. the opening state — all three cards collapsed, RTS filter pre-selected;
 *   2. the header stats, the ranking card, the facility drawer (headline figures
 *      only by default, full detail behind the Detail toggle);
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
    return { x: Math.round(b.left), y: Math.round(b.top) };
  };
  return {
    ranking: at('[data-testid="ranking-sheet"]'),
    legend: at('[data-testid="legend-sheet"]'),
    trend: at('[data-testid="trend-sheet"]'),
    info: at('[data-testid="map-info"]'),
    dockTabs: [...document.querySelectorAll("[data-dock-tab]")].filter(
      (el) => el.getBoundingClientRect().height > 0
    ).length,
  };
});
check("desktop: ranking card is top-right", layout.ranking.x > 1000 && layout.ranking.y < 120, JSON.stringify(layout.ranking));
check("desktop: legend card is bottom-left", layout.legend.x < 60 && layout.legend.y > 700, JSON.stringify(layout.legend));
check("desktop: trend card is bottom-right", layout.trend.x > 1000 && layout.trend.y > 700, JSON.stringify(layout.trend));
check("desktop: info button is bottom-left", layout.info.x === 12, JSON.stringify(layout.info));
check("desktop: phone dock is hidden", layout.dockTabs === 0, `visibleTabs=${layout.dockTabs}`);

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
check("drawer shows IETS throughput 1,225", drawerText.includes("1,225"));
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
await page.waitForTimeout(800);
drawerText = await drawer.innerText();
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
const wentText = await page.locator('aside[role="dialog"]').innerText();
check("WENT drawer shows 6,400 tpd", wentText.includes("6,400"));
check("WENT drawer shows 61 Mm3 void", /61/.test(wentText));
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
// 9. Mobile layout — bottom dock, one sheet at a time, one-line title
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
  await mobile.waitForFunction(() => /facilities/i.test(document.body.innerText), { timeout: 60000 });
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
    return {
      titleLines: h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(cs.lineHeight)) : null,
      titleText: h1?.innerText,
      header: rect(document.querySelector("header")),
      dock: rect(document.querySelector('[data-testid="bottom-dock"]')),
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
      vh: innerHeight,
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
  check("mobile: map keeps most of the viewport", mapShare >= 0.6, `${Math.round(mapShare * 100)}%`);

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

  await mobile.close();
}

// =====================================================================
// 10. No runtime errors
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
