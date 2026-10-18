/**
 * One-off diagnostic: sweep the camera through every zoom level and measure the
 * sea's actual rendered tone, with and without the `sea-tint` layer, and record
 * which Esri tile level was fetched at each camera zoom.
 *
 * The point is to separate two very different explanations for the "black
 * shadow in the sea at a particular zoom":
 *
 *   1. the source pixels really are dark there (then a tint is an aesthetic
 *      choice, not a bug fix), or
 *   2. the layer stack is showing a mismatched tile level / a cross-fade
 *      between two levels during the z13.5–14.5 handover (then it is a bug and
 *      the fix belongs in the style).
 *
 * Usage: node scripts/_seasweep.mjs [label]
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3939";
const label = process.argv[2] ?? "sweep";

const SITES = [
  { id: "harbour", center: [114.163, 22.293] },
  { id: "opensouth", center: [114.25, 22.06] },
];
const ZOOMS = [10, 10.6, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16];

const OUT = path.resolve("out/seasweep");
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

// Track which tile zoom the app pulls from Esri at each step.
let tileLog = new Map();
page.on("request", (r) => {
  const m = r.url().match(/World_Imagery\/MapServer\/tile\/(\d+)\//);
  if (m) tileLog.set(m[1], (tileLog.get(m[1]) ?? 0) + 1);
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 90000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 90000 });
await page.waitForTimeout(8000);

// Flatten the camera so measurements are not skewed by a pitched horizon.
await page.evaluate(() => {
  const m = window.__wmMap;
  m.setPitch(0);
  m.setBearing(0);
});

/** Mean luma + hex of a crop of a PNG buffer, measured in a blank page. */
const meas = await browser.newPage();
await meas.goto("about:blank");
async function measure(buf, x, y, w, h) {
  const b64 = buf.toString("base64");
  return meas.evaluate(
    async ({ b64, x, y, w, h }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x, y, w, h).data;
      let r = 0, g = 0, b = 0, l = 0, n = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        l += L;
        if (L < 40) dark++;
        n++;
      }
      const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
      return {
        hex: `#${hex(r)}${hex(g)}${hex(b)}`,
        luma: +(l / n).toFixed(1),
        darkPct: +((dark / n) * 100).toFixed(1),
      };
    },
    { b64, x, y, w, h }
  );
}

const rows = [];
for (const site of SITES) {
  for (const z of ZOOMS) {
    for (const tint of ["on", "off"]) {
      await page.evaluate(
        ({ center, z, tint }) => {
          const m = window.__wmMap;
          m.setLayoutProperty(
            "sea-tint",
            "visibility",
            tint === "on" ? "visible" : "none"
          );
          m.jumpTo({ center, zoom: z, pitch: 0, bearing: 0 });
        },
        { center: site.center, z, tint }
      );
      // Let the new tiles land and the 300ms fades finish.
      await page.waitForTimeout(3200);
      tileLog = new Map();
      const buf = await page.screenshot();
      const tag = `${label}-${site.id}-z${String(z).replace(".", "_")}-${tint}`;
      fs.writeFileSync(path.join(OUT, `${tag}.png`), buf);
      // Centre crop — pure sea for `opensouth`, harbour water for `harbour`.
      const m = await measure(buf, 400, 250, 400, 300);
      const tz = [...tileLog].sort((a, b) => a[0] - b[0]).map(([k, n]) => `z${k}:${n}`).join(" ");
      rows.push({ site: site.id, zoom: z, tint, ...m, tiles: tz || "-" });
    }
  }
}

// Print a compact comparison table.
console.log("\n site      camZ  tint  luma  dark%   hex       tiles fetched");
console.log(" " + "-".repeat(74));
for (const r of rows) {
  console.log(
    ` ${r.site.padEnd(9)} ${String(r.zoom).padStart(4)}  ${r.tint.padEnd(3)}  ${String(r.luma).padStart(5)}  ${String(r.darkPct).padStart(5)}   ${r.hex}   ${r.tiles}`
  );
}
fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(rows, null, 1));
console.log(`\nshots + ${label}.json in out/seasweep/`);
await browser.close();
