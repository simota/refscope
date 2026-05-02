#!/usr/bin/env node
/**
 * Refscope LP — media capture script.
 *
 * Captures hero PNG + demo scenes against the local UI.
 * Run after `make dev-self` is up (UI on 127.0.0.1:5173, API on 127.0.0.1:4175).
 *
 * Outputs to apps/web/public/media/.
 *
 * Usage:
 *   node apps/web/scripts/capture.mjs
 *   THEME=dark node apps/web/scripts/capture.mjs           # capture dark only
 *   UI_URL=http://127.0.0.1:5173 node apps/web/scripts/capture.mjs
 *
 * The script is best-effort: scenes that depend on UI affordances Refscope
 * has not yet shipped (e.g. light theme, simulated rewrite event) print a
 * warning and skip rather than failing the whole run.
 */

import { chromium } from "playwright";
import { mkdir, access, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = resolve(__dirname, "..", "public", "media");

const UI_URL = process.env.UI_URL ?? "http://127.0.0.1:5173";
const THEMES = (process.env.THEME ? [process.env.THEME] : ["dark", "light"]).filter(Boolean);
const VIEWPORT = { width: 1600, height: 1000 };
const DEVICE_SCALE_FACTOR = 2;

/* ──────────────────────────────────────────────
   Small helpers
   ────────────────────────────────────────────── */

const log  = (msg) => console.log(`[capture] ${msg}`);
const warn = (msg) => console.warn(`[capture] WARN  ${msg}`);
const err  = (msg) => console.error(`[capture] ERROR ${msg}`);

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

/** Wait until UI_URL responds, up to 30s. */
async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status === 304) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`UI did not respond at ${url} within ${timeoutMs}ms — start it with \`make dev-self\``);
}

/**
 * Apply theme by overriding next-themes / local storage.
 * Refscope UI uses a `theme` key on document; if light theme is not yet
 * implemented in the UI, this is a no-op and dark stays.
 */
async function applyTheme(page, theme) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem("theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.dataset.theme = t;
    } catch { /* ignore */ }
  }, theme);
  await page.waitForTimeout(150);
}

/** Capture a single full-viewport PNG. */
async function captureFull(page, outPath) {
  await ensureDir(dirname(outPath));
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  log(`wrote ${outPath}`);
}

/** Capture a clipped region of the page. Falls back to full viewport. */
async function captureClip(page, outPath, selector) {
  await ensureDir(dirname(outPath));
  let clip = null;
  if (selector) {
    const handle = await page.$(selector);
    if (handle) {
      const box = await handle.boundingBox();
      if (box) clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(VIEWPORT.width, box.width), height: Math.min(VIEWPORT.height, box.height) };
    }
  }
  await page.screenshot({ path: outPath, type: "png", clip: clip ?? undefined, fullPage: false });
  log(`wrote ${outPath}${clip ? "" : " (full viewport, selector miss)"}`);
}

/** Cross-platform Cmd+K / Ctrl+K. */
async function pressPaletteShortcut(page) {
  const isMac = process.platform === "darwin";
  await page.keyboard.press(`${isMac ? "Meta" : "Control"}+KeyK`);
}

/* ──────────────────────────────────────────────
   Per-scene capture functions
   ────────────────────────────────────────────── */

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => { /* SSE keeps it busy; ignore */ });
  await page.waitForTimeout(500);
}

/**
 * Write a `@2x` twin alongside `path` so srcset references that mention
 * `path 1x, path@2x.png 2x` resolve. Playwright captures with a
 * deviceScaleFactor of 2, so both files are pixel-identical here; the twin
 * exists to satisfy the markup contract rather than to provide a higher
 * physical resolution.
 */
async function writeRetinaTwin(path) {
  const twin = path.replace(/\.png$/i, "@2x.png");
  if (twin === path) return;
  await copyFile(path, twin);
  log(`wrote ${twin}`);
}

async function captureHero(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  const out = resolve(MEDIA_DIR, `hero-timeline-${theme}.png`);
  await captureFull(page, out);
  await writeRetinaTwin(out);
}

async function captureRewrite(page, theme) {
  // Best effort: look for the sidebar's Notices/Alerts region.
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  // Sidebar selector is a guess based on the UI layout; fall back to full screenshot.
  const candidates = ["aside", "[data-testid='sidebar']", ".rs-sidebar", "nav[aria-label='Refs']"];
  let selector = null;
  for (const c of candidates) {
    if (await page.$(c)) { selector = c; break; }
  }
  await captureClip(page, resolve(MEDIA_DIR, `demo-01-rewrite-detection-${theme}.png`), selector);
}

async function captureTimeline(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  const candidates = ["main", "[data-testid='commit-timeline']", ".commit-timeline", "[role='main']"];
  let selector = null;
  for (const c of candidates) {
    if (await page.$(c)) { selector = c; break; }
  }
  await captureClip(page, resolve(MEDIA_DIR, `demo-02-commit-timeline-${theme}.png`), selector);
}

async function captureCompare(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  // Try to expand the compare bar if collapsed.
  const compareToggle = await page.$("button:has-text('Compare'), [aria-label*='compare' i]");
  if (compareToggle) {
    await compareToggle.click().catch(() => { /* may already be open */ });
    await page.waitForTimeout(200);
  }
  const candidates = ["[data-testid='compare-bar']", ".compare-bar", "section:has-text('Compare')"];
  let selector = null;
  for (const c of candidates) {
    if (await page.$(c)) { selector = c; break; }
  }
  await captureClip(page, resolve(MEDIA_DIR, `demo-03-compare-bar-${theme}.png`), selector);
}

async function capturePause(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  const pauseBtn = await page.$("button[aria-label*='pause' i], button:has-text('Pause')");
  if (pauseBtn) {
    await pauseBtn.click().catch(() => { /* ignore */ });
    await page.waitForTimeout(500);
  } else {
    warn("pause button not found; capturing full viewport without pause state");
  }
  // Capture the full viewport so the paused top bar (with Resume control)
  // sits above the still timeline — the "paused" state needs to be read in
  // context, not as a 96px stripe.
  await captureFull(page, resolve(MEDIA_DIR, `demo-04-pause-live-updates-${theme}.png`));
}

async function captureCommitDetail(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  // The detail column is the right ~45% of the viewport. The UI has no
  // stable test id for this panel, so clip directly rather than risk grabbing
  // the Compare bar by selector accident.
  const split = Math.floor(VIEWPORT.width * 0.55);
  await page.screenshot({
    path: resolve(MEDIA_DIR, `demo-06-commit-detail-${theme}.png`),
    clip: { x: split, y: 0, width: VIEWPORT.width - split, height: VIEWPORT.height },
  });
}

async function capturePeriodSummary(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  const summaryBtn = await page.$("button[title*='Period summary' i], button:has-text('Summary')");
  if (summaryBtn) {
    await summaryBtn.click().catch(() => { /* ignore */ });
    await page.waitForTimeout(500);
  } else {
    warn("period summary toggle not found; capturing default view");
  }
  await captureFull(page, resolve(MEDIA_DIR, `demo-07-period-summary-${theme}.png`));
}

async function captureCvdTheme(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  const cvdBtn = await page.$("button[aria-label*='CVD' i], button:has-text('CVD')");
  if (cvdBtn) {
    await cvdBtn.click().catch(() => { /* ignore */ });
    await page.waitForTimeout(400);
  } else {
    warn("CVD toggle not found; capturing default theme");
  }
  await captureFull(page, resolve(MEDIA_DIR, `demo-08-cvd-theme-${theme}.png`));
}

async function clickLensTab(page, lensId) {
  // The lens switcher renders a tab per lens with id `lens-tab-${id}`
  // and label "Live" / "Activity" / "Stream". Try the id first, fall back
  // to label-text and aria-controls so the capture survives small markup
  // tweaks.
  const candidates = [
    `#lens-tab-${lensId}`,
    `[aria-controls='lens-panel-${lensId}']`,
    `button:has-text('${lensId.charAt(0).toUpperCase() + lensId.slice(1)}')`,
  ];
  for (const selector of candidates) {
    const handle = await page.$(selector);
    if (handle) {
      await handle.click().catch(() => { /* ignore */ });
      await page.waitForTimeout(400);
      return true;
    }
  }
  return false;
}

async function captureActivityLens(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  const ok = await clickLensTab(page, "activity");
  if (!ok) {
    warn("activity lens tab not found; capturing default lens");
  }
  await captureFull(page, resolve(MEDIA_DIR, `demo-09-activity-lens-${theme}.png`));
}

async function captureStreamLens(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  const ok = await clickLensTab(page, "stream");
  if (!ok) {
    warn("stream lens tab not found; capturing default lens");
  }
  await captureFull(page, resolve(MEDIA_DIR, `demo-10-stream-lens-${theme}.png`));
}

async function captureFileHistory(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);

  // Open the file-history prompt via the top-bar button. The button is
  // labelled "Open file history" (aria-label) and is always rendered, so
  // this is the most reliable entry point.
  const openBtn = await page.$("button[aria-label='Open file history']");
  if (!openBtn) {
    warn("file-history entry button not found; capturing default lens");
    await captureFull(page, resolve(MEDIA_DIR, `demo-11-file-history-${theme}.png`));
    return;
  }
  await openBtn.click().catch(() => { /* ignore */ });

  // The prompt focuses its input on open. Type a path that is virtually
  // certain to exist in any repository being observed (`README.md`).
  const input = await page.waitForSelector("input[type='text'], input[type='search']", { timeout: 1500 }).catch(() => null);
  if (!input) {
    warn("file-history prompt input not found; capturing prompt-less fallback");
    await captureFull(page, resolve(MEDIA_DIR, `demo-11-file-history-${theme}.png`));
    return;
  }
  await input.fill("README.md");
  await page.keyboard.press("Enter");

  // Wait for the FileHistoryView to render. There is no stable test id, so
  // settle on a network-idle pause and a small delay for the related-files
  // panel to fetch.
  await page.waitForTimeout(1200);
  await settle(page);
  await captureFull(page, resolve(MEDIA_DIR, `demo-11-file-history-${theme}.png`));
}

async function capturePalette(page, theme) {
  await page.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await applyTheme(page, theme);
  await settle(page);
  await pressPaletteShortcut(page);
  // Wait for palette to render.
  const palette = await page.waitForSelector("[role='dialog'], [cmdk-root], [data-testid='command-palette']", { timeout: 2000 }).catch(() => null);
  if (!palette) {
    warn("command palette did not open via shortcut; capturing full viewport instead");
  } else {
    await page.waitForTimeout(150);
  }
  await captureFull(page, resolve(MEDIA_DIR, `demo-05-command-palette-${theme}.png`));
  // Close palette to leave UI in a known state.
  await page.keyboard.press("Escape").catch(() => { /* ignore */ });
}

/* ──────────────────────────────────────────────
   OGP card composition (1200×630)
   ────────────────────────────────────────────── */

async function captureOgCard(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  // Synthesise a small standalone card from inline HTML so we don't depend
  // on a build of the LP itself. Wordmark + tagline left, simulated timeline strip right.
  const html = `
  <!doctype html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');
    :root { color-scheme: dark; }
    html, body { margin: 0; height: 100%; background: oklch(0.108 0.006 250); color: oklch(0.985 0.006 250); font-family: 'Inter', system-ui, sans-serif; }
    .card { display: grid; grid-template-columns: 1fr 1fr; height: 100%; padding: 56px; gap: 40px; box-sizing: border-box; }
    .left { display: flex; flex-direction: column; justify-content: space-between; }
    .brand { display: inline-flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 500; }
    .brand svg { color: oklch(0.730 0.135 200); }
    .tag { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; color: oklch(0.760 0.010 250); }
    .head { font-size: 44px; line-height: 1.08; letter-spacing: -0.02em; max-width: 18ch; margin: 0; }
    .meta { color: oklch(0.760 0.010 250); font-size: 16px; }
    .right { background: oklch(0.165 0.008 250); border: 1px solid oklch(0.250 0.008 250); border-radius: 6px; padding: 24px; display: grid; gap: 14px; align-content: start; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; }
    .row { display: grid; grid-template-columns: 90px 1fr auto; gap: 12px; align-items: center; color: oklch(0.760 0.010 250); }
    .row .h { color: oklch(0.985 0.006 250); }
    .row .b { font-variant-numeric: tabular-nums; color: oklch(0.730 0.135 200); }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .b-rew { background: oklch(0.260 0.050 65); color: oklch(0.820 0.100 70); border: 1px solid oklch(0.480 0.090 65); }
    .b-new { background: oklch(0.630 0.155 200 / 0.18); color: oklch(0.820 0.110 200); border: 1px solid oklch(0.450 0.110 200); }
    .b-sig { color: oklch(0.620 0.010 250); }
  </style></head><body>
    <div class="card">
      <div class="left">
        <div>
          <div class="brand">
            <svg viewBox="0 0 32 32" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
              <circle cx="16" cy="16" r="13" opacity="0.7"/>
              <circle cx="16" cy="16" r="7.5" opacity="0.9"/>
              <line x1="3" y1="16" x2="9" y2="16"/><line x1="23" y1="16" x2="29" y2="16"/>
              <circle cx="16" cy="16" r="1.4" fill="currentColor"/>
            </svg>
            <span>Refscope</span>
          </div>
          <div class="tag" style="margin-top:18px">An observatory for your refs.</div>
        </div>
        <h1 class="head">Refs change. Refscope records what changed, and when.</h1>
        <div class="meta">Local-first · Read-only · Allowlist-scoped · MIT</div>
      </div>
      <div class="right">
        <div class="row"><span class="b">9f3c1a2</span><span class="h">main</span><span class="badge b-rew">rewritten</span></div>
        <div class="row"><span class="b">a8f227d</span><span class="h">main^</span><span class="badge b-sig">signature unknown</span></div>
        <div class="row"><span class="b">7e2b4c1</span><span class="h">feat/refscope</span><span class="badge b-new">new</span></div>
        <div class="row"><span class="b">5ad9a08</span><span class="h">feat/refscope</span><span class="badge b-sig">signature unknown</span></div>
        <div class="row"><span class="b">3e1b2c0</span><span class="h">main</span><span class="badge b-sig">merge</span></div>
      </div>
    </div>
  </body></html>`;
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const out = resolve(MEDIA_DIR, "..", "og-card.png");
  await page.screenshot({ path: out, type: "png", fullPage: false });
  log(`wrote ${out}`);
  await ctx.close();
}

/* ──────────────────────────────────────────────
   Main
   ────────────────────────────────────────────── */

async function main() {
  await ensureDir(MEDIA_DIR);

  log(`waiting for UI at ${UI_URL} …`);
  await waitForServer(UI_URL);
  log(`UI is up`);

  const browser = await chromium.launch({ headless: true });
  try {
    for (const theme of THEMES) {
      log(`── theme: ${theme} ──`);
      const ctx = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
        colorScheme: theme === "dark" ? "dark" : "light",
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();

      try { await captureHero(page, theme); }      catch (e) { warn(`hero ${theme}: ${e.message}`); }
      try { await captureRewrite(page, theme); }   catch (e) { warn(`scene 01 ${theme}: ${e.message}`); }
      try { await captureTimeline(page, theme); }  catch (e) { warn(`scene 02 ${theme}: ${e.message}`); }
      try { await captureCompare(page, theme); }   catch (e) { warn(`scene 03 ${theme}: ${e.message}`); }
      try { await capturePause(page, theme); }        catch (e) { warn(`scene 04 ${theme}: ${e.message}`); }
      try { await capturePalette(page, theme); }      catch (e) { warn(`scene 05 ${theme}: ${e.message}`); }
      try { await captureCommitDetail(page, theme); } catch (e) { warn(`scene 06 ${theme}: ${e.message}`); }
      try { await capturePeriodSummary(page, theme); }catch (e) { warn(`scene 07 ${theme}: ${e.message}`); }
      try { await captureCvdTheme(page, theme); }     catch (e) { warn(`scene 08 ${theme}: ${e.message}`); }
      try { await captureActivityLens(page, theme); } catch (e) { warn(`scene 09 ${theme}: ${e.message}`); }
      try { await captureStreamLens(page, theme); }   catch (e) { warn(`scene 10 ${theme}: ${e.message}`); }
      try { await captureFileHistory(page, theme); }  catch (e) { warn(`scene 11 ${theme}: ${e.message}`); }

      await ctx.close();
    }

    log(`── OGP card ──`);
    try { await captureOgCard(browser); } catch (e) { warn(`og-card: ${e.message}`); }
  } finally {
    await browser.close();
  }

  log("done.");
}

main().catch((e) => {
  err(e?.stack ?? String(e));
  process.exit(1);
});
