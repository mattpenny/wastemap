import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForTimeout(8000);
const canvases = await page.evaluate(() =>
  [...document.querySelectorAll("canvas")].map((c, i) => ({
    i, cls: c.className, w: c.width, h: c.height,
    z: getComputedStyle(c).zIndex,
  }))
);
console.log("canvases:", JSON.stringify(canvases, null, 1));
// Hide everything except the first canvas (MapLibre's raster basemap).
await page.evaluate(() => {
  document.querySelectorAll("canvas").forEach((c, i) => {
    if (i > 0) c.style.visibility = "hidden";
  });
});
await page.waitForTimeout(1500);
await page.screenshot({ path: "out/verify/shadow-basemap-only.png" });
await browser.close();
console.log("done");
