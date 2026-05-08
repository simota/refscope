#!/usr/bin/env node
// One-way export: docs/brand/tokens.json → Figma REST API variables payload.
//
// Outputs a JSON file that a designer or release script can POST to
//   POST /v1/files/:file_key/variables
// or import via Figma's Variables import flow.
//
// Scope:
//   - Color tokens (color.neutral, color.accent, color.semantic.*, color.semantic-role.*)
//     are exported as Figma COLOR variables. Semantic colors with `.light`/`.dark`
//     branches become a single variable with two modes; other color tokens become
//     single-mode variables in the same collection.
//   - Typography font-size, font-weight, line-height, letter-spacing → FLOAT.
//   - Spacing, border-radius → FLOAT (px).
//   - z-index → FLOAT.
//   - Motion duration → FLOAT (ms).
// Out of scope (Figma cannot represent these as variables, surfaced as a notes block
// in the output):
//   - Elevation (multi-stop box-shadow strings)
//   - Motion easing (cubic-bezier arrays)
//   - Font family arrays (Figma does not support array variables)
//
// OKLCH → sRGB conversion is inlined (no new npm dependency, per the project's
// dependency-conservative posture). Algorithm: OKLCH → OKLab → linear sRGB → sRGB.
// Reference: Björn Ottosson's "A perceptual color space for image processing"
//   (https://bottosson.github.io/posts/oklab/).
//
// Usage:
//   node scripts/tokens/export-figma-variables.mjs
//   node scripts/tokens/export-figma-variables.mjs --out path/to/output.json
//
// Exit codes:
//   0 — success
//   1 — tokens.json missing or unparseable
//   2 — unrecoverable conversion error (out-of-gamut color etc.)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const TOKENS_PATH = resolve(REPO_ROOT, "docs/brand/tokens.json");
const DEFAULT_OUT = resolve(REPO_ROOT, "docs/brand/figma-variables.export.json");

// ---- OKLCH → sRGB ----------------------------------------------------------

// Parse `oklch(L C H)` or `oklch(L C H / A)` into [L, C, H, A?].
// Refscope uses no alpha in tokens.json, but elevation strings (out of scope here)
// do. We accept alpha for forward compatibility.
function parseOklch(value) {
  const trimmed = value.trim();
  const match = /^oklch\(\s*([^)]+)\s*\)$/.exec(trimmed);
  if (!match) return null;
  const inside = match[1];
  // Split optional `/ A` off first, then by whitespace.
  const [main, alphaPart] = inside.split("/");
  const parts = main.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const L = Number(parts[0]);
  const C = Number(parts[1]);
  const H = Number(parts[2]);
  const A = alphaPart === undefined ? 1 : Number(alphaPart.trim());
  if (
    !Number.isFinite(L) ||
    !Number.isFinite(C) ||
    !Number.isFinite(H) ||
    !Number.isFinite(A)
  ) {
    return null;
  }
  return { L, C, H, A };
}

function oklchToOklab({ L, C, H }) {
  const rad = (H * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

// Björn Ottosson's M2⁻¹ matrix: OKLab → linear sRGB via the LMS intermediate.
function oklabToLinearSrgb({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function linearToSrgbChannel(c) {
  // Clamp first so out-of-gamut values do not produce NaN at the gamma step.
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function oklchToSrgb(oklch) {
  const lab = oklchToOklab(oklch);
  const lin = oklabToLinearSrgb(lab);
  return {
    r: linearToSrgbChannel(lin.r),
    g: linearToSrgbChannel(lin.g),
    b: linearToSrgbChannel(lin.b),
    a: oklch.A,
  };
}

// ---- Token tree walking -----------------------------------------------------

// A token leaf in DTCG format has `$value` (and optionally `$type`, `$description`).
// References are written as `{path.to.token}`.
function isTokenLeaf(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    Object.prototype.hasOwnProperty.call(node, "$value")
  );
}

function isReference(value) {
  return typeof value === "string" && /^\{[^{}]+\}$/.test(value);
}

function resolveReference(reference, root) {
  const path = reference.slice(1, -1).split(".");
  let cursor = root;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = cursor[segment];
  }
  if (!isTokenLeaf(cursor)) return null;
  // Recursively follow chains.
  if (isReference(cursor.$value)) return resolveReference(cursor.$value, root);
  return cursor;
}

function inferType(node, parentType) {
  if (node.$type) return node.$type;
  return parentType ?? null;
}

// Walk the tree and yield {path, leaf, inheritedType} for every leaf.
function* walkTokens(node, root, path = [], inheritedType = null) {
  if (node === null || typeof node !== "object") return;
  const localType = node.$type ?? inheritedType;
  if (isTokenLeaf(node)) {
    yield { path, leaf: node, type: inferType(node, inheritedType) };
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    yield* walkTokens(child, root, [...path, key], localType);
  }
}

// ---- Figma variable construction -------------------------------------------

const COLLECTION_NAME = "Refscope Tokens";
const LIGHT_DARK_COLLECTION_NAME = "Refscope Tokens — modes";
const MODE_LIGHT = "Light";
const MODE_DARK = "Dark";

function dotPath(path) {
  return path.join("/");
}

function pxNumber(value) {
  if (typeof value !== "string") return null;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

function msNumber(value) {
  if (typeof value !== "string") return null;
  const m = /^(-?\d+(?:\.\d+)?)ms$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

function emNumber(value) {
  if (typeof value !== "string") return null;
  const m = /^(-?\d+(?:\.\d+)?)em$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

function buildColorValue(rawValue, root) {
  let target = rawValue;
  if (isReference(rawValue)) {
    const resolved = resolveReference(rawValue, root);
    if (!resolved) return null;
    target = resolved.$value;
  }
  if (typeof target !== "string") return null;
  const oklch = parseOklch(target);
  if (!oklch) return null;
  const { r, g, b, a } = oklchToSrgb(oklch);
  return { type: "COLOR", value: { r, g, b, a } };
}

// Detect a `.light`/`.dark` mode pair under a parent semantic node.
// The walker yields each leaf separately; we group them up here.
function groupModes(leaves) {
  const groups = new Map();
  for (const entry of leaves) {
    const { path } = entry;
    const idx = path.findIndex((seg) => seg === "light" || seg === "dark");
    if (idx === -1) {
      // single-mode token — key by its full path
      const key = `single:${dotPath(path)}`;
      groups.set(key, { kind: "single", path, light: entry, dark: null });
      continue;
    }
    const before = path.slice(0, idx);
    const after = path.slice(idx + 1);
    const mode = path[idx];
    const groupPath = [...before, ...after];
    const key = `pair:${dotPath(groupPath)}`;
    const existing = groups.get(key) ?? {
      kind: "pair",
      path: groupPath,
      light: null,
      dark: null,
    };
    existing[mode] = entry;
    groups.set(key, existing);
  }
  return groups;
}

function buildVariables(tokens) {
  const variables = [];
  const skipped = [];

  // ---- Color tokens ----
  const colorLeaves = [...walkTokens(tokens.color, tokens, ["color"], "color")];
  const colorGroups = groupModes(colorLeaves);
  for (const group of colorGroups.values()) {
    const name = dotPath(group.path);
    if (group.kind === "pair") {
      const lightVal = group.light
        ? buildColorValue(group.light.leaf.$value, tokens)
        : null;
      const darkVal = group.dark
        ? buildColorValue(group.dark.leaf.$value, tokens)
        : null;
      if (!lightVal || !darkVal) {
        skipped.push({ name, reason: "incomplete light/dark pair or unparseable OKLCH" });
        continue;
      }
      variables.push({
        name,
        resolvedType: "COLOR",
        scopes: ["ALL_FILLS", "STROKE_COLOR"],
        description:
          group.light?.leaf.$description ??
          group.dark?.leaf.$description ??
          undefined,
        valuesByMode: {
          [MODE_LIGHT]: lightVal.value,
          [MODE_DARK]: darkVal.value,
        },
      });
    } else {
      const val = buildColorValue(group.light.leaf.$value, tokens);
      if (!val) {
        skipped.push({ name, reason: "unparseable OKLCH or unresolved reference" });
        continue;
      }
      variables.push({
        name,
        resolvedType: "COLOR",
        scopes: ["ALL_FILLS", "STROKE_COLOR"],
        description: group.light.leaf.$description,
        valuesByMode: { [MODE_LIGHT]: val.value, [MODE_DARK]: val.value },
      });
    }
  }

  // ---- Typography ----
  for (const { path, leaf, type } of walkTokens(
    tokens.typography,
    tokens,
    ["typography"],
    "typography",
  )) {
    const name = dotPath(path);
    if (type === "fontFamily") {
      // Figma variables do not support array values; record as a string list note.
      skipped.push({ name, reason: "fontFamily arrays are not Figma variables" });
      continue;
    }
    if (type === "dimension") {
      const px = pxNumber(leaf.$value);
      const em = emNumber(leaf.$value);
      const numeric = px ?? em;
      if (numeric === null) {
        skipped.push({ name, reason: `unsupported dimension '${leaf.$value}'` });
        continue;
      }
      variables.push({
        name,
        resolvedType: "FLOAT",
        scopes: ["ALL_SCOPES"],
        description: `${leaf.$description ?? ""} (${leaf.$value})`.trim(),
        valuesByMode: { [MODE_LIGHT]: numeric, [MODE_DARK]: numeric },
      });
      continue;
    }
    if (type === "fontWeight" || type === "number") {
      variables.push({
        name,
        resolvedType: "FLOAT",
        scopes: ["ALL_SCOPES"],
        description: leaf.$description,
        valuesByMode: { [MODE_LIGHT]: leaf.$value, [MODE_DARK]: leaf.$value },
      });
      continue;
    }
    skipped.push({ name, reason: `unhandled typography type '${type}'` });
  }

  // ---- Spacing & border-radius (dimension under top-level $type) ----
  for (const groupKey of ["spacing", "border-radius"]) {
    for (const { path, leaf } of walkTokens(
      tokens[groupKey],
      tokens,
      [groupKey],
      "dimension",
    )) {
      const name = dotPath(path);
      const px = pxNumber(leaf.$value);
      if (px === null) {
        skipped.push({ name, reason: `unsupported dimension '${leaf.$value}'` });
        continue;
      }
      variables.push({
        name,
        resolvedType: "FLOAT",
        scopes: ["ALL_SCOPES"],
        description: leaf.$description,
        valuesByMode: { [MODE_LIGHT]: px, [MODE_DARK]: px },
      });
    }
  }

  // ---- Motion duration ----
  if (tokens.motion?.duration) {
    for (const { path, leaf } of walkTokens(
      tokens.motion.duration,
      tokens,
      ["motion", "duration"],
      "duration",
    )) {
      const name = dotPath(path);
      const ms = msNumber(leaf.$value);
      if (ms === null) {
        skipped.push({ name, reason: `unsupported duration '${leaf.$value}'` });
        continue;
      }
      variables.push({
        name,
        resolvedType: "FLOAT",
        scopes: ["ALL_SCOPES"],
        description: `${leaf.$description ?? ""} (${leaf.$value})`.trim(),
        valuesByMode: { [MODE_LIGHT]: ms, [MODE_DARK]: ms },
      });
    }
  }

  // ---- Easing (cubic-bezier) — out of scope ----
  if (tokens.motion?.easing) {
    for (const { path } of walkTokens(
      tokens.motion.easing,
      tokens,
      ["motion", "easing"],
      "cubicBezier",
    )) {
      skipped.push({
        name: dotPath(path),
        reason: "cubic-bezier arrays are not Figma variables",
      });
    }
  }

  // ---- Z-index ----
  if (tokens["z-index"]) {
    for (const { path, leaf } of walkTokens(
      tokens["z-index"],
      tokens,
      ["z-index"],
      "number",
    )) {
      variables.push({
        name: dotPath(path),
        resolvedType: "FLOAT",
        scopes: ["ALL_SCOPES"],
        description: leaf.$description,
        valuesByMode: { [MODE_LIGHT]: leaf.$value, [MODE_DARK]: leaf.$value },
      });
    }
  }

  // ---- Elevation (shadow strings) — out of scope ----
  if (tokens.elevation) {
    for (const { path } of walkTokens(
      tokens.elevation,
      tokens,
      ["elevation"],
      "shadow",
    )) {
      skipped.push({
        name: dotPath(path),
        reason: "multi-stop shadow strings are not Figma variables",
      });
    }
  }

  return { variables, skipped };
}

function buildPayload({ variables, skipped }, sourceMeta) {
  return {
    $meta: {
      generatedAt: new Date().toISOString(),
      generatedFrom: "docs/brand/tokens.json",
      generator: "scripts/tokens/export-figma-variables.mjs",
      sourceVersion: sourceMeta?.version ?? null,
      collectionName: COLLECTION_NAME,
      modes: [MODE_LIGHT, MODE_DARK],
      notes: [
        "OKLCH → sRGB conversion uses Björn Ottosson's OKLab matrices.",
        "Single-mode color tokens (neutral/accent/semantic-role) write the same value to both modes.",
        "Two-mode color tokens (semantic.warning|error|success|info.{light,dark}) collapse the .light/.dark suffix into mode entries.",
        "Skipped tokens are listed under $meta.skipped and are not exported (shadows, cubicBezier arrays, fontFamily arrays).",
      ],
      skipped,
    },
    variableCollections: [
      {
        name: COLLECTION_NAME,
        modes: [{ name: MODE_LIGHT }, { name: MODE_DARK }],
      },
    ],
    variables: variables.map((v) => ({
      ...v,
      variableCollection: COLLECTION_NAME,
    })),
  };
}

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const out = { outPath: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out.outPath = resolve(process.cwd(), argv[++i]);
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      out.help = true;
    }
  }
  return out;
}

const HELP = `Usage: node scripts/tokens/export-figma-variables.mjs [--out path]

Exports docs/brand/tokens.json to a Figma REST API variables payload (JSON).

Options:
  --out <path>   Output path (default: docs/brand/figma-variables.export.json)
  -h, --help     Show this help.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  let raw;
  try {
    raw = await readFile(TOKENS_PATH, "utf8");
  } catch (error) {
    process.stderr.write(`Could not read ${TOKENS_PATH}: ${error.message}\n`);
    process.exit(1);
  }

  let tokens;
  try {
    tokens = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`tokens.json is not valid JSON: ${error.message}\n`);
    process.exit(1);
  }

  const built = buildVariables(tokens);
  const payload = buildPayload(built, tokens.$meta);

  await mkdir(dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const total = built.variables.length;
  const skipped = built.skipped.length;
  process.stdout.write(
    `Wrote ${total} variables (${skipped} skipped) to ${args.outPath}\n`,
  );
}

// Allow this module to be imported (for tests) without running main().
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`Export failed: ${error.message}\n`);
    process.exit(2);
  });
}

export {
  parseOklch,
  oklchToSrgb,
  buildVariables,
  buildPayload,
  isTokenLeaf,
  resolveReference,
};
