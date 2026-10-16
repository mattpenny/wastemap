/**
 * Mobile layout probe: what is actually on screen at phone widths, and how the
 * header title lays out.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launchChromium } from "./_playwright.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "out", "verify");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE ?? "http://localhost:3000";
const browser = await launchChromium();

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "pixel-7", width: 412, height: 915 },
];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => /facilities/i.test(document.body.innerText), { timeout: 60000 });
  await page.waitForTimeout(6000);

  const report = await page.evaluate(() => {
    const vis = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
        display: cs.display,
        visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
      };
    };
    const byText = (needle, tag = "button") => {
      const el = [...document.querySelectorAll(tag)].find((e) =>
        e.innerText?.toLowerCase().includes(needle.toLowerCase())
      );
      if (!el) return null;
      // Is the label itself clipped? A truncated card title looks broken.
      const label = el.querySelector('span[class*="truncate"]') ?? el.querySelector("span > span");
      const clipped = label ? label.scrollWidth > label.clientWidth + 1 : null;
      return {
        ...vis(el),
        clipped,
        text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 40),
      };
    };

    const title = document.querySelector("h1");
    const titleLines = title
      ? Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight))
      : null;

    return {
      viewport: { w: innerWidth, h: innerHeight },
      title: { ...vis(title), text: title?.innerText, lines: titleLines },
      rankingCard: byText("Reported throughput by facility"),
      legendCard: byText("Legend"),
      trendCard: byText("Hong Kong-wide annual waste disposal"),
      infoButton: vis(document.querySelector('button[aria-label*="information" i], button[aria-label*="About" i]')),
      // Any element actually overlapping the map, to catch clipping/overlap.
      overflowing: [...document.querySelectorAll("body *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
        })
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} right=${Math.round(el.getBoundingClientRect().right)}`),
      bodyScrollW: document.documentElement.scrollWidth,
    };
  });

  console.log(`\n===== ${vp.name} ${vp.width}x${vp.height} =====`);
  console.log(JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(OUT_DIR, `mobile-${vp.name}.png`), fullPage: false });

  // Expand each card in turn and make sure it stays inside the viewport.
  const expand = async (label, needle) => {
    const header = page.locator("button", { hasText: needle }).first();
    await header.click();
    await page.waitForTimeout(900);
    const box = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("aside, div")].filter((el) => {
        const cs = getComputedStyle(el);
        return cs.position !== "static" || el.scrollHeight > 0;
      });
      const t = [...document.querySelectorAll("h1")][0];
      return { titleTop: Math.round(t.getBoundingClientRect().top) };
    });
    const card = page.locator("aside").first();
    const isAside = needle.includes("Reported");
    const target = isAside ? card : page.locator("div").filter({ has: header }).last();
    const r = await target.boundingBox().catch(() => null);
    console.log(
      `  expand ${label}: ` +
        (r
          ? `top=${Math.round(r.y)} bottom=${Math.round(r.y + r.height)} (viewport h=${vp.height}) ` +
            (r.y >= -1 && r.y + r.height <= vp.height + 1 ? "IN BOUNDS" : "OUT OF BOUNDS")
          : "no box")
    );
    await page.screenshot({ path: path.join(OUT_DIR, `mobile-${vp.name}-${label}.png`) });
    await header.click();
    await page.waitForTimeout(600);
  };

  if (vp.name === "iphone-se") {
    await expand("ranking", "Reported throughput by facility");
    await expand("legend", "Legend");
    await expand("trend", "Hong Kong-wide annual waste disposal");
  }

  await page.close();
}

await browser.close();
