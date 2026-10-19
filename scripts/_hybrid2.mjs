/**
 * Two ways to get the natural sea at the overview:
 *   A  current wide tiles (tileSize 256 -> z10 tiles), mask off
 *   B  the supersampled source at the overview too (tileSize 128 -> z11/z12),
 *      which is what the user's screenshot was rendered from
 * Same camera, so the only difference is the tile level.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/hybrid";
fs.mkdirSync(OUT, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(9000);

// mask off at the overview for both
await page.evaluate(() => {
  window.__wmMap.setPaintProperty("sea-mask", "fill-opacity", [
    "interpolate", ["linear"], ["zoom"], 11.6, 0, 12.2, 1,
  ]);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/A-wide256.png` });
console.log("  A wrote A-wide256.png");

// B: show the supersampled source at the overview instead
await page.evaluate(() => {
  const m = window.__wmMap;
  m.setLayerZoomRange("satellite", 0, 24);
  m.setPaintProperty("satellite", "raster-opacity", 1);
  m.setPaintProperty("satellite-wide", "raster-opacity", 0);
});
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/B-super128.png` });
console.log("  B wrote B-super128.png");
await browser.close();
