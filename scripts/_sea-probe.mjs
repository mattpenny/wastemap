/**
 * Probe the rendered sea at the zoom a user reaches after a few wheel notches:
 * read the mask's paint back, ask the map whether the mask geometry is under
 * the sample points, and sample the rendered pixel colour of the water.
 */
import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "https://hkwastemap.vercel.app";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(10000);

// Open water well away from the wheel centre: east of HK Island, and the
// channel north of Lamma.
const SEA = [[114.22, 22.20], [114.30, 22.28], [114.13, 22.35]];

const meas = await browser.newPage();
await meas.goto("about:blank");
async function sample(buf) {
  const b64 = buf.toString("base64");
  return meas.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const hex = (v) => Math.round(v).toString(16).padStart(2, "0");
    const out = [];
    for (const [x, y] of [[200, 700], [1150, 620], [700, 300]]) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      out.push(`#${hex(d[0])}${hex(d[1])}${hex(d[2])}`);
    }
    return out;
  }, b64);
}

for (const z of [10.36, 10.55, 10.72, 10.9, 11.08, 11.6, 12.5]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.1694, 22.3193], zoom: z, pitch: 50, bearing: -18 });
  }, z);
  await page.waitForTimeout(3000);
  const info = await page.evaluate((sea) => {
    const m = window.__wmMap;
    const op = m.getPaintProperty("sea-mask", "fill-opacity");
    const hits = sea.map((p) => {
      const f = m.queryRenderedFeatures(m.project(p), { layers: ["sea-mask"] });
      return f.length;
    });
    return { opacity: JSON.stringify(op), hits };
  }, SEA);
  const px = await sample(await page.screenshot());
  console.log(`z${String(z).padEnd(5)} opacity=${info.opacity.padEnd(58)} maskPolygons=${info.hits.join(",")}  sea px: ${px.join(" ")}`);
}
await browser.close();
