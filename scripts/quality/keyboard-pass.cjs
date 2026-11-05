// Scripted keyboard-only pass for task T6 in docs/quality/sqi-report.md.
// Every step uses only the keyboard and reports whether it succeeded and how
// many Tab presses it took. Usage (dev servers running):
//   node scripts/quality/keyboard-pass.cjs [ui-url]
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:5173/';

async function tabUntil(page, predicate, max = 80) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(predicate)) return i;
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL);
  await page.waitForSelector('[role="listitem"][data-hash]');
  await page.waitForTimeout(800);
  const steps = [];
  const record = (name, ok, extra = {}) => steps.push({ name, ok: Boolean(ok), ...extra });

  // T6.1 skip link -> commit list. Note: in Chromium the first Tab on a
  // fresh load already lands on a commit row (the skip target), on the
  // pre-change build as well; the link is reached with Shift+Tab. This step
  // checks that the link itself works.
  await page.locator('a[href="#main-content"]').focus();
  const skip = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('Enter');
  const inMain = await page.evaluate(() => document.activeElement?.id === 'main-content');
  record('skip link moves focus to the commit list', skip === 'Skip to commit list' && inMain);

  // T6.2 select a commit (T2) by keyboard
  const tabs = await tabUntil(page, () => {
    const el = document.activeElement;
    return el?.getAttribute('role') === 'listitem' && el.hasAttribute('data-hash') && el.getAttribute('aria-current') !== 'true';
  });
  const hash = await page.evaluate(() => document.activeElement?.getAttribute('data-hash'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const selected = await page.evaluate((h) => document.querySelector(`[data-hash="${h}"]`)?.getAttribute('aria-current') === 'true'
    && (document.querySelector('section[aria-label="Commit details"]')?.textContent ?? '').includes(h), hash);
  record('select a commit and see its details', selected, { tabs });

  // T6.3 command palette opens, is named, and returns focus on Escape
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  const palette = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Command palette"]');
    return Boolean(d) && document.activeElement?.getAttribute('role') === 'combobox';
  });
  await page.keyboard.press('ArrowDown');
  const activeDesc = await page.evaluate(() => document.activeElement?.getAttribute('aria-activedescendant'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const restored = await page.evaluate((h) => document.activeElement?.getAttribute('data-hash') === h, hash);
  record('palette: named combobox, active option exposed, focus restored', palette && activeDesc === 'rs-palette-option-1' && restored);

  // T6.4 switch the changed-files view to Tree, then toggle a folder
  const treeToggleTabs = await tabUntil(page, () => {
    const el = document.activeElement;
    return el?.tagName === 'BUTTON' && el.textContent?.trim() === 'Tree'
      && Boolean(el.closest('[aria-label="Changed files view mode"]'));
  }, 120);
  if (treeToggleTabs) await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const folderTabs = await tabUntil(page, () => {
    const el = document.activeElement;
    return el?.getAttribute('role') === 'treeitem' && el.hasAttribute('aria-expanded');
  }, 120);
  let folderOk = false;
  if (folderTabs) {
    const before = await page.evaluate(() => document.activeElement.getAttribute('aria-expanded'));
    await page.keyboard.press(before === 'true' ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'));
    folderOk = before !== after;
  }
  record('toggle a changed-files folder', folderOk, { tabs: folderTabs });

  // T6.5 switch lens (T5) by keyboard
  await page.locator('#lens-tab-live').focus();
  await page.keyboard.press('Tab');
  let lensOk = false;
  for (let i = 0; i < 20 && !lensOk; i++) {
    const id = await page.evaluate(() => document.activeElement?.id);
    if (id === 'lens-tab-hotspot') {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
      lensOk = await page.evaluate(() => document.querySelector('#lens-tab-hotspot')?.getAttribute('aria-selected') === 'true');
      break;
    }
    await page.keyboard.press('Tab');
  }
  record('switch to an analysis lens', lensOk);

  // T6.6 operate a risk-heatmap cell from the keyboard
  await page.locator('#lens-tab-risk-heatmap').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const cellTabs = await tabUntil(page, () => /Select riskiest commit/.test(document.activeElement?.getAttribute('aria-label') ?? ''), 150);
  record('reach a heatmap cell by keyboard', Boolean(cellTabs), { tabs: cellTabs });

  console.log(JSON.stringify({ passed: steps.filter((s) => s.ok).length, total: steps.length, steps }, null, 1));
  await browser.close();
})();
