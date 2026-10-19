/**
 * Screenshots of the DEPLOYED site at the user's camera (the centre, pitch and
 * bearing of the screenshot that reported the broken sea), at the landing zoom
 * and at the first level above it. Run after a push to prove the gated mask is
 * live: z10.6 must still be natural water, z10.9 must be flat with no
 * rectangles.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "https://hkwastemap.vercel.app";
const OUT = process.env.OUT ?? "out/liveharbour";
fs.mkdirSync(OUT, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1080, height: 540 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(10000);
console.log("live ramp:", await page.evaluate(() =>
  JSON.stringify(window.__wmMap.getPaintProperty("sea-mask", "fill-opacity"))));
for (const z of [10.6, 10.75, 10.9]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.12, 22.33], zoom: z, pitch: 55, bearing: -12 });
  }, z);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/z${String(z).replace(".", "_")}.png` });
  console.log(`  wrote z${z}`);
}
await browser.close();
