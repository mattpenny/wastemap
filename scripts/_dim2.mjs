/**
 * Can the satellite view itself be made brighter, without switching basemap?
 *
 * MapLibre's raster paint gives four levers: brightness-min (lifts blacks),
 * brightness-max (clamped at 1, so it cannot brighten), contrast and
 * saturation. This sweeps them on the live map so the trade-off is visible
 * before anything is committed.
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
  console.log(`  ${label.padEnd(28)} luma ${String(r.luma).padStart(5)}   dark ${String(r.darkPct).padStart(5)}%   light ${String(r.lightPct).padStart(5)}%`);
}

const variants = [
  ["A-base", { min: 0.2, contrast: -0.2, sat: 0, sea: "#4e6966" }],
  ["B-lift", { min: 0.34, contrast: -0.1, sat: 0, sea: "#4e6966" }],
  ["C-lift+sat", { min: 0.34, contrast: -0.1, sat: 0.35, sea: "#4e6966" }],
  ["D-lift+sat+sea", { min: 0.34, contrast: -0.1, sat: 0.35, sea: "#6f8b87" }],
];

console.log("\n=== satellite tone sweep ===");
for (const [label, v] of variants) {
  await page.evaluate((v) => {
    const m = window.__wmMap;
    m.setPaintProperty("satellite-wide", "raster-brightness-min", v.min);
    m.setPaintProperty("satellite-wide", "raster-contrast", v.contrast);
    m.setPaintProperty("satellite-wide", "raster-saturation", v.sat);
    m.setPaintProperty("sea-mask", "fill-color", v.sea);
    m.setPaintProperty("background", "background-color", v.sea);
  }, v);
  await page.waitForTimeout(1500);
  await shot(label);
}

await browser.close();
