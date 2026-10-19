/** Final candidates: keep the land bright while adding punch. */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/look";
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
async function stats(buf) {
  const b64 = buf.toString("base64");
  return meas.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(430, 180, 620, 520).data;
    const hist = new Array(256).fill(0); let n = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      hist[L]++;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      sat += mx === 0 ? 0 : (mx - mn) / mx; n++;
    }
    const pct = (q) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= n * q) return v; } return 255; };
    return { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), sat: +((sat / n) * 100).toFixed(1) };
  }, b64);
}
const variants = {
  "E-bright-punch": { sea: "#35565c", contrast: 0.08, sat: 0.25, min: 0.26, labels: 0.72 },
  "F-richer": { sea: "#35565c", contrast: 0.1, sat: 0.32, min: 0.22, labels: 0.72 },
};
for (const [label, v] of Object.entries(variants)) {
  await page.evaluate((v) => {
    const m = window.__wmMap;
    m.setPaintProperty("sea-mask", "fill-color", v.sea);
    m.setPaintProperty("background", "background-color", v.sea);
    m.setPaintProperty("places", "raster-opacity", v.labels);
    for (const id of ["satellite-wide", "satellite"]) {
      m.setPaintProperty(id, "raster-contrast", v.contrast);
      m.setPaintProperty(id, "raster-saturation", v.sat);
      m.setPaintProperty(id, "raster-brightness-min", v.min);
    }
  }, v);
  await page.waitForTimeout(1400);
  const s = await stats(await page.screenshot());
  await page.screenshot({ path: `${OUT}/${label}.png` });
  console.log(`  ${label.padEnd(16)} p10 ${String(s.p10).padStart(3)}  p50 ${String(s.p50).padStart(3)}  p90 ${String(s.p90).padStart(3)}   sat ${String(s.sat).padStart(4)}%`);
}
await browser.close();
