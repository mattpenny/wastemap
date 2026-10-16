import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
// Let every tile settle, then look again.
await page.waitForTimeout(25000);
await page.screenshot({ path: "out/verify/sea-settled.png" });
await browser.close();
console.log("done");
