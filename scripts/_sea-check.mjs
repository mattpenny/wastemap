/**
 * One-off: capture the satellite view at overview AND zoomed-in for the
 * zoom-faded sea-mask verification.
 *   BASE=http://localhost:3939 node scripts/_sea-check.mjs
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./_playwright.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "out", "verify");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE ?? "https://hkwastemap.vercel.app";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), {
  timeout: 60000,
});
await page.waitForTimeout(9000); // Esri raster + OSM water tiles settle

// A) Overview — the view where Esri's dark low-zoom mosaic used to show.
await page.screenshot({ path: path.join(OUT_DIR, "sea-fade-overview.png") });

// B) Zoom into Victoria Harbour (camera centre area of the map canvas).
await page.mouse.move(720, 470);
for (let i = 0; i < 14; i++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(220);
}
await page.waitForTimeout(5000); // deep-zoom tiles stream in
await page.screenshot({ path: path.join(OUT_DIR, "sea-fade-close.png") });

// C) Follow with a couple of wheels out and back for one more sample.
console.log("errors:", errors.length ? errors.join("\n") : "none");
console.log("saved: sea-fade-overview.png, sea-fade-close.png");
await browser.close();
