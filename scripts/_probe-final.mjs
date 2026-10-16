import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let tiles = 0, bytes = 0;
page.on("response", async (r) => {
  if (!/imagery\/WGS84|World_Imagery\/MapServer\/tile/.test(r.url())) return;
  tiles += 1;
  try { bytes += (await r.body()).length; } catch {}
});
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForTimeout(9000);
console.log(`opening view: ${tiles} imagery tiles, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
await page.screenshot({ path: "out/verify/final-opening.png" });

await page.locator("aside[data-testid='ranking-sheet'] button").first().click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^All$/ }).click(); await page.waitForTimeout(800);
const row = page.locator("aside[data-testid='ranking-sheet'] li button", { hasText: "WENT" }).first();
await row.hover();
await page.waitForTimeout(1800);
await page.screenshot({ path: "out/verify/final-hover-landfill.png" });
await row.click();
await page.waitForTimeout(3000);
await page.screenshot({ path: "out/verify/final-selected-landfill.png" });
await page.locator('button[aria-label="Close" i]').first().click().catch(() => {});
await page.waitForTimeout(600);

// Phone: the dock.
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(BASE, { waitUntil: "domcontentloaded" });
await mobile.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await mobile.waitForTimeout(7000);
await mobile.screenshot({ path: "out/verify/final-mobile.png" });
await browser.close();
console.log("done");
