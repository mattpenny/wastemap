/**
 * Next.js 14 does not support a TypeScript config file (that landed in Next 15),
 * so this lives as ESM. The previous `next.config.ts` could never have built.
 *
 * Note: `output: "standalone"` was removed. It makes `next start` emit a warning
 * ("does not work with output: standalone") and requires manually copying
 * `.next/static` and `public/` into the standalone bundle. Re-add it only if
 * you actually want that deployment shape, and then start the server with
 * `node .next/standalone/server.js`.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // Build-distDir escape hatch. On this machine the environment's file hook
  // intermittently refuses to open `.next/trace` during `next build`
  // (EPERM, uncaught, every attempt), while `.next-alt` and every other path
  // build fine — so production builds are verified with
  // `WASTEMAP_DIST_DIR=.next-alt npm run build`. Default stays `.next`.
  distDir: process.env.WASTEMAP_DIST_DIR || ".next",
  // deck.gl ships ESM-only sub-dependencies; let Next transpile them for the
  // App Router server/client boundary instead of choking on them.
  transpilePackages: ["@deck.gl/core", "@deck.gl/layers", "@deck.gl/mapbox"],
  async headers() {
    // Belt-and-braces CORS for the data proxy. The route handler also sets
    // these itself so it stays correct when consumed as a standalone API.
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
