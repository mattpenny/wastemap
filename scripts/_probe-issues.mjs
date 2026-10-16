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
await page.screenshot({ path: "out/verify/issue-opening.png" });

// Select a facility from the list, then look at it closely.
await page.locator("aside[data-testid='ranking-sheet'] button").first().click();
await page.waitForTimeout(400);
await page.locator("aside[data-testid='ranking-sheet'] li button", { hasText: "West Kowloon Transfer Station" }).first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: "out/verify/issue-selected.png" });
await page.locator('button[aria-label="Close" i]').first().click().catch(() => {});
await page.waitForTimeout(800);

// Zoom in hard on the harbour to see how the pillars scale.
await page.mouse.move(720, 450);
for (let i = 0; i < 7; i++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(4000);
await page.screenshot({ path: "out/verify/issue-zoomed.png" });
await browser.close();
console.log("done");
