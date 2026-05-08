// Brand contract test (cross-cutting: not API-specific).
// Lives under apps/api/test/ because that is the repo's `node --test` runner;
// see CLAUDE.md > Commands. It validates docs/brand/tokens.json — specifically
// the light/dark parity invariant required by the D3 verdict
// (docs/magi-verdict-2026-05-08-r7-designer.md).
//
// Invariant: every leaf token under
//     color.semantic.{warning,error,success,info}.light
// must have a matching leaf under the corresponding `.dark` group, with the
// same key set. Color tokens with no `.light/.dark` split (neutral/accent/
// semantic-role) are out of scope here — single-mode tokens are verified by
// the export script's group-mode walker, not by this parity test.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(__dirname, "..", "..", "..", "docs/brand/tokens.json");

async function loadTokens() {
  const raw = await readFile(TOKENS_PATH, "utf8");
  return JSON.parse(raw);
}

function leafKeys(node) {
  if (node === null || typeof node !== "object") return [];
  return Object.keys(node).filter((k) => !k.startsWith("$"));
}

const SEMANTIC_GROUPS = ["warning", "error", "success", "info"];

test("tokens.json: every semantic color group has both .light and .dark", async () => {
  const tokens = await loadTokens();
  const semantic = tokens.color?.semantic;
  assert.ok(semantic, "color.semantic group is missing");
  for (const group of SEMANTIC_GROUPS) {
    const node = semantic[group];
    assert.ok(node, `color.semantic.${group} is missing`);
    assert.ok(node.light, `color.semantic.${group}.light is missing`);
    assert.ok(node.dark, `color.semantic.${group}.dark is missing`);
  }
});

test("tokens.json: .light and .dark have identical key sets in every semantic group", async () => {
  const tokens = await loadTokens();
  const semantic = tokens.color?.semantic;
  for (const group of SEMANTIC_GROUPS) {
    const lightKeys = leafKeys(semantic[group].light).sort();
    const darkKeys = leafKeys(semantic[group].dark).sort();
    assert.deepEqual(
      lightKeys,
      darkKeys,
      `color.semantic.${group}: .light keys [${lightKeys.join(", ")}] do not match .dark keys [${darkKeys.join(", ")}]`,
    );
  }
});

test("tokens.json: every leaf in .light/.dark carries a parseable OKLCH $value", async () => {
  const tokens = await loadTokens();
  const semantic = tokens.color?.semantic;
  // Same OKLCH parser shape as the export script — restated here so the test
  // does not depend on the script's internals.
  const oklchPattern = /^oklch\(\s*[^)]+\s*\)$/;
  for (const group of SEMANTIC_GROUPS) {
    for (const mode of ["light", "dark"]) {
      const modeNode = semantic[group][mode];
      for (const key of leafKeys(modeNode)) {
        const leaf = modeNode[key];
        assert.ok(
          leaf && typeof leaf === "object" && "$value" in leaf,
          `color.semantic.${group}.${mode}.${key} is not a token leaf`,
        );
        assert.match(
          leaf.$value,
          oklchPattern,
          `color.semantic.${group}.${mode}.${key} $value is not OKLCH: ${leaf.$value}`,
        );
      }
    }
  }
});

test("tokens.json: required semantic leaves (bg, fg, border) are present in every group/mode", async () => {
  const tokens = await loadTokens();
  const semantic = tokens.color?.semantic;
  // Required leaves match what tailwind-theme.css and rs-* surface CSS consume.
  const required = ["bg", "fg", "border"];
  for (const group of SEMANTIC_GROUPS) {
    for (const mode of ["light", "dark"]) {
      const modeNode = semantic[group][mode];
      for (const key of required) {
        assert.ok(
          modeNode[key] && "$value" in modeNode[key],
          `color.semantic.${group}.${mode}.${key} is missing`,
        );
      }
    }
  }
});
