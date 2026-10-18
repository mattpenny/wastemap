/**
 * One-off: measure the RAW Esri World Imagery tone at a fixed set of points, at
 * every tile zoom from 8 to 17. No app, no style, no tone curve — just the
 * source pixels.
 *
 * This answers the only question that matters for the "black shadow in the sea"
 * report: is the darkness *in the source imagery* (in which case a tint is an
 * aesthetic decision), or does it appear only when the app renders it (in which
 * case it is a style bug)?
 */
import { launchChromium } from "./_playwright.mjs";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

const POINTS = [
  { id: "harbour", lon: 114.163, lat: 22.293 },
  { id: "opensouth", lon: 114.25, lat: 22.06 },
  { id: "eastsea", lon: 114.42, lat: 22.24 },
  { id: "land", lon: 114.24, lat: 22.42 },
];
const ZOOMS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const xf = ((lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, px: (xf - x) * 256, py: (yf - y) * 256 };
}

const browser = await launchChromium();
const page = await browser.newPage();
await page.goto("about:blank");

async function sample(lon, lat, z) {
  const { x, y, px, py } = tileOf(lon, lat, z);
  const url = `${ESRI}/${z}/${y}/${x}`;
  const b64 = await page.evaluate(async (url) => {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }, url);
  if (!b64) return { err: "fetch failed" };

  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const half = 12;
      const sx = Math.max(0, Math.min(img.width - 2 * half, Math.round(px) - half));
      const sy = Math.max(0, Math.min(img.height - 2 * half, Math.round(py) - half));
      const d = ctx.getImageData(sx, sy, half * 2, half * 2).data;
      let r = 0, g = 0, b = 0, l = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
      }
      const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
      return { hex: `#${hex(r)}${hex(g)}${hex(b)}`, luma: +(l / n).toFixed(1), tile: `${img.width}x${img.height}` };
    },
    { b64, px, py }
  );
}

console.log("\n point       z   tilePx   hex       luma");
console.log(" " + "-".repeat(48));
for (const p of POINTS) {
  for (const z of ZOOMS) {
    const r = await sample(p.lon, p.lat, z);
    if (r.err) {
      console.log(` ${p.id.padEnd(10)} ${String(z).padStart(2)}   ${r.err}`);
      continue;
    }
    console.log(
      ` ${p.id.padEnd(10)} ${String(z).padStart(2)}   ${(r.tile ?? "").padEnd(8)}  ${r.hex}  ${String(r.luma).padStart(5)}`
    );
  }
  console.log("");
}
await browser.close();
