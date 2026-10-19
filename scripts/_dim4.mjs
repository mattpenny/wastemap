/** Luma distribution of the map area: the "no highlights" test. */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const files = ["out/dim/1-satellite-shipped.png", "out/dim/4-official.png"];
const browser = await launchChromium();
const p = await browser.newPage();
await p.goto("about:blank");
for (const f of files) {
  const b64 = fs.readFileSync(f).toString("base64");
  const r = await p.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(430, 180, 620, 520).data;
    const hist = new Array(256).fill(0);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      hist[L]++; n++;
    }
    const pct = (q) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v; }
      return 255;
    };
    return { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), p99: pct(0.99) };
  }, b64);
  console.log(`  ${f.split("/").pop().padEnd(24)} p10 ${r.p10}  p50 ${r.p50}  p90 ${r.p90}  p99 ${r.p99}`);
}
await browser.close();
