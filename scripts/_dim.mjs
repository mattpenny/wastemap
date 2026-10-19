/**
 * Why is the map dim? Measure it, then preview the cheap fixes.
 *
 * Reports mean luma of the map area for:
 *   1. satellite as shipped
 *   2. the same with a lighter sea fill (paint overridden at runtime, no rebuild)
 *   3. the Lands Department official basemap
 *
 * Writes out/dim/*.png so the numbers can be checked against the pictures.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/dim";
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(9000);

const meas = await browser.newPage();
await meas.goto("about:blank");
async function luma(buf) {
  const b64 = buf.toString("base64");
  return meas.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // Central strip, away from the ranking card and the drawer.
    const d = ctx.getImageData(430, 180, 620, 520).data;
    let l = 0, n = 0, dark = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      l += L;
      if (L < 40) dark++;
      if (L > 150) light++;
      n++;
    }
    return {
      luma: +(l / n).toFixed(1),
      darkPct: +((dark / n) * 100).toFixed(1),
      lightPct: +((light / n) * 100).toFixed(1),
    };
  }, b64);
}

async function shot(label) {
  const r = await luma(await page.screenshot());
  await page.screenshot({ path: `${OUT}/${label}.png` });
  console.log(`  ${label.padEnd(22)} luma ${String(r.luma).padStart(5)}   dark ${String(r.darkPct).padStart(5)}%   light ${String(r.lightPct).padStart(5)}%`);
  return r;
}

console.log("\n=== map brightness ===");
await shot("1-satellite-shipped");

// Lighter sea, same geometry — proves how much of the dimness is the mask.
for (const [label, color] of [
  ["2-sea-6f8b87", "#6f8b87"],
  ["3-sea-8fa9a5", "#8fa9a5"],
]) {
  await page.evaluate((c) => {
    window.__wmMap.setPaintProperty("sea-mask", "fill-color", c);
    window.__wmMap.setPaintProperty("background", "background-color", c);
  }, color);
  await page.waitForTimeout(1200);
  await shot(label);
}

// Restore, then the official basemap.
await page.evaluate(() => {
  window.__wmMap.setPaintProperty("sea-mask", "fill-color", "#4e6966");
  window.__wmMap.setPaintProperty("background", "background-color", "#4e6966");
});
await page.waitForTimeout(800);

await page.locator("button", { hasText: /^Official$/ }).first().click();
await page.waitForTimeout(6000);
await shot("4-official");

await browser.close();
