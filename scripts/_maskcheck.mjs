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
  const zs = [9.8, 10.0, 10.2, 10.36, 10.5, 10.54, 10.6, 10.65, 10.7, 10.72, 10.9, 11.08];
  const out = {};
  for (const z of zs) {
    if (Array.isArray(expr) && expr[0] === "interpolate") {
      // stops live at expr[3..] as alternating z,v pairs
      const stops = [];
      for (let i = 3; i + 1 < expr.length; i += 2) stops.push([expr[i], expr[i + 1]]);
      if (z <= stops[0][0]) { out[z] = +stops[0][1].toFixed(2); continue; }
      if (z >= stops[stops.length - 1][0]) { out[z] = +stops[stops.length - 1][1].toFixed(2); continue; }
      for (let i = 0; i < stops.length - 1; i++) {
        const [z0, v0] = stops[i], [z1, v1] = stops[i + 1];
        if (z >= z0 && z <= z1) {
          const t = (z - z0) / (z1 - z0);
          out[z] = +(v0 + (v1 - v0) * t).toFixed(2);
          break;
        }
      }
    } else {
      out[z] = "non-interp:" + JSON.stringify(expr).slice(0, 40);
    }
  }
  return { raw: JSON.stringify(expr), opacityAt: out };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
