// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

/**
 * GitHub Pages configuration
 * ────────────────────────────────────────────────────────────────
 * `site` and `base` can be overridden at build time via env vars
 * so the same source tree builds for any owner / repo target:
 *
 *   PUBLIC_SITE_URL=https://owner.github.io PUBLIC_BASE_PATH=/refscope astro build
 *
 * Defaults assume project pages at owner.github.io/refscope. The
 * placeholder owner is "owner" — replace at deploy time.
 */
const SITE = process.env.PUBLIC_SITE_URL ?? "https://owner.github.io";
const BASE = process.env.PUBLIC_BASE_PATH ?? "/refscope";

export default defineConfig({
  site: SITE,
  base: BASE,
  output: "static",
  trailingSlash: "ignore",
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  build: {
    assets: "_astro",
    inlineStylesheets: "auto",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
