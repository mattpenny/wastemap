/** Probe what renders at the mystery pill positions on the map view. */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./_playwright.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "out", "verify");
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await launchChromium();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /facilities/i.test(document.body.innerText), { timeout: 60000 });
await page.waitForTimeout(14000); // past the map 12s ready-fallback

const ready = await page.evaluate(() => document.body.innerText.includes("Loading facility"));
console.log("still loading?", ready);

// Probe the mystery pill positions.
for (const [x, y] of [[1160, 545], [1160, 570], [1160, 595]]) {
  const info = await page.evaluate(
    ([px, py]) => {
      const els = document.elementsFromPoint(px, py);
      return els.slice(0, 4).map((el) => {
        const r = el.getBoundingClientRect();
        return `<${el.tagName.toLowerCase()} class="${(el.className || "").toString().slice(0, 60)}"> rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} text="${(el.textContent || "").trim().slice(0, 60)}"`;
      });
    },
    [x, y]
  );
  console.log(`--- at ${x},${y}:`);
  for (const line of info) console.log("   ", line);
}

await page.screenshot({ path: path.join(OUT_DIR, "debug-map.png") });
await browser.close();
