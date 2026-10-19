/** Compose a before/after strip: old sea tone + old grade vs the new ones. */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";

const before = fs.readFileSync("out/dim/1-satellite-shipped.png").toString("base64");
const after = fs.readFileSync("out/look/new-default.png").toString("base64");

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 480 } });
await page.setContent(`<body style="margin:0;background:#0b1215"></body>`);
const out = await page.evaluate(async ([b, a]) => {
  const load = (b64) =>
    new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.src = "data:image/png;base64," + b64;
    });
  const [ib, ia] = await Promise.all([load(b), load(a)]);
  const H = 440;
  const W = Math.round((ib.width / ib.height) * H);
  const c = document.createElement("canvas");
  c.width = W * 2 + 8;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.drawImage(ib, 0, 0, W, H);
  ctx.drawImage(ia, W + 8, 0, W, H);
  ctx.fillStyle = "#0b1215";
  ctx.fillRect(W, 0, 8, H);
  for (const [x, label] of [[24, "BEFORE"], [W + 32, "AFTER"]]) {
    ctx.font = "600 20px system-ui, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const w = ctx.measureText(label).width;
    ctx.fillRect(x - 10, 18, w + 20, 32);
    ctx.fillStyle = "#e6f2f0";
    ctx.fillText(label, x, 41);
  }
  return c.toDataURL("image/png");
}, [before, after]);

fs.writeFileSync("out/look/before-after.png", Buffer.from(out.split(",")[1], "base64"));
console.log("wrote out/look/before-after.png");
await browser.close();
