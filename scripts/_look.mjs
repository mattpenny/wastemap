/**
 * Appearance pass on the 3D satellite view.
 *
 * The problem measured earlier: everything sits in a 60-130 luma band and the
 * sea mask (#4e6966, luma 99) is the same value as the land, so there is no
 * figure/ground separation. This previews three candidate grades at runtime
 * (no rebuild) so they can be judged before anything is committed.
 *
 *   A  baseline
 *   B  deeper sea + lighter labels
 *   C  B + land contrast/saturation
 *   D  C with the Esri label plates hidden
 */
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
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(430, 180, 620, 520).data;
    const hist = new Array(256).fill(0);
    let n = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      hist[L]++;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]);
      const mn = Math.min(d[i], d[i + 1], d[i + 2]);
      sat += mx === 0 ? 0 : (mx - mn) / mx;
      n++;
    }
    const pct = (q) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v; }
      return 255;
    };
    return {
      p10: pct(0.1), p50: pct(0.5), p90: pct(0.9),
      sat: +((sat / n) * 100).toFixed(1),
    };
  }, b64);
}

async function shot(label) {
  const s = await stats(await page.screenshot());
  await page.screenshot({ path: `${OUT}/${label}.png` });
  console.log(`  ${label.padEnd(16)} p10 ${String(s.p10).padStart(3)}  p50 ${String(s.p50).padStart(3)}  p90 ${String(s.p90).padStart(3)}   sat ${String(s.sat).padStart(4)}%`);
}

/** Apply a variant's paint overrides. */
const apply = (v) =>
  page.evaluate((v) => {
    const m = window.__wmMap;
    if (v.sea) {
      m.setPaintProperty("sea-mask", "fill-color", v.sea);
      m.setPaintProperty("background", "background-color", v.sea);
    }
    if (v.labels !== undefined) m.setPaintProperty("places", "raster-opacity", v.labels);
    if (v.contrast !== undefined) {
      m.setPaintProperty("satellite-wide", "raster-contrast", v.contrast);
      m.setPaintProperty("satellite-wide", "raster-saturation", v.sat);
      m.setPaintProperty("satellite-wide", "raster-brightness-min", v.min);
    }
    m.setLayoutProperty("places", "visibility", v.hideLabels ? "none" : "visible");
  }, v);

console.log("\n=== appearance preview ===");
await shot("A-baseline");

await apply({ sea: "#33535a", labels: 0.55 });
await page.waitForTimeout(1200);
await shot("B-deep-sea");

await apply({ contrast: 0.1, sat: 0.3, min: 0.12 });
await page.waitForTimeout(1200);
await shot("C-land-grade");

await apply({ hideLabels: true });
await page.waitForTimeout(1200);
await shot("D-no-labels");

await browser.close();
