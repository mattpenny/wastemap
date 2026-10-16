import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForTimeout(7000);
await page.locator("aside[data-testid='ranking-sheet'] button").first().click();
await page.waitForTimeout(800);

const clip = { x: 40, y: 200, width: 700, height: 400 };
const capture = async (tag, clicker) => {
  await clicker.hover();
  await page.screenshot({ path: `out/verify/f2-${tag}-0.png`, clip });
  await clicker.click();
  const out = [];
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(140);
    await page.screenshot({ path: `out/verify/f2-${tag}-${i}.png`, clip });
    out.push(i);
  }
  await page.waitForTimeout(2500);
  console.log(`${tag}: captured frames ${out.join(",")}`);
};

const rows = page.locator("aside[data-testid='ranking-sheet'] li button");
// (a) the drawer is closed — this click opens it AND flies the camera.
await capture("first", rows.nth(1));
// (b) the drawer is already open — camera only.
await page.locator('button[aria-label="Close" i]').first().click().catch(() => {});
await page.waitForTimeout(900);
await capture("second", rows.nth(4));
await browser.close();
console.log("done");
