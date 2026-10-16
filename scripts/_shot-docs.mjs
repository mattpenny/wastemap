/**
 * Regenerates the two screenshots the README embeds:
 *   docs/screenshot-map.jpg     the opening view, every panel collapsed
 *   docs/screenshot-drawer.jpg  a facility drawer with the EPD record expanded
 */
import { launchChromium } from "./_playwright.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();

const shot = async (page, file) =>
  page.screenshot({ path: `docs/${file}`, type: "jpeg", quality: 84 });

// --- the opening view -------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      /waste management/i.test(document.body.innerText) &&
      !/Loading facility data/i.test(document.body.innerText),
    { timeout: 60000 }
  );
  await page.waitForTimeout(6000);
  await shot(page, "screenshot-map.jpg");
  await page.close();
}

// --- a drawer with the EPD record expanded ---------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      /waste management/i.test(document.body.innerText) &&
      !/Loading facility data/i.test(document.body.innerText),
    { timeout: 60000 }
  );
  await page.waitForTimeout(4000);
  await page.locator("aside[data-testid='ranking-sheet'] button").first().click();
  await page.waitForTimeout(400);
  await page
    .locator("aside[data-testid='ranking-sheet'] li button", { hasText: "Island East Transfer Station" })
    .first()
    .click();
  await page.waitForTimeout(2000);
  await page.locator('button[aria-label="Show facility detail"]').click();
  await page.waitForTimeout(1800);
  await shot(page, "screenshot-drawer.jpg");
  await page.close();
}

await browser.close();
console.log("wrote docs/screenshot-map.jpg and docs/screenshot-drawer.jpg");
