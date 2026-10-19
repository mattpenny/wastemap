/**
 * The Esri mosaic breaks up between z10.6 and z10.9: run scripts/_seamzoom2.mjs
 * with the mask ramp still at 11.2 -> 12.2 and z10.9 comes back covered in
 * pale rectangles over water, while z10.6 is clean.
 *
 * This previews a ramp that starts at the landing zoom, so the flat fill is
 * fully opaque before the first broken level, and sweeps the window to check
 * both ends: the landing (z10.6) must be untouched natural water, and every
 * level above must be flat.
 *
 * RAMP="10.6:10.9" node scripts/_sea-early.mjs
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/seaearly";
fs.mkdirSync(OUT, { recursive: true });
const [from, to] = (process.env.RAMP ?? "10.6:10.9").split(":").map(Number);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1080, height: 540 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(9000);
// Preview the candidate ramp at runtime, before editing the style.
await page.evaluate((r) => {
  window.__wmMap.setPaintProperty("sea-mask", "fill-opacity", [
    "interpolate", ["linear"], ["zoom"], r.from, 0, r.to, 1,
  ]);
}, { from, to });
for (const z of [10.6, 10.7, 10.8, 10.9, 11.1, 11.5, 12.2]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.12, 22.33], zoom: z, pitch: 55, bearing: -12 });
  }, z);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${OUT}/${from}_${to}_z${String(z).replace(".", "_")}.png` });
  console.log(`  wrote z${z}`);
}
await browser.close();
