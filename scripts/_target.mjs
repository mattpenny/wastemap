/** Sample the user's reference screenshot so the sea can be matched to it. */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const b64 = fs.readFileSync("C:/Users/Ansum/OneDrive/桌面/screenshot-map.jpg").toString("base64");
const browser = await launchChromium();
const p = await browser.newPage();
await p.goto("about:blank");
const out = await p.evaluate(async (b64) => {
  const img = new Image();
  img.src = "data:image/jpeg;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const rects = {
    "sea south of Lamma": [380, 470, 180, 90],
    "sea west (Lantau)": [60, 380, 150, 90],
    "sea east (Clear Water)": [900, 480, 120, 80],
    "harbour": [520, 380, 90, 40],
  };
  const res = {};
  for (const [k, [x, y, w, h]] of Object.entries(rects)) {
    const d = ctx.getImageData(x, y, w, h).data;
    let r = 0, g = 0, b = 0, n = 0, l = 0, sd = 0;
    const Ls = [];
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      l += L; Ls.push(L); n++;
    }
    const mean = l / n;
    for (const L of Ls) sd += (L - mean) ** 2;
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
    res[k] = `${"#" + hex(r) + hex(g) + hex(b)}  luma ${mean.toFixed(0)}  sd ${Math.sqrt(sd / n).toFixed(1)}`;
  }
  return res;
}, b64);
for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(24)} ${v}`);
await browser.close();
