/**
 * With the mask off at the overview, how much black-point lift does the sea
 * want? The lift was added to stop the (masked) sea reading as shadow; on
 * natural water it may just be flattening it.
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
const sample = async (buf) => {
  const b64 = buf.toString("base64");
  return meas.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(250, 560, 420, 220).data;
    let r = 0, g = 0, b = 0, n = 0, l = 0, sd = 0;
    const Ls = [];
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      l += L; Ls.push(L); n++;
    }
    const mean = l / n;
    for (const L of Ls) sd += (L - mean) ** 2;
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
    return { hex: `#${hex(r)}${hex(g)}${hex(b)}`, luma: +mean.toFixed(1), sd: +Math.sqrt(sd / n).toFixed(1) };
  }, b64);
};
await page.evaluate(() => {
  window.__wmMap.setPaintProperty("sea-mask", "fill-opacity", [
    "interpolate", ["linear"], ["zoom"], 11.6, 0, 12.2, 1,
  ]);
});
for (const [label, min] of [["C-min0", 0], ["D-min012", 0.12], ["E-min026", 0.26]]) {
  await page.evaluate((min) => {
    window.__wmMap.setPaintProperty("satellite-wide", "raster-brightness-min", min);
  }, min);
  await page.waitForTimeout(1500);
  const s = await sample(await page.screenshot());
  await page.screenshot({ path: `${OUT}/${label}.png` });
  console.log(`  ${label.padEnd(10)} sea ${s.hex}  luma ${String(s.luma).padStart(5)}  detail(sd) ${s.sd}`);
}
await browser.close();
