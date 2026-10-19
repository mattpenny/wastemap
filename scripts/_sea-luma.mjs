/**
 * Sample the rendered sea luminance at known open-water coordinates across the
 * zoom range the user reaches by scrolling in from the landing view. Projects
 * real lng/lat sea points to screen pixels so we measure the actual painted
 * colour (natural Esri vs the flat sea-mask fill), not a guessed region.
 *
 * Emits out/seacheck/<zoom>.png screenshots and out/seacheck/coords.json
 * (per-zoom screen coords) for the Python luminance sampler.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/seacheck";
fs.mkdirSync(OUT, { recursive: true });

// Known open-water points around the landing camera centre (114.0923, 22.3763).
const SEA = [
  ["open-SE", 114.30, 22.10],
  ["harbour", 114.16, 22.29],
  ["S-of-HK", 114.20, 22.15],
  ["E-of-HK", 114.35, 22.30],
  ["S-basin", 114.00, 22.10],
];

const ZOOMS = [9.8, 10.0, 10.2, 10.36, 10.5, 10.6, 10.72, 10.9, 11.08];

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(8000);

const center = await page.evaluate(() => {
  const c = window.__wmMap.getCenter();
  return [c.lng, c.lat];
});

const coords = {};
for (const z of ZOOMS) {
  await page.evaluate(
    ([z, c]) => window.__wmMap.jumpTo({ zoom: z, center: c }),
    [z, center],
  );
  await page.waitForTimeout(2500);
  const pts = await page.evaluate((sea) => {
    return sea.map(([name, lng, lat]) => {
      const p = window.__wmMap.project([lng, lat]);
      return { name, x: Math.round(p.x), y: Math.round(p.y) };
    });
  }, SEA);
  coords[String(z)] = pts;
  await page.screenshot({ path: `${OUT}/z${z}.png` });
  console.log(`z${z}`, pts.map((p) => `${p.name}:${p.x},${p.y}`).join("  "));
}
fs.writeFileSync(`${OUT}/coords.json`, JSON.stringify({ center, ZOOMS, SEA, coords }, null, 2));
await browser.close();
console.log("done");
