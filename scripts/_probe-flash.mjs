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
await page.locator("aside[data-testid='ranking-sheet'] button").first().click();
await page.waitForTimeout(600);
// Fire the switch and capture frames as it happens.
const shots = [];
const row = page.locator("aside[data-testid='ranking-sheet'] li button", { hasText: "IETS" }).first();
await row.hover();
for (let i = 0; i < 10; i++) {
  shots.push(`out/verify/flash-${i}.png`);
  await page.screenshot({ path: shots[i], clip: { x: 40, y: 200, width: 700, height: 400 } });
  if (i === 0) await row.click();
  else await page.waitForTimeout(140);
}
// Stitch them into one strip for side-by-side reading.
await browser.close();
console.log(shots.join("\n"));
