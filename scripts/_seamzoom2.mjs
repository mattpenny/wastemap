/**
 * Same window size and camera as the user's screenshot, stepped finely, so the
 * zoom where the sea breaks up can be pinned down exactly.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/seamzoom";
fs.mkdirSync(OUT, { recursive: true });
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1080, height: 540 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(9000);
for (const z of [10.6, 10.9, 11.1, 11.3, 11.5, 11.7]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.12, 22.33], zoom: z, pitch: 55, bearing: -12 });
  }, z);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${OUT}/w${String(z).replace(".", "_")}.png` });
  console.log(`  wrote w${z}`);
}
await browser.close();
