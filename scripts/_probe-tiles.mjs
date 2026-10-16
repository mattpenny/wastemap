/**
 * Which imagery tiles does the opening view pull, and how heavy are they?
 */
import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const zooms = new Map();
let bytes = 0;
let count = 0;
page.on("response", async (r) => {
  const m = /World_Imagery\/MapServer\/tile\/(\d+)\//.exec(r.url());
  if (!m) return;
  zooms.set(m[1], (zooms.get(m[1]) ?? 0) + 1);
  count += 1;
  try {
    const body = await r.body();
    bytes += body.length;
  } catch {
    /* body unavailable */
  }
});
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForTimeout(9000);
console.log(
  `zooms=${JSON.stringify([...zooms.entries()].sort())} tiles=${count} ` +
    `bytes=${(bytes / 1024 / 1024).toFixed(2)} MB avg=${count ? Math.round(bytes / count / 1024) : 0} KB`
);
await browser.close();
