/**
 * Does the hybrid mask hold a steady sea tone as you zoom, or does it dip?
 *
 * The natural Esri water darkens from luma ~110 at z11 to ~35 at z12 (the tier
 * step). The mask fades in over that same window, so the question is whether
 * the two cancel out. Sweeps three configurations across the crossover.
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
const meas = await browser.newPage();
await meas.goto("about:blank");
const luma = async (buf) => {
  const b64 = buf.toString("base64");
  return meas.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(430, 380, 420, 220).data;
    let l = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return +(l / n).toFixed(1);
  }, b64);
};
const configs = {
  "always (current)": 1,
  "never": 0,
  "hybrid 11.2-12.2": ["interpolate", ["linear"], ["zoom"], 11.2, 0, 12.2, 1],
  "hybrid 10.8-12.4": ["interpolate", ["linear"], ["zoom"], 10.8, 0, 12.4, 1],
};
const zooms = [10.6, 11, 11.5, 12, 12.5, 13, 14, 15];
console.log("\n  zoom   " + Object.keys(configs).map((k) => k.padStart(17)).join(""));
for (const z of zooms) {
  const row = [];
  for (const [, op] of Object.entries(configs)) {
    await page.evaluate(([z, op]) => {
      const m = window.__wmMap;
      m.setPaintProperty("sea-mask", "fill-opacity", op);
      m.jumpTo({ center: [114.25, 22.06], zoom: z, pitch: 0, bearing: 0 });
    }, [z, op]);
    await page.waitForTimeout(3200);
    row.push(String(await luma(await page.screenshot())).padStart(17));
  }
  console.log(`  ${String(z).padStart(5)}  ${row.join("")}`);
}
await browser.close();
