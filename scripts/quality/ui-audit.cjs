// Reproducible UI audit: axe-core (WCAG 2.x A/AA), focus-indicator check,
// mobile horizontal overflow, time-to-commit-list, screenshots.
// Usage (API + UI dev servers running, e.g. `make dev-self`):
//   AXE_PATH=/path/to/axe-core/axe.min.js OUT_DIR=/tmp/out node scripts/quality/ui-audit.cjs <label>
// axe-core is a measurement tool only; it is not a project dependency.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
const label = process.argv[2] || 'run';
const OUT = path.resolve(process.env.OUT_DIR || '.', label);
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.UI_URL || 'http://127.0.0.1:5173/';
const LENSES = ['live', 'stream', 'hotspot', 'risk-trend', 'risk-heatmap', 'co-change', 'drift', 'outbox', 'digest', 'rescue', 'symbol', 'flight'];

async function axe(page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
}

async function focusAudit(page) {
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null && !(e instanceof SVGElement));
    // SVG nodes are excluded: the graph lenses draw their focus ring as a
    // sibling shape, which computed outline/box-shadow cannot observe.
    const bad = [];
    for (const el of els) {
      el.focus();
      if (document.activeElement !== el) continue;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      if (!ring) bad.push((el.tagName + '.' + (el.className?.baseVal ?? el.className ?? '')).slice(0, 80) + ' ' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30));
    }
    return { focusables: els.length, noIndicator: bad.length, samples: bad.slice(0, 8) };
  });
}

(async () => {
  const browser = await chromium.launch();
  const result = { label, views: {} };
  // Desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(BASE);
  await page.waitForSelector('[role="listitem"]', { timeout: 20000 }).catch(() => {});
  result.timeToCommitListMs = Date.now() - t0;
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/desktop-live.png` });
  result.views.live = { axe: await axe(page), focus: await focusAudit(page) };
  for (const lens of LENSES.slice(1)) {
    const tab = page.locator(`#lens-tab-${lens}`);
    if (!(await tab.count())) { result.views[lens] = { missing: true }; continue; }
    await tab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/desktop-${lens}.png` });
    result.views[lens] = { axe: await axe(page), focus: await focusAudit(page) };
  }
  await page.locator('#lens-tab-live').click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/desktop-palette.png` });
  result.views.palette = { axe: await axe(page) };
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/desktop-help.png` });
  result.views.help = { axe: await axe(page) };
  result.pageErrors = errors;
  await ctx.close();
  // Mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const mp = await m.newPage();
  await mp.goto(BASE);
  await mp.waitForLoadState('networkidle').catch(() => {});
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: `${OUT}/mobile-live.png` });
  result.mobile = await mp.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  await m.close();
  await browser.close();
  // Summary
  const agg = {};
  let focusBad = 0;
  for (const [v, d] of Object.entries(result.views)) {
    for (const x of d.axe || []) agg[x.id] = (agg[x.id] || 0) + x.nodes;
    focusBad += d.focus?.noIndicator || 0;
  }
  result.summary = { axeNodesByRule: agg, axeTotalNodes: Object.values(agg).reduce((a, b) => a + b, 0), focusNoIndicatorTotal: focusBad };
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ summary: result.summary, t: result.timeToCommitListMs, mobile: result.mobile, errors: errors.length }, null, 1));
})();
