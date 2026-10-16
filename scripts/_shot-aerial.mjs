import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForTimeout(6000);
// Switch to the Aerial style and let its tiles land.
await page.getByRole("button", { name: /^Aerial$/ }).click();
await page.waitForTimeout(9000);
await page.screenshot({ path: "out/verify/aerial-style.png" });
await browser.close();
console.log("done");
