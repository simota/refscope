/**
 * fleet-schema.test.js
 *
 * Validates that `apps/api/schemas/fleet-response.schema.json` correctly
 * describes the Fleet snapshot response shape (proposal §4.1.3 / §5.6).
 *
 * No external schema-validator dependency is used. Instead a lightweight
 * structural checker verifies the JSON Schema meta-constraints (required
 * fields, enum membership, additionalProperties) against sample payloads.
 * This is sufficient because the schema itself is the source of truth; these
 * tests confirm it is syntactically valid JSON and semantically rejects the
 * cases mandated by charter §4 (Layer 1 enforcement).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../schemas/fleet-response.schema.json");

// ─── Load schema once ────────────────────────────────────────────────────────

let schema;
test("fleet-response.schema.json is valid JSON and exists on disk", () => {
  const raw = fs.readFileSync(SCHEMA_PATH, "utf-8");
  schema = JSON.parse(raw);
  assert.ok(schema, "schema should parse without throwing");
});

// ─── Minimal structural validator ────────────────────────────────────────────

/**
 * Very lightweight JSON Schema structural checker.
 * Supports: type, const, enum, required, additionalProperties: false, items.
 * Returns null on success, or a string describing the first violation.
 *
 * @param {unknown} data
 * @param {object} nodeSchema
 * @param {string} [pointer] - JSON Pointer path for error messages
 * @returns {string|null}
 */
function validate(data, nodeSchema, pointer = "") {
  if (nodeSchema.const !== undefined) {
    if (data !== nodeSchema.const) {
      return `${pointer}: expected const ${JSON.stringify(nodeSchema.const)}, got ${JSON.stringify(data)}`;
    }
    return null;
  }

  if (nodeSchema.enum !== undefined) {
    if (!nodeSchema.enum.includes(data)) {
      return `${pointer}: ${JSON.stringify(data)} not in enum ${JSON.stringify(nodeSchema.enum)}`;
    }
    return null;
  }

  if (nodeSchema.type !== undefined) {
    const types = Array.isArray(nodeSchema.type) ? nodeSchema.type : [nodeSchema.type];
    let typeMatch = false;
    if (data === null && types.includes("null")) {
      typeMatch = true;
    } else if (Array.isArray(data) && types.includes("array")) {
      typeMatch = true;
    } else if (typeof data === "number" && Number.isInteger(data) && types.includes("integer")) {
      typeMatch = true;
    } else if (typeof data === "number" && types.includes("number")) {
      typeMatch = true;
    } else if (!Array.isArray(data) && data !== null && types.includes(typeof data)) {
      typeMatch = true;
    }
    if (!typeMatch) {
      const jsType = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
      return `${pointer}: expected type ${JSON.stringify(nodeSchema.type)}, got ${jsType}`;
    }
  }

  // Handle arrays
  if (Array.isArray(data)) {
    if (nodeSchema.items) {
      for (let i = 0; i < data.length; i++) {
        const err = validate(data[i], nodeSchema.items, `${pointer}/${i}`);
        if (err) return err;
      }
    }
    return null;
  }

  // Handle objects
  if (typeof data === "object" && data !== null) {
    if (nodeSchema.required) {
      for (const key of nodeSchema.required) {
        if (!(key in data)) {
          return `${pointer}: missing required field '${key}'`;
        }
      }
    }

    if (nodeSchema.additionalProperties === false && nodeSchema.properties) {
      const allowed = new Set(Object.keys(nodeSchema.properties));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          return `${pointer}: additional property '${key}' is not allowed`;
        }
      }
    }

    if (nodeSchema.properties) {
      for (const [key, subSchema] of Object.entries(nodeSchema.properties)) {
        if (key in data) {
          const err = validate(data[key], subSchema, `${pointer}/${key}`);
          if (err) return err;
        }
      }
    }
  }

  return null;
}

// ─── Sample payloads ─────────────────────────────────────────────────────────

/** @returns {object} A fully valid fleet snapshot response */
function validSample() {
  return {
    version: 1,
    snapshotAt: "2026-05-03T12:00:00.000Z",
    window: "24h",
    repos: [
      {
        repoId: "svc1",
        headShortSha: "a1b2c3d",
        commits24h: 7,
        refMove1h: false,
        worktreeDirty: false,
        lastEventAt: "2026-05-03T11:42:18.000Z",
        status: "ok",
      },
      {
        repoId: "svc2",
        headShortSha: null,
        commits24h: null,
        refMove1h: null,
        worktreeDirty: null,
        lastEventAt: null,
        status: "timeout",
      },
    ],
    estimatedCost: {
      subscribedRepoCount: 2,
      snapshotIntervalMs: 30000,
      gitCallsPerMin: 6,
    },
    notes: {
      untrackedExcluded: false,
      sseAvailable: true,
    },
  };
}

// ─── Schema structural assertions ────────────────────────────────────────────

test("schema declares version const=1", () => {
  assert.equal(schema.properties.version.const, 1);
});

test("schema enforces additionalProperties: false at top level", () => {
  assert.equal(schema.additionalProperties, false);
});

test("schema enforces additionalProperties: false on repo items", () => {
  assert.equal(schema.properties.repos.items.additionalProperties, false);
});

test("schema enforces additionalProperties: false on estimatedCost", () => {
  assert.equal(schema.properties.estimatedCost.additionalProperties, false);
});

test("schema enforces additionalProperties: false on notes", () => {
  assert.equal(schema.properties.notes.additionalProperties, false);
});

test("schema status enum contains exactly the 5 mandated values", () => {
  const statusEnum = schema.properties.repos.items.properties.status.enum;
  assert.deepEqual(
    [...statusEnum].sort(),
    ["git_error", "missing", "ok", "timeout", "unauthorized"],
  );
});

test("schema window enum contains exactly the 4 mandated values", () => {
  assert.deepEqual(
    [...schema.properties.window.enum].sort(),
    ["1h", "24h", "6h", "7d"],
  );
});

// ─── Validator against sample payloads ───────────────────────────────────────

test("valid sample response passes structural validation", () => {
  const err = validate(validSample(), schema);
  assert.equal(err, null, `expected valid sample to pass, got: ${err}`);
});

test("response with extra top-level field is rejected (additionalProperties: false)", () => {
  const sample = { ...validSample(), extra_field: "should-not-be-here" };
  const err = validate(sample, schema);
  assert.ok(err !== null, "expected extra field to cause a validation error");
  assert.match(err, /additional property/);
});

test("response with status value outside enum is rejected", () => {
  const sample = validSample();
  sample.repos[0].status = "hot"; // forbidden derived label (charter §1)
  const err = validate(sample, schema);
  assert.ok(err !== null, "expected invalid status to cause a validation error");
  assert.match(err, /not in enum/);
});

test("response missing required top-level field is rejected", () => {
  const sample = validSample();
  delete sample.snapshotAt;
  const err = validate(sample, schema);
  assert.ok(err !== null, "expected missing snapshotAt to cause a validation error");
  assert.match(err, /missing required field/);
});

test("response with invalid window value is rejected", () => {
  const sample = validSample();
  sample.window = "12h"; // not in enum
  const err = validate(sample, schema);
  assert.ok(err !== null, "expected invalid window to cause a validation error");
  assert.match(err, /not in enum/);
});

test("response with version != 1 is rejected", () => {
  const sample = validSample();
  sample.version = 2;
  const err = validate(sample, schema);
  assert.ok(err !== null, "expected version=2 to cause a validation error");
  assert.match(err, /expected const/);
});

test("repo item with extra field is rejected (additionalProperties: false on items)", () => {
  const sample = validSample();
  sample.repos[0].extra_repo_field = "forbidden";
  const err = validate(sample, schema);
  assert.ok(err !== null, "expected extra repo field to cause a validation error");
  assert.match(err, /additional property/);
});
