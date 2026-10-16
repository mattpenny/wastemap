/**
 * Screenshots the phone layout: the bottom dock collapsed, then each of the
 * three sheets open, at three common phone widths.
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
  await page.waitForFunction(() => /facilities/i.test(document.body.innerText), { timeout: 60000 });
  await page.waitForTimeout(5000);

  const shot = (label) =>
    page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${label}.png`) });

  await shot("dock-collapsed");

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
      header: box(header),
      dock: box(dock),
      scrollW: document.documentElement.scrollWidth,
    };
  });

  const headerBottom = report.header?.bottom ?? 0;
  const dockTop = report.dock?.top ?? report.vh;
  console.log(
    `${vp.name}: header→${headerBottom}px  dock@${dockTop}px  map≈${dockTop - headerBottom}px  ` +
      `of ${report.vh}px (${Math.round(((dockTop - headerBottom) / report.vh) * 100)}%)  scrollW=${report.scrollW}`
  );

  await page.close();
}

await browser.close();
