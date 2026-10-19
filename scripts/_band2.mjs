/** Is the top band the mask ramp, the imagery, or a missing tile? */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(9000);
await page.evaluate(() => {
  window.__wmMap.jumpTo({ center: [114.25, 22.06], zoom: 12.5, pitch: 0, bearing: 0 });
});
await page.waitForTimeout(5000);
const meas = await browser.newPage();
await meas.goto("about:blank");
const rows = async (buf) => {
  const b64 = buf.toString("base64");
  return meas.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return [40, 120, 300, 600].map((y) => {
      const d = ctx.getImageData(300, y, 400, 1).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
      return `y=${y} #${hex(r)}${hex(g)}${hex(b)}`;
    }).join("   ");
  }, b64);
};
console.log("  ramp (shipped)  ", await rows(await page.screenshot()));
await page.evaluate(() => window.__wmMap.setPaintProperty("sea-mask", "fill-opacity", 1));
await page.waitForTimeout(1500);
console.log("  opacity 1       ", await rows(await page.screenshot()));
await page.evaluate(() => window.__wmMap.setPaintProperty("sea-mask", "fill-opacity", 0));
await page.waitForTimeout(1500);
console.log("  opacity 0       ", await rows(await page.screenshot()));
await page.screenshot({ path: "out/hybrid/maskoff-z12_5.png" });
await browser.close();
