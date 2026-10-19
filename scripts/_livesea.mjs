/**
 * One-off: measure the DEPLOYED site's sea tone at three zooms.
 *
 * This is the "is my fix actually live?" check that does not rely on eyeballing
 * a screenshot: it reports the same luma number the local harness reports, so
 * the deployed build can be compared with the local one directly.
 *
 * The mask is now zoom-gated: off below z11.2 (natural imagery, which is what
 * the wide view is supposed to look like) and fully on from z12.2. So the check
 * is split — above z12.2 the sea must be exactly SEA_COLOR (#35565c, luma ~79)
 * with no dark pixels; at the overview it is real imagery and only needs to
 * stay clear of the dark band (> 55 luma, < 5% dark).
 */
import { launchChromium } from "./_playwright.mjs";

const BASE = process.env.BASE ?? "https://hkwastemap.vercel.app";
const ZOOMS = [10.6, 12.5, 15];

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForFunction(() => /facilit/i.test(document.body.innerText), { timeout: 120000 });
await page.waitForTimeout(10000);

const meas = await browser.newPage();
await meas.goto("about:blank");
async function luma(buf) {
  const b64 = buf.toString("base64");
  return meas.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(400, 250, 400, 300).data;
    let r = 0, g = 0, b = 0, l = 0, n = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      l += L; if (L < 40) dark++; n++;
    }
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
    return { hex: `#${hex(r)}${hex(g)}${hex(b)}`, luma: +(l / n).toFixed(1), darkPct: +((dark / n) * 100).toFixed(1) };
  }, b64);
}

console.log(`\n${BASE}  (open water south of Lamma)\n`);
console.log("  camZ    hex       luma   dark%   verdict");
console.log("  " + "-".repeat(50));
const seen = [];
for (const z of ZOOMS) {
  await page.evaluate((z) => {
    window.__wmMap.setPitch(0);
    window.__wmMap.setBearing(0);
    window.__wmMap.jumpTo({ center: [114.25, 22.06], zoom: z, pitch: 0, bearing: 0 });
  }, z);
  await page.waitForTimeout(4500);
  const r = await luma(await page.screenshot());
  seen.push(r.hex);
  // Above the crossover the mask must be opaque; below it the imagery is
  // expected, so only the "not a shadow" floor applies.
  const masked = z >= 12.2;
  const ok = masked
    ? r.darkPct < 5 && r.luma > 70
      ? "OK (masked)"
      : "IMAGERY SHOWING THROUGH"
    : r.darkPct < 5 && r.luma > 55
      ? "OK (natural imagery)"
      : "TOO DARK";
  console.log(`  ${String(z).padStart(5)}   ${r.hex}  ${String(r.luma).padStart(5)}   ${String(r.darkPct).padStart(5)}   ${ok}`);
}
// z10.6 sits under the place-label overlay, which tints the sample by 2-3 luma.
console.log(`\n  colours across zooms: ${new Set(seen).size === 1 ? "YES (flat mask)" : "NO -> " + seen.join(" ")}`);
await browser.close();
