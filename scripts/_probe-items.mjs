import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();

// Desktop: colours, abbreviations, hover reveal, pillar footprint.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await page.waitForTimeout(7000);
await page.locator("aside[data-testid='ranking-sheet'] button").first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: "out/verify/items-ranking.png" });

const row = page.locator("aside[data-testid='ranking-sheet'] li button").nth(1);
await row.hover();
await page.waitForTimeout(1500);
await page.screenshot({ path: "out/verify/items-hover.png" });
console.log("row text after hover:", (await row.innerText()).replace(/\n/g, " | "));

// Distinct colours per facility?
const dots = await page.evaluate(() =>
  [...document.querySelectorAll("aside[data-testid='ranking-sheet'] li button span[style*='background-color']")]
    .map((el) => getComputedStyle(el).backgroundColor)
);
console.log("dot colours:", JSON.stringify([...new Set(dots)]));

// Select a facility and confirm the pillar is replaced by the pin.
await row.click();
await page.waitForTimeout(3000);
await page.screenshot({ path: "out/verify/items-selected.png" });
await page.locator('button[aria-label="Close" i]').first().click().catch(() => {});
await page.waitForTimeout(800);

// Zoom in to check the pillar footprint.
await page.mouse.move(720, 450);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(220);
}
await page.waitForTimeout(3500);
await page.screenshot({ path: "out/verify/items-zoomed.png" });
await page.close();

// Phone: panels collapse when the map is moved.
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(BASE, { waitUntil: "domcontentloaded" });
await mobile.waitForFunction(
  () => /waste management/i.test(document.body.innerText) && !/Loading facility data/i.test(document.body.innerText),
  { timeout: 60000 }
);
await mobile.waitForTimeout(5000);
await mobile.locator('[data-dock-tab="list"]').click();
await mobile.waitForTimeout(900);
const sheetShown = () =>
  mobile.evaluate(() => {
    const el = document.querySelector('[data-testid="ranking-sheet"]');
    return el ? getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0 : false;
  });
console.log("mobile sheet open before drag:", await sheetShown());
// Drag the map.
await mobile.touchscreen.tap(200, 300);
const box = { x: 200, y: 260 };
await mobile.mouse.move(box.x, box.y);
await mobile.mouse.down();
await mobile.mouse.move(box.x - 60, box.y - 90, { steps: 12 });
await mobile.mouse.up();
await mobile.waitForTimeout(900);
console.log("mobile sheet open after drag:", await sheetShown());
await mobile.screenshot({ path: "out/verify/items-mobile-after-drag.png" });
await mobile.close();

await browser.close();
console.log("done");
