#!/usr/bin/env node
// Reproducible static quality metrics used by docs/quality/sqi-report.md.
// Pure Node (no dependencies). Run from the repository root:
//   node scripts/quality/static-metrics.mjs
// Every metric is a count over tracked source; definitions are inline so the
// numbers can be re-derived by hand.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const UI_SRC = path.join(ROOT, "apps/ui/src");
const API_SRC = path.join(ROOT, "apps/api/src");

function walk(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

const uiFiles = walk(path.join(UI_SRC, "app"), [".ts", ".tsx"]);
const uiCss = walk(path.join(UI_SRC, "styles"), [".css"]);
const read = (f) => fs.readFileSync(f, "utf8");

// M1: --rs-* custom properties referenced via var() but never declared.
const declared = new Set();
for (const f of [...uiFiles, ...uiCss]) {
  for (const m of read(f).matchAll(/(--rs-[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
  // Inline style objects that set a custom property: ['--rs-x' as string]
  for (const m of read(f).matchAll(/['"](--rs-[a-z0-9-]+)['"]\s*(?:as string)?\]?\s*:/g)) declared.add(m[1]);
}
const undefinedUses = {};
for (const f of uiFiles) {
  for (const m of read(f).matchAll(/var\((--rs-[a-z0-9-]+)\s*([,)])/g)) {
    // A var() with a fallback is not broken; only bare references count.
    if (!declared.has(m[1]) && m[2] === ")") undefinedUses[m[1]] = (undefinedUses[m[1]] || 0) + 1;
  }
}

// M2: inline `outline: 'none' | 0` declarations in UI components (focus-ring killers).
let inlineOutlineNone = 0;
for (const f of uiFiles) {
  inlineOutlineNone += (read(f).match(/outline:\s*(['"]none['"]|0\b|['"]0['"])/g) || []).length;
}

// M3: hardcoded font sizes below 11px in UI components.
let tinyFont = 0;
for (const f of uiFiles) {
  tinyFont += (read(f).match(/fontSize:\s*(['"]?)(8|9|10)(px)?\1\s*[,}]/g) || []).length;
}

// M4: API modules that import node:child_process (only gitRunner.js is allowed).
const apiFiles = walk(API_SRC, [".js"]);
const childProcessImporters = apiFiles
  .filter((f) => /from\s+["']node:child_process["']/.test(read(f)))
  .map((f) => path.relative(ROOT, f));

// M5: API import cycles (local ESM imports only).
const graph = new Map();
for (const f of apiFiles) {
  const deps = [...read(f).matchAll(/from\s+["']\.\/([a-zA-Z]+\.js)["']/g)].map((m) => m[1]);
  graph.set(path.basename(f), deps);
}
let cycles = 0;
const state = new Map();
function dfs(n) {
  state.set(n, 1);
  for (const d of graph.get(n) || []) {
    if (state.get(d) === 1) cycles++;
    else if (!state.has(d)) dfs(d);
  }
  state.set(n, 2);
}
for (const n of graph.keys()) if (!state.has(n)) dfs(n);

// M6: hardcoded 40-hex object-id regexes in API outside validation.js.
let adHocObjectIdRegex = 0;
for (const f of apiFiles) {
  if (f.endsWith("validation.js")) continue;
  adHocObjectIdRegex += (read(f).match(/\[A-Fa-f0-9\]\{40\}/g) || []).length;
}

// M7: line counts of the two largest modules (descriptive, not scored directly).
const loc = (f) => read(path.join(ROOT, f)).split("\n").length;

const result = {
  undefinedRsTokenUses: undefinedUses,
  undefinedRsTokenUseTotal: Object.values(undefinedUses).reduce((a, b) => a + b, 0),
  inlineOutlineNone,
  fontSizeBelow11px: tinyFont,
  childProcessImporters,
  apiImportCycles: cycles,
  adHocObjectIdRegex,
  loc: {
    "apps/ui/src/app/App.tsx": loc("apps/ui/src/app/App.tsx"),
    "apps/api/src/gitService.js": loc("apps/api/src/gitService.js"),
  },
};
console.log(JSON.stringify(result, null, 2));
