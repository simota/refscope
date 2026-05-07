/**
 * Tests for computeCoarseKind — lightweight coarse structural classifier (D-2).
 *
 * computeCoarseKind is a pure function that classifies a commit based on
 * numstat totals (added/deleted line counts). It is intentionally less
 * accurate than classifyFileDiff (D-5) to keep the list endpoint fast.
 *
 * Classification rules (observation → derived label):
 *   - binary entry (added === -1 || deleted === -1) → 'likely_logic'
 *   - linesChanged === 0                            → 'empty'
 *   - symmetry ≥ 0.9 AND linesChanged ≤ 50         → 'likely_refactor'
 *   - otherwise                                     → 'likely_logic'
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCoarseKind } from "../src/gitService.js";

describe("computeCoarseKind — empty commit", () => {
  it("returns 'empty' when both added and deleted are 0", () => {
    assert.equal(computeCoarseKind([], 0, 0), "empty");
  });

  it("returns 'empty' when fileDiffs is empty and totals are 0", () => {
    assert.equal(computeCoarseKind([], 0, 0), "empty");
  });
});

describe("computeCoarseKind — binary files", () => {
  it("returns 'likely_logic' when any file has added === -1", () => {
    assert.equal(
      computeCoarseKind([{ added: -1, deleted: -1 }], 0, 0),
      "likely_logic",
    );
  });

  it("returns 'likely_logic' when mixed binary and text files are present", () => {
    assert.equal(
      computeCoarseKind(
        [
          { added: 10, deleted: 10 },
          { added: -1, deleted: -1 },
        ],
        10,
        10,
      ),
      "likely_logic",
    );
  });
});

describe("computeCoarseKind — likely_refactor (high symmetry, small diff)", () => {
  it("returns 'likely_refactor' for perfect symmetry within 50 lines", () => {
    // added === deleted → symmetry = 1.0, linesChanged = 20 ≤ 50
    assert.equal(computeCoarseKind([], 10, 10), "likely_refactor");
  });

  it("returns 'likely_refactor' for near-symmetry exactly at boundary: 45 added, 50 deleted", () => {
    // symmetry = 1 - |45 - 50| / 50 = 1 - 5/50 = 0.90 ≥ 0.90
    // linesChanged = 95 > 50 → should be likely_logic
    assert.equal(computeCoarseKind([], 45, 50), "likely_logic");
  });

  it("returns 'likely_refactor' for 24 added, 25 deleted (symmetry 0.96, linesChanged 49)", () => {
    // symmetry = 1 - |24 - 25| / 25 = 1 - 1/25 = 0.96 ≥ 0.90
    // linesChanged = 49 ≤ 50
    assert.equal(computeCoarseKind([], 24, 25), "likely_refactor");
  });

  it("returns 'likely_refactor' for 23 added, 25 deleted (symmetry 0.92, linesChanged 48)", () => {
    // symmetry = 1 - |23 - 25| / 25 = 1 - 2/25 = 0.92 ≥ 0.90
    // linesChanged = 48 ≤ 50
    assert.equal(computeCoarseKind([], 23, 25), "likely_refactor");
  });

  it("returns 'likely_refactor' at exact size boundary: 25 added, 25 deleted", () => {
    // linesChanged = 50 ≤ 50, symmetry = 1.0
    assert.equal(computeCoarseKind([], 25, 25), "likely_refactor");
  });
});

describe("computeCoarseKind — likely_logic", () => {
  it("returns 'likely_logic' when linesChanged > 50 even with perfect symmetry", () => {
    // 26 + 26 = 52 > 50 → likely_logic regardless of symmetry
    assert.equal(computeCoarseKind([], 26, 26), "likely_logic");
  });

  it("returns 'likely_logic' for highly asymmetric small diff", () => {
    // 1 added, 20 deleted → symmetry = 1 - 19/20 = 0.05 < 0.90
    assert.equal(computeCoarseKind([], 1, 20), "likely_logic");
  });

  it("returns 'likely_logic' for large refactor (high symmetry but > 50 lines)", () => {
    // Common case: large variable rename across 200 files
    assert.equal(computeCoarseKind([], 200, 200), "likely_logic");
  });

  it("returns 'likely_logic' for 20 added, 10 deleted (asymmetric)", () => {
    // symmetry = 1 - 10/20 = 0.50 < 0.90
    assert.equal(computeCoarseKind([], 20, 10), "likely_logic");
  });

  it("returns 'likely_logic' for 0 added, 30 deleted (full deletion)", () => {
    // symmetry = 1 - 30/30 = 0 < 0.90
    assert.equal(computeCoarseKind([], 0, 30), "likely_logic");
  });
});

describe("computeCoarseKind — edge cases", () => {
  it("handles undefined totals gracefully (defaults to 0)", () => {
    assert.equal(computeCoarseKind([], undefined, undefined), "empty");
  });

  it("handles fileDiffs with zero-line changes alongside non-zero totals", () => {
    const fileDiffs = [{ added: 5, deleted: 5 }];
    assert.equal(computeCoarseKind(fileDiffs, 5, 5), "likely_refactor");
  });
});
