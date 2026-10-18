/** One-off: the three views that actually matter, after the sea grade change. */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/seasweep";
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 90000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 90000 });
await page.waitForTimeout(9000);

const VIEWS = [
  { id: "1-default", label: "default app view (z10.6, pitched)" },
  { id: "2-lamma-z12_5", center: [114.13, 22.16], zoom: 12.5, pitch: 0, label: "Lamma + open sea, z12.5 (old band)" },
  { id: "3-coast-z14", center: [114.14, 22.3], zoom: 14, pitch: 0, label: "Kowloon coast, z14" },
  { id: "4-harbour-z11", center: [114.163, 22.293], zoom: 11, pitch: 0, label: "harbour overview, z11" },
];

for (const v of VIEWS) {
  if (v.center) {
    await page.evaluate(
      ({ center, zoom, pitch }) => {
        const m = window.__wmMap;
        m.jumpTo({ center, zoom, pitch: pitch ?? 0, bearing: 0 });
      },
      v
    );
  }
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/final-${v.id}.png` });
  console.log(`${v.id.padEnd(16)} ${v.label}`);
}
await browser.close();
