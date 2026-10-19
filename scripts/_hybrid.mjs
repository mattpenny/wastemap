/**
 * Hybrid sea: natural imagery at the overview (the look in the user's
 * screenshot), flat mask only above z12 where Esri's deep water turns black.
 *
 * Previews it at runtime first — sets `sea-mask` fill-opacity to a zoom ramp,
 * screenshots the default view and two close views, and samples the natural
 * sea colour at the overview so `background` can be matched to it.
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
const sample = async (buf, rect) => {
  const b64 = buf.toString("base64");
  return meas.evaluate(async ([b64, rect]) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(rect[0], rect[1], rect[2], rect[3]).data;
    let r = 0, g = 0, b = 0, n = 0, l = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
    }
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
    return { hex: `#${hex(r)}${hex(g)}${hex(b)}`, luma: +(l / n).toFixed(1) };
  }, [b64, rect]);
};

// Natural sea: no mask at the overview, full mask by z12.2.
await page.evaluate(() => {
  window.__wmMap.setPaintProperty("sea-mask", "fill-opacity", [
    "interpolate", ["linear"], ["zoom"], 11.6, 0, 12.2, 1,
  ]);
});
await page.waitForTimeout(1500);

await page.screenshot({ path: `${OUT}/1-overview-natural.png` });
const sea = await sample(await page.screenshot(), [250, 560, 420, 220]);
console.log(`  overview open sea: ${sea.hex}  luma ${sea.luma}`);

for (const [z, label] of [[13, "2-z13"], [15, "3-z15"]]) {
  await page.evaluate((z) => {
    window.__wmMap.jumpTo({ center: [114.25, 22.06], zoom: z, pitch: 0, bearing: 0 });
  }, z);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/${label}.png` });
  const s = await sample(await page.screenshot(), [430, 380, 420, 220]);
  console.log(`  z${z} masked sea:   ${s.hex}  luma ${s.luma}`);
}

await browser.close();
