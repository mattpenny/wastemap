import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const tag = process.env.TAG ?? "a";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForTimeout(9000);
// Dense urban area (Kowloon), 1:1 device pixels at DPR 2.
await page.screenshot({
  path: `out/verify/ab-${tag}.png`,
  clip: { x: 820, y: 430, width: 260, height: 170 },
});
await browser.close();
console.log(`wrote out/verify/ab-${tag}.png`);
