import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";
const b64 = fs.readFileSync("out/seasweep/final-2-lamma-z12_5.png").toString("base64");
const browser = await launchChromium();
const p = await browser.newPage();
await p.goto("about:blank");
const out = await p.evaluate(async (b64) => {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const rows = [40, 100, 200, 300, 400, 500, 580];
  return rows.map((y) => {
    const d = ctx.getImageData(300, y, 400, 1).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
    return `y=${y}  #${hex(r)}${hex(g)}${hex(b)}`;
  });
}, b64);
console.log(out.join("\n"));
await browser.close();
