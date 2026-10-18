/**
 * One-off: identify the layer behind the rectangular light patch seen at
 * z12.5 south of Lamma (out/seasweep/final-2-lamma-z12_5.png).
 *
 * Three candidates, isolated by toggling:
 *   A. a genuinely lighter neighbouring Esri z13 tile (mosaic mismatch)
 *   B. the z9 `satellite-low` underlay showing through a gap
 *   C. still-loading tiles (so a longer wait should make it vanish)
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/seasweep";
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const tileLog = [];
page.on("requestfinished", async (r) => {
  const m = r.url().match(/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/);
  if (m) tileLog.push(`z${m[1]}/${m[2]}/${m[3]}`);
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 90000 });
await page.waitForTimeout(9000);

await page.evaluate(() => {
  window.__wmMap.jumpTo({ center: [114.13, 22.16], zoom: 12.5, pitch: 0, bearing: 0 });
});

const meas = await browser.newPage();
await meas.goto("about:blank");
async function patch(buf, x, y, w, h) {
  const b64 = buf.toString("base64");
  return meas.evaluate(
    async ({ b64, x, y, w, h }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x, y, w, h).data;
      let l = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
      return +(l / n).toFixed(1);
    },
    { b64, x, y, w, h }
  );
}

const steps = [
  { id: "a-wait12s", wait: 12000, hide: [] },
  { id: "b-notint", wait: 3000, hide: ["sea-tint"] },
  { id: "c-nolow-notint", wait: 3000, hide: ["sea-tint", "satellite-low"] },
  { id: "d-nowide-notint", wait: 3000, hide: ["sea-tint", "satellite-wide"] },
];

for (const s of steps) {
  await page.evaluate((hide) => {
    const m = window.__wmMap;
    for (const id of ["sea-tint", "satellite-low", "satellite-wide", "satellite"]) {
      m.setLayoutProperty(id, "visibility", hide.includes(id) ? "none" : "visible");
    }
  }, s.hide);
  await page.waitForTimeout(s.wait);
  const buf = await page.screenshot();
  fs.writeFileSync(`${OUT}/seam-${s.id}.png`, buf);
  // Patch A = inside the light rectangle (upper-left), B = darker area below it.
  const a = await patch(buf, 360, 40, 160, 90);
  const b = await patch(buf, 360, 400, 160, 90);
  console.log(`${s.id.padEnd(14)} lightPatch=${String(a).padStart(5)}  darkPatch=${String(b).padStart(5)}  delta=${(a - b).toFixed(1)}`);
}

console.log("\ntiles fetched for this view:", [...new Set(tileLog)].slice(-14).join(" "));
await browser.close();
