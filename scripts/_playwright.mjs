/**
 * Shared Playwright bootstrap for the verification scripts.
 *
 * Deliberately avoids hardcoding a machine-specific path: it first tries a
 * normal `playwright` dependency, then falls back to $PW_PATH (an absolute path
 * to playwright/index.js) for setups where Playwright lives outside the
 * project — in which case NODE_PATH would not help, since it is ignored for
 * ESM imports.
 */
import { pathToFileURL } from "node:url";

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Not a local dependency — fall through to the env override.
  }

  const pwPath = process.env.PW_PATH;
  if (!pwPath) {
    throw new Error(
      "Playwright not found. Install it (`npm i -D playwright`) or point PW_PATH " +
        "at the absolute path of playwright/index.js"
    );
  }
  return await import(pathToFileURL(pwPath).href);
}

/**
 * Headless Chrome has no GPU, so MapLibre GL's WebGL context would fail unless
 * we force software rendering. Newer Chrome (>= 119) blocks SwiftShader WebGL
 * by default and requires `--enable-unsafe-swiftshader` to opt in; the other
 * flags pin ANGLE's SwiftShader backend. Without these the map never paints and
 * every map-dependent verification fails.
 */
const WEBGL_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

/** Launch Chromium, preferring an installed Chrome over the bundled build. */
export async function launchChromium() {
  const mod = await loadPlaywright();
  const chromium = mod.chromium ?? mod.default?.chromium;

  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  for (const exe of candidates) {
    try {
      return await chromium.launch({
        executablePath: exe,
        headless: true,
        args: WEBGL_ARGS,
      });
    } catch {
      // try the next candidate
    }
  }

  // Last resort: Playwright's own bundled Chromium.
  return chromium.launch({ headless: true, args: WEBGL_ARGS });
}
