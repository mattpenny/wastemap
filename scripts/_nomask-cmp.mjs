/**
 * Capture the same camera with the sea-mask forced OFF, so the raw Esri water
 * can be compared with the user's screenshot. If the raw water matches far
 * better than any masked capture, the mask's vector source is not loading in
 * their browser and a ramp change will not help.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const OUT = "out/nomask";
fs.mkdirSync(OUT, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", (r) => errors.push(`FAILED ${r.url()}`));
await page.goto("https://hkwastemap.vercel.app", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(9000);
await page.evaluate(() => window.__wmMap.setPaintProperty("sea-mask", "fill-opacity", 0));
for (const z of [10.6, 10.8, 11.0, 11.5, 12.0]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.1694, 22.3193], zoom: z, pitch: 50, bearing: -18 });
  }, z);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/z${String(z).replace(".", "_")}.png` });
  console.log(`  wrote z${z} (mask off)`);
}
console.log("console/network errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
