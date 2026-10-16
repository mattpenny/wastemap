/**
 * Screenshots the WKTS drawer, which is the only station with weighbridge
 * records, on desktop and at 390px.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./_playwright.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "out", "shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "iphone-390", width: 390, height: 844, mobile: true },
];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => /waste management/i.test(document.body.innerText), {
    timeout: 60000,
  });
  await page.waitForTimeout(6000);

  if (vp.mobile) {
    await page.locator('[data-dock-tab="list"]').click();
    await page.waitForTimeout(1200);
  } else {
    await page.locator("button:not([data-dock-tab])", { hasText: "Reported throughput by facility" }).click();
    await page.waitForTimeout(1000);
  }

  const row = page.locator("button", { hasText: "West Kowloon Transfer Station" }).first();
  console.log(`${vp.name}: WKTS row found = ${await row.count()}`);
  await row.click();
  await page.waitForTimeout(2500);

  await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-wkts-drawer-top.png`) });

  const report = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="weighbridge-section"]');
    const drawer = document.querySelector('aside[role="dialog"]');
    const text = drawer?.innerText ?? "";
    return {
      hasSection: Boolean(section),
      sectionHeight: section ? Math.round(section.getBoundingClientRect().height) : 0,
      charts: drawer?.querySelectorAll(".recharts-wrapper").length ?? 0,
      hasGtw: /grease trap waste/i.test(text),
      hasGtwNote: /only transfer station/i.test(text),
      hasPrivate: /Private vehicles/i.test(text),
      hasPublic: /FEHD/i.test(text),
      hasDistrict: /Kwai Tsing/i.test(text),
      hasTotal: /50,033/.test(text),
      hasTpd: /3,336|3,335/.test(text),
      drawerScrollW: drawer ? Math.round(drawer.scrollWidth) : null,
      drawerClientW: drawer ? Math.round(drawer.clientWidth) : null,
      pageScrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });
  console.log(`${vp.name}: ${JSON.stringify(report, null, 1)}`);

  // Scroll to the bottom of the drawer for a second capture.
  await page.evaluate(() => {
    const scroller = document.querySelector('aside[role="dialog"] .thin-scrollbar');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-wkts-drawer-bottom.png`) });

  await page.close();
}

await browser.close();
