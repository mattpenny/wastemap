/**
 * The water tone changes as the imagery tile level flips (Esri z10 tiles are
 * bright and uniform; z11 tiles are darker and seam). Capture the same camera
 * in fine steps with a long settle so the flip point is visible, and measure
 * the water luma at each step.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const OUT = "out/watershift";
fs.mkdirSync(OUT, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto("https://hkwastemap.vercel.app", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(9000);
for (const z of [10.3, 10.45, 10.6, 10.75, 10.9]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.1694, 22.3193], zoom: z, pitch: 50, bearing: -18 });
  }, z);
  await page.waitForTimeout(6500);
  await page.screenshot({ path: `${OUT}/z${String(z).replace(".", "_")}.png` });
  console.log(`  wrote z${z}`);
}
await browser.close();
