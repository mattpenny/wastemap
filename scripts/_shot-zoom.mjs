import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();
for (const [w, h] of [[1080, 537], [1440, 900], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText), { timeout: 60000 });
  await page.waitForTimeout(5000); // let the framing fitBounds settle
  await page.screenshot({ path: `out/verify/zoom-${w}x${h}.png` });
  await page.close();
}
await browser.close();
