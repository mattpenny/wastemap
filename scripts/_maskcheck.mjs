import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const expr = window.__wmMap.getPaintProperty("sea-mask", "fill-opacity");
  // Evaluate the interpolate expression at a few zooms by temporarily setting
  // and reading is not trivial; instead reconstruct via the style spec helper.
  const zs = [10.36, 10.54, 10.6, 10.7, 10.72, 10.9, 11.08];
  const out = {};
  for (const z of zs) {
    if (Array.isArray(expr) && expr[0] === "interpolate") {
      const z0 = expr[3], v0 = expr[4], z1 = expr[5], v1 = expr[6];
      const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
      out[z] = +(v0 + (v1 - v0) * t).toFixed(2);
    } else {
      out[z] = "non-interp:" + JSON.stringify(expr).slice(0, 40);
    }
  }
  return { raw: JSON.stringify(expr), opacityAt: out };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
