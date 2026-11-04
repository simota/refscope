// UI design-token contract (cross-cutting: not API-specific).
// Lives under apps/api/test/ because that is the repo's `node --test` runner
// (same convention as tokensParity.test.js).
//
// Invariant: every `var(--rs-*)` referenced by the product UI without a
// fallback is declared somewhere — in apps/ui/src/styles/*.css or as a custom
// property set inline by a component (e.g. `['--rs-volley-color' as string]`).
// An undefined custom property does not error: the declaration silently
// becomes `inherit`/`initial`, which rendered SVG labels black on the dark
// canvas before this test existed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_SRC = path.resolve(__dirname, "..", "..", "ui", "src");

function walk(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

test("ui: every referenced --rs-* token is declared", () => {
  const sources = walk(path.join(UI_SRC, "app"), [".ts", ".tsx"]);
  const styles = walk(path.join(UI_SRC, "styles"), [".css"]);
  const declared = new Set();
  for (const file of [...sources, ...styles]) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/(--rs-[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
    for (const m of text.matchAll(/['"](--rs-[a-z0-9-]+)['"]\s*(?:as string)?\]?\s*:/g)) declared.add(m[1]);
  }
  assert.ok(declared.has("--rs-bg-canvas"), "token stylesheet not found");

  const missing = [];
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/var\((--rs-[a-z0-9-]+)\s*\)/g)) {
      if (!declared.has(m[1])) missing.push(`${path.relative(UI_SRC, file)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `undeclared --rs-* tokens:\n${missing.join("\n")}`);
});
