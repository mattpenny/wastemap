/** Point-sample the shipped screenshot: land vs sea, to see which is dark. */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const b64 = fs.readFileSync("out/dim/1-satellite-shipped.png").toString("base64");
const browser = await launchChromium();
const p = await browser.newPage();
await p.goto("about:blank");
const out = await p.evaluate(async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const pts = {
    "NT vegetation (north)": [430, 40],
    "Kowloon urban": [520, 120],
    "Harbour water": [600, 175],
    "HK Island urban": [560, 235],
    "Open sea (south)": [300, 400],
    "Open sea (east)": [700, 330],
    "Lantau hills": [180, 250],
  };
  const res = {};
  for (const [k, [x, y]] of Object.entries(pts)) {
    const d = ctx.getImageData(x, y, 1, 1).data;
    const L = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
    res[k] = `rgb(${d[0]},${d[1]},${d[2]})  luma ${L.toFixed(0)}`;
  }
  return res;
}, b64);
for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(24)} ${v}`);
await browser.close();
