/**
 * One-off: at the harbour z11 view, are the light rectangular blocks caused by
 * the `satellite-low` underlay bleeding through not-yet-loaded z11 tiles?
 *
 * `satellite-low` is a z9 underlay with a 0.28 black-point lift, so it renders
 * far brighter than the main imagery. If a main tile is missing for even a
 * frame, that brighter underlay shows as a pale block.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/seasweep";
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 90000 });
await page.waitForTimeout(9000);

await page.evaluate(() => {
  window.__wmMap.jumpTo({ center: [114.163, 22.293], zoom: 11, pitch: 0, bearing: 0 });
});
await page.waitForTimeout(12000);

// Report how many tiles each raster layer is actually holding, and whether any
// are still loading — a gap only matters while a tile is in flight.
const state = await page.evaluate(() => {
  const m = window.__wmMap;
  const tms = m.style.tileManagers ?? {};
  const out = {};
  for (const id of Object.keys(tms)) {
    const tm = tms[id];
    const tiles = tm._tiles ?? {};
    const keys = Object.keys(tiles);
    let loading = 0;
    for (const k of keys) if (tiles[k]?.state !== "loaded") loading++;
    out[id] = { total: keys.length, notLoaded: loading };
  }
  return out;
});
console.log("tile state at z11:", JSON.stringify(state));

const variants = [
  { id: "all", hide: [] },
  { id: "no-low", hide: ["satellite-low"] },
  { id: "low-only", hide: ["satellite-wide", "sea-tint"] },
];
for (const v of variants) {
  await page.evaluate((hide) => {
    const m = window.__wmMap;
    for (const id of ["sea-tint", "satellite-low", "satellite-wide", "satellite", "places"]) {
      m.setLayoutProperty(id, "visibility", hide.includes(id) ? "none" : "visible");
    }
  }, v.hide);
  await page.waitForTimeout(2500);
  const buf = await page.screenshot();
  fs.writeFileSync(`${OUT}/low-${v.id}.png`, buf);
  console.log(`wrote ${OUT}/low-${v.id}.png`);
}
await browser.close();
