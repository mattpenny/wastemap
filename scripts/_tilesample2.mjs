/**
 * One-off: same measurement as _tilesample.mjs, but against an arbitrary tile
 * template, so a candidate source can be compared with Esri for (a) how dark
 * its water is and (b) whether that darkness *steps* between zoom levels.
 *
 *   node scripts/_tilesample2.mjs <template with {z} {x} {y}> [maxZoom]
 */
import { launchChromium } from "./_playwright.mjs";

const tpl = process.argv[2];
const MAXZ = Number(process.argv[3] ?? 17);
if (!tpl) {
  console.error("usage: node scripts/_tilesample2.mjs <tileUrlTemplate> [maxZoom]");
  process.exit(1);
}

const POINTS = [
  { id: "harbour", lon: 114.163, lat: 22.293 },
  { id: "opensouth", lon: 114.25, lat: 22.06 },
  { id: "eastsea", lon: 114.42, lat: 22.24 },
  { id: "land", lon: 114.24, lat: 22.42 },
];

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
  const url = tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  const res = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url);
      if (!r.ok) return { err: `HTTP ${r.status}` };
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return { b64: btoa(s) };
    } catch (e) {
      return { err: String(e).slice(0, 40) };
    }
  }, url);
  if (res.err) return { err: res.err };

  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = "data:image/jpeg;base64," + b64;
      try {
        await img.decode();
      } catch {
        return { err: "decode failed" };
      }
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
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
      return { hex: `#${hex(r)}${hex(g)}${hex(b)}`, luma: +(l / n).toFixed(1) };
    },
    { b64: res.b64, px, py }
  );
}

console.log(`\n${tpl}\n`);
console.log(" point       z   hex       luma");
console.log(" " + "-".repeat(34));
for (const p of POINTS) {
  for (let z = 8; z <= MAXZ; z++) {
    const r = await sample(p.lon, p.lat, z);
    if (r.err) {
      console.log(` ${p.id.padEnd(10)} ${String(z).padStart(2)}   ${r.err}`);
      continue;
    }
    console.log(` ${p.id.padEnd(10)} ${String(z).padStart(2)}   ${r.hex}  ${String(r.luma).padStart(5)}`);
  }
  console.log("");
}
await browser.close();
