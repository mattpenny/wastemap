/**
 * Capture the default landing camera and small zoom steps at the user's window
 * size, so the level in their screenshot can be identified. Also reports the
 * camera as loaded (the GeolocateControl may move it).
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "https://hkwastemap.vercel.app";
const OUT = process.env.OUT ?? "out/steps";
fs.mkdirSync(OUT, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1913, height: 880 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });

async function cam() {
  return page.evaluate(() => {
    const m = window.__wmMap;
    const c = m.getCenter();
    return `z${m.getZoom().toFixed(3)} c=${c.lng.toFixed(4)},${c.lat.toFixed(4)} p${m.getPitch().toFixed(0)} b${m.getBearing().toFixed(0)}`;
  });
}
for (const t of [2000, 4000, 8000]) {
  await page.waitForTimeout(t === 2000 ? 2000 : 2000);
  console.log(`t~${t}ms  ${await cam()}`);
}
await page.screenshot({ path: `${OUT}/landing.png` });
console.log("landing  ", await cam());

// Snap to the canonical landing camera, then step up in fine increments the
// way a trackpad or a high-resolution wheel would.
for (const z of [10.6, 10.7, 10.8, 10.9, 11.0, 11.2]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.1694, 22.3193], zoom: z, pitch: 50, bearing: -18 });
  }, z);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/z${String(z).replace(".", "_")}.png` });
  console.log(`z${z} captured`);
}
await browser.close();
