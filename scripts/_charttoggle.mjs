/**
 * One-off: verify the bar/pie switch on the "Who delivers it" block.
 *
 * Checks the things that could silently be wrong:
 *   - the switch exists and is right-aligned in the heading row
 *   - pie mode is the default and carries `wb-streams-pie` (the suite asserts
 *     on that id, so it must not move)
 *   - pie mode swaps the block and the legend
 *   - the pie EXCLUDES grease trap waste, and its shares are re-based on MSW
 *     (52.2% and 32.8% of all intake must become 61% and 39% of MSW, not 52/33)
 *   - the centre total is the MSW total (42,507), not the grand total (50,033)
 */
import { launchChromium } from "./_playwright.mjs";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3939";
const OUT = "out/chart";
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => /waste management/i.test(document.body.innerText));
// The ranking card opens collapsed by default; its rows only exist once it is
// expanded, so expand it before looking for a station.
const rankingHeader = page
  .locator("button", { hasText: "Reported throughput by facility" })
  .first();
await rankingHeader.click();
await page.waitForTimeout(1200);

const wkts = page.locator("button", { hasText: "West Kowloon Transfer Station" }).first();
await wkts.click();
await page.waitForTimeout(2500);

const drawer = page.locator('aside[role="dialog"]');
const section = drawer.locator('[data-testid="weighbridge-section"]');
const block = section.locator("div").filter({ has: page.locator('[data-testid="wb-chart-pie"]') }).last();

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
};

// --- the switch itself -------------------------------------------------
const barBtn = section.locator('[data-testid="wb-chart-bar"]');
const pieBtn = section.locator('[data-testid="wb-chart-pie"]');
check("switch: bar button present", (await barBtn.count()) === 1);
check("switch: pie button present", (await pieBtn.count()) === 1);
check("switch: pie is the default", (await pieBtn.getAttribute("aria-pressed")) === "true");
check("switch: bar starts unpressed", (await barBtn.getAttribute("aria-pressed")) === "false");

// Right-aligned: the group's right edge should sit in the right third of the
// section, and clearly to the right of the heading text.
const geom = await page.evaluate(() => {
  const sec = document.querySelector('[data-testid="weighbridge-section"]');
  const group = document.querySelector('[data-testid="wb-chart-bar"]')?.parentElement;
  const heading = [...sec.querySelectorAll("p")].find((p) =>
    /who delivers it/i.test(p.textContent ?? "")
  );
  const r = (el) => el.getBoundingClientRect();
  return {
    section: { x: r(sec).x, w: r(sec).width },
    group: { x: r(group).x, w: r(group).width },
    heading: { x: r(heading).x, w: r(heading).width },
  };
});
const groupRight = geom.group.x + geom.group.w;
const sectionRight = geom.section.x + geom.section.w;
check(
  "switch: right-aligned in the heading row",
  groupRight > geom.section.x + geom.section.w * 0.75 &&
    groupRight <= sectionRight &&
    geom.group.x > geom.heading.x + geom.heading.w,
  `group right ${Math.round(groupRight)} vs section right ${Math.round(sectionRight)}`
);

// --- bar mode ----------------------------------------------------------
// Pie is the default, so the bar list has to be switched on first.
await barBtn.click();
await page.waitForTimeout(1500);
check("bar mode: wb-streams present", (await section.locator('[data-testid="wb-streams"]').count()) === 1);
check("bar mode: no pie", (await section.locator('[data-testid="wb-streams-pie"]').count()) === 0);
const barText = await section.locator('[data-testid="wb-streams"]').innerText();
check("bar mode: lists all three streams", /Grease trap waste/i.test(barText), barText.replace(/\n/g, " | ").slice(0, 90));
await page.screenshot({ path: `${OUT}/1-bar.png` });
await section.screenshot({ path: `${OUT}/1-bar-section.png` });

// --- pie mode ----------------------------------------------------------
await pieBtn.click();
await page.waitForTimeout(1800);
check("pie mode: pie present", (await section.locator('[data-testid="wb-streams-pie"]').count()) === 1);
check("pie mode: bar list removed", (await section.locator('[data-testid="wb-streams"]').count()) === 0);
check("pie mode: pie button now pressed", (await pieBtn.getAttribute("aria-pressed")) === "true");

const pie = section.locator('[data-testid="wb-streams-pie"]');
const pieText = await pie.innerText();
const legend = await section.locator('[data-testid="wb-streams-pie-legend"]').innerText();
check("pie mode: legend names private vehicles", /Private vehicles/i.test(legend), legend.replace(/\n/g, " | "));
check("pie mode: legend names FEHD / public", /FEHD \/ public/i.test(legend));
check("pie mode: GTW is not a slice or legend row", !/grease trap/i.test(legend), legend.replace(/\n/g, " | "));
check("pie mode: legend has exactly two entries",
  (await section.locator('[data-testid="wb-streams-pie-legend"] > span').count()) === 2);
check("pie mode: says GTW is excluded", /excluded/i.test(pieText));
check("pie mode: centre total is MSW 42,507", /42,507/.test(pieText), pieText.replace(/\n/g, " | "));
check("pie mode: centre total is NOT the grand total", !/50,033/.test(pieText));

// Shares must be re-based on MSW: 52.2 / (52.2+32.8) = 61%, 32.8/85 = 39%.
check("pie mode: private share re-based to 61%", /61%/.test(legend));
check("pie mode: public share re-based to 39%", /39%/.test(legend));
check("pie mode: old un-rebased shares gone", !/52%/.test(legend) && !/33%/.test(legend));

// Two slices, two colours, one SVG path each.
const paths = await pie.evaluate((el) => el.querySelectorAll(".recharts-pie-sector").length);
check("pie mode: exactly two slices", paths === 2, `sectors=${paths}`);

// The line chart above must survive the swap.
check("pie mode: intake line chart still present", (await section.locator(".recharts-line").count()) === 3);

await page.screenshot({ path: `${OUT}/2-pie.png` });
await section.screenshot({ path: `${OUT}/2-pie-section.png` });

// --- back to bar -------------------------------------------------------
await barBtn.click();
await page.waitForTimeout(1200);
check("back to bar: wb-streams restored", (await section.locator('[data-testid="wb-streams"]').count()) === 1);
check("back to bar: pie gone", (await section.locator('[data-testid="wb-streams-pie"]').count()) === 0);

// --- Chinese labels ----------------------------------------------------
await page.locator("button", { hasText: /^中文$/ }).first().click();
await page.waitForTimeout(1500);
const zh = await section.innerText();
check("zh: heading is Chinese", /來源類別/.test(zh));
await pieBtn.click();
await page.waitForTimeout(1500);
const zhPie = await section.locator('[data-testid="wb-streams-pie"]').innerText();
check("zh: pie note is Chinese", /不包括隔油池廢物/.test(zhPie), zhPie.replace(/\n/g, " | "));
await section.screenshot({ path: `${OUT}/3-pie-zh.png` });

const failed = results.filter((r) => !r.ok);
console.log(`\n=== chart toggle: ${results.length - failed.length}/${results.length} passed ===`);
await browser.close();
process.exit(failed.length ? 1 : 0);
