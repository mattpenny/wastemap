/**
 * Screenshots the phone layout: the opening view, the two header disclosures
 * (facility figures, display toolbar), the bottom dock collapsed, then each of
 * the three sheets open, at three common phone widths.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./_playwright.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "out", "shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();

const VIEWPORTS = [
  { name: "se-375", width: 375, height: 667 },
  { name: "iphone-390", width: 390, height: 844 },
  { name: "pixel-412", width: 412, height: 915 },
];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  // "Facilities" is no longer rendered on a phone — the header figures are
  // collapsed by default now — so wait on the title and the map's loading
  // overlay instead of on the stats.
  await page.waitForFunction(() => /waste management/i.test(document.body.innerText), { timeout: 60000 });
  await page.waitForFunction(() => !/Loading facility data/.test(document.body.innerText), { timeout: 30000 });
  await page.waitForTimeout(5000);

  const shot = (label) =>
    page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${label}.png`) });

  await shot("dock-collapsed");

  // Header disclosures: the figures, then the display toolbar. Both start
  // closed, so the opening view is the title alone.
  const headerToggle = page.locator('[data-testid="header-detail-toggle"]');
  const displayToggle = page.locator('[data-testid="display-toggle"]');

  await headerToggle.click();
  await page.waitForTimeout(500);
  await shot("header-detail-open");
  await headerToggle.click();
  await page.waitForTimeout(400);

  await displayToggle.click();
  await page.waitForTimeout(500);
  await shot("display-open");
  await displayToggle.click();
  await page.waitForTimeout(400);

  for (const [tab, label] of [
    [/ranking/i, "sheet-ranking"],
    [/legend/i, "sheet-legend"],
    [/trend/i, "sheet-trend"],
  ]) {
    const btn = page.locator("button", { hasText: tab }).last();
    await btn.click();
    await page.waitForTimeout(1200);
    await shot(label);
    // Collapse again before the next tab.
    await page.locator("button", { hasText: tab }).last().click();
    await page.waitForTimeout(600);
  }

  // Geometry report: how much of the screen is left for the map.
  const report = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    const header = document.querySelector("header");
    const dock = [...document.querySelectorAll("div")].find((d) =>
      d.className.includes?.("lg:contents")
    );
    return {
      vh: innerHeight,
      vw: innerWidth,
      header: box(header),
      dock: box(dock),
      scrollW: document.documentElement.scrollWidth,
      // Are the two header disclosures still shut, and is the toolbar that
      // lives beside the header on desktop hidden down here?
      detailOpen: document.querySelector('[data-testid="header-detail-toggle"]')
        ?.getAttribute("aria-expanded"),
      controlsOpen: document.querySelector('[data-testid="display-toggle"]')
        ?.getAttribute("aria-expanded"),
      figuresShown: Boolean(
        [...document.querySelectorAll("header span")].find(
          (s) =>
            /^(facilities|設施)$/i.test(s.textContent.trim()) &&
            s.getBoundingClientRect().height > 0
        )
      ),
      desktopToolbarShown:
        (document.querySelector('[data-testid="display-toolbar"]')?.getBoundingClientRect()
          .height ?? 0) > 0,
    };
  });

  const headerBottom = report.header?.bottom ?? 0;
  const dockTop = report.dock?.top ?? report.vh;
  console.log(
    `${vp.name}: header→${headerBottom}px  dock@${dockTop}px  map≈${dockTop - headerBottom}px  ` +
      `of ${report.vh}px (${Math.round(((dockTop - headerBottom) / report.vh) * 100)}%)  ` +
      `scrollW=${report.scrollW}/${report.vw}  detail=${report.detailOpen} controls=${report.controlsOpen} ` +
      `figuresOnLoad=${report.figuresShown} desktopToolbar=${report.desktopToolbarShown}`
  );

  await page.close();
}

await browser.close();
