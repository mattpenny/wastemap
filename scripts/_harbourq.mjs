import { launchChromium } from "./_playwright.mjs";
const BASE = process.env.BASE ?? "http://localhost:3939";
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => Boolean(window.__wmMap), { timeout: 120000 });
await page.waitForTimeout(4000);

async function probe(lng, lat, z) {
  await page.evaluate(([z, c]) => window.__wmMap.jumpTo({ zoom: z, center: c }), [z, [114.0923, 22.3763]]);
  await page.waitForTimeout(2000);
  const res = await page.evaluate(([lng, lat]) => {
    const p = window.__wmMap.project([lng, lat]);
    const feats = window.__wmMap.queryRenderedFeatures(
      [{ x: Math.round(p.x), y: Math.round(p.y) }],
      { layers: ["sea-mask"] },
    );
    return { x: Math.round(p.x), y: Math.round(p.y), hitSeaMask: feats.length };
  }, [lng, lat]);
  return res;
}

for (const z of [10.72, 10.9, 11.08]) {
  const harbour = await probe(114.16, 22.29, z);
  const east = await probe(114.35, 22.30, z);
  const south = await probe(114.20, 22.15, z);
  console.log(`z${z} harbour=${JSON.stringify(harbour)} east=${JSON.stringify(east)} south=${JSON.stringify(south)}`);
}
await browser.close();
