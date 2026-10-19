/**
 * Reproduce the user's report: from the default landing view, scroll the mouse
 * wheel in and watch the sea. Reports the camera zoom after each notch and
 * captures each step, so the level the user lands on (and what the mask is
 * doing there) is known rather than guessed.
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "https://hkwastemap.vercel.app";
const OUT = process.env.OUT ?? "out/wheelrepro";
fs.mkdirSync(OUT, { recursive: true });
const NOTCHES = Number(process.env.NOTCHES ?? 4);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(10000);

async function cam() {
  return page.evaluate(() => {
    const c = window.__wmMap.getCenter(), z = window.__wmMap.getZoom();
    return { zoom: +z.toFixed(3), lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4) };
  });
}
await page.screenshot({ path: `${OUT}/landing.png` });
console.log("landing ", JSON.stringify(await cam()));

// Wheel up = zoom in. One "notch" of a standard mouse is deltaY=-120 (Chrome
// reports -120 per notch in pixel mode).
for (let i = 1; i <= NOTCHES; i++) {
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(2500);
  const c = await cam();
  await page.screenshot({ path: `${OUT}/notch${i}.png` });
  console.log(`notch ${i} `, JSON.stringify(c));
}
await browser.close();
