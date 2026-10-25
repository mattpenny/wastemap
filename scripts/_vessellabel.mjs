/**
 * The vessel name is drawn on the map, not only on hover.
 *
 * What this checks:
 *   A. Each visible vessel has a label band beside its hull that is measurably
 *      brighter with the vessel shown than with it hidden. The A/B is against
 *      the same camera and the same band, so pale quay or sun glint underneath
 *      cannot pass for text.
 *   B. The text is wider than it is tall, and stays that way on a rotated map.
 *      That is the check that catches a well-meaning "fix" that subtracts the
 *      map bearing from the label's angle the way the hull needs: the text would
 *      tilt and the bounding box would close up towards square.
 *
 * Screenshots land in out/vessellabel/. Requires a dev server on $BASE.
 */
import fs from "node:fs";
import path from "node:path";
import { launchChromium } from "./_playwright.mjs";

const BASE = process.env.BASE || "http://localhost:3942";
const OUT = path.resolve(process.cwd(), "out/vessellabel");
fs.mkdirSync(OUT, { recursive: true });

const tracks = JSON.parse(
  fs.readFileSync("src/data/vessel-tracks/tracks.json", "utf8")
).vessels;

const VESSEL_SIZE_PX = 46;
/** Distance from the hull centre to the label. */
const LABEL_OFFSET = VESSEL_SIZE_PX / 2 + 7;
/**
 * Labels alternate sides by draw order — index 0 above, index 1 below — so two
 * ships close together on screen cannot print their names on top of each other.
 */
const labelDy = (i) => (i % 2 === 0 ? -LABEL_OFFSET : LABEL_OFFSET);

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
}

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

console.log(`loading ${BASE} ...`);
await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(9000);

const legendPanel = 'div[class*="max-h-[46vh]"]';
async function legendOpen() {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && el.getBoundingClientRect().height > 200;
  }, legendPanel);
}
async function setLegend(open) {
  if ((await legendOpen()) === open) return;
  await page.locator('button:has-text("Legend")').first().click();
  await page.waitForTimeout(500);
}

/** Select every vessel through the toolbar picker. */
async function showVessels() {
  await page.locator('[data-testid="display-toolbar"] [data-testid="vessel-toggle"]').click();
  await page.waitForTimeout(400);
  // The per-vessel rows are the only buttons in the popover with aria-pressed;
  // the "show all" header button does not have it.
  const rows = page.locator('[data-testid="vessel-menu"] button[aria-pressed]');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const on = await row.getAttribute("aria-pressed");
    if (on !== "true") {
      await row.click();
      await page.waitForTimeout(250);
    }
  }
  // Close the popover with the same control that opened it, so it cannot sit
  // over the labels.
  await page.locator('[data-testid="display-toolbar"] [data-testid="vessel-toggle"]').click();
  await page.waitForTimeout(300);
}

async function project(pts) {
  return page.evaluate((list) => {
    const m = window.__wmMap;
    const rect = m.getCanvas().getBoundingClientRect();
    return list.map((p) => {
      const pr = m.project([p.lng, p.lat]);
      return { ...p, x: pr.x + rect.left, y: pr.y + rect.top };
    });
  }, pts);
}

/**
 * Bright-pixel statistics inside a rectangle of a screenshot.
 * "Bright" is deliberately strict: the text is pure white with a near-black
 * halo, and nothing in the water imagery gets close to 215 luma.
 */
async function brightBox(file, cx, cy, halfW, halfH) {
  const b64 = fs.readFileSync(file).toString("base64");
  return page.evaluate(
    async ([data, x, y, hw, hh]) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = `data:image/png;base64,${data}`;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data: px } = ctx.getImageData(0, 0, c.width, c.height);

      let count = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let py = Math.max(0, Math.round(y - hh)); py < Math.min(c.height, Math.round(y + hh)); py++) {
        for (let pxi = Math.max(0, Math.round(x - hw)); pxi < Math.min(c.width, Math.round(x + hw)); pxi++) {
          const i = (py * c.width + pxi) * 4;
          const luma = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          if (luma < 215) continue;
          count++;
          if (pxi < minX) minX = pxi;
          if (pxi > maxX) maxX = pxi;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
      return {
        count,
        w: count ? maxX - minX + 1 : 0,
        h: count ? maxY - minY + 1 : 0,
      };
    },
    [b64, cx, cy, halfW, halfH]
  );
}

const lastPoints = tracks.map((t) => {
  const p = t.points[t.points.length - 1];
  return { name: t.name, mmsi: t.mmsi, lng: p.lng, lat: p.lat };
});

// ---------------------------------------------------------------- baseline
await setLegend(false);
const offShot = path.join(OUT, "00-hidden.png");
await page.screenshot({ path: offShot });
const offPts = await project(lastPoints);
const baseline = {};
for (const [i, p] of offPts.entries()) {
  baseline[p.mmsi] = await brightBox(offShot, p.x, p.y + labelDy(i), 72, 6);
}
console.log(
  "baseline bright pixels:",
  lastPoints.map((p) => `${p.name}=${baseline[p.mmsi].count}`).join(", ")
);

// ---------------------------------------------------------------- shown
await showVessels();
await setLegend(false);
await page.waitForTimeout(2500);
const onShot = path.join(OUT, "01-labels.png");
await page.screenshot({ path: onShot });

const onPts = await project(lastPoints);
for (const [i, p] of onPts.entries()) {
  const box = await brightBox(onShot, p.x, p.y + labelDy(i), 72, 6);
  const base = baseline[p.mmsi].count;
  check(
    `${p.name}: its name is drawn beside the hull`,
    box.count - base > 25,
    `${box.count} bright px vs ${base} with the vessel hidden`
  );
  check(
    `${p.name}: the label is text, not a smudge`,
    box.w > 30 && box.w / Math.max(1, box.h) > 2.5,
    `box ${box.w}x${box.h}, aspect ${(box.w / Math.max(1, box.h)).toFixed(1)}`
  );
}

// ---------------------------------------------------------------- rotated
// The hull rotates in screen space and subtracts the bearing; the label must
// NOT. On a rotated map an upright label keeps a wide bounding box.
await page.evaluate(() => window.__wmMap.setBearing(-18));
await page.waitForTimeout(1800);
const rotShot = path.join(OUT, "02-rotated.png");
await page.screenshot({ path: rotShot });
const rotPts = await project(lastPoints);
for (const [i, p] of rotPts.entries()) {
  const box = await brightBox(rotShot, p.x, p.y + labelDy(i), 72, 6);
  check(
    `${p.name}: the label stays upright on a rotated map`,
    box.count > 25 && box.w / Math.max(1, box.h) > 2.5,
    `box ${box.w}x${box.h}, aspect ${(box.w / Math.max(1, box.h)).toFixed(1)}`
  );
}

check("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
