import { launchChromium } from "./_playwright.mjs";

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(3500);
await page.screenshot({ path: "out/repro/verify-overview.png" });

// Open WKTS (highest-ranked RTS row) and screenshot the weighbridge section.
await page.click('[data-testid="ranking-sheet"] button').catch(async () => {
  await page.click('[data-dock-tab="list"]').catch(() => {});
});
await page.waitForTimeout(700);
// Click the first list row button (WKTS in the default RTS view).
const firstRow = await page.$('[data-testid="ranking-sheet"] ul li button');
await firstRow?.click();
await page.waitForTimeout(2000);
// Open the Detail toggle to reveal the EPD figures alongside the weighbridge block.
await page.click('button[aria-label="Detail"], button[title="Detail"]').catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: "out/repro/verify-drawer.png" });

// Check that the weighbridge numbers actually rendered.
const hasWeighbridge = await page.$('[data-testid="weighbridge-section"]');
const weighbridgeText = hasWeighbridge ? (await hasWeighbridge.innerText()).slice(0, 200) : "(missing)";
console.log("weighbridge section:", weighbridgeText.replace(/\s+/g, " "));
console.log("errors:", errors.filter(e => !e.includes("luma.gl: WebGL uniform")).slice(0, 8).join("\n") || "(none)");
await browser.close();
