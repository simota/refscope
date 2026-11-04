import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aheadBehindRevListArgs,
  createGitService,
  parseAheadBehindCounts,
} from "../src/gitService.js";

test("aheadBehindRevListArgs ends option parsing before the symmetric range", () => {
  const base = "1111111111111111111111111111111111111111";
  const target = "2222222222222222222222222222222222222222";
  assert.deepEqual(aheadBehindRevListArgs(base, target), [
    "rev-list",
    "--left-right",
    "--count",
    "--end-of-options",
    `${base}...${target}`,
  ]);
});

test("parseAheadBehindCounts reads left as behind and right as ahead", () => {
  assert.deepEqual(parseAheadBehindCounts("3\t7\n"), { ahead: 7, behind: 3 });
  assert.deepEqual(parseAheadBehindCounts("0\t0\n"), { ahead: 0, behind: 0 });
  // Malformed output degrades to zero, like the previous per-side parse.
  assert.deepEqual(parseAheadBehindCounts(""), { ahead: 0, behind: 0 });
  assert.deepEqual(parseAheadBehindCounts("x\ty"), { ahead: 0, behind: 0 });
});

// Ahead/behind must equal the two independent `rev-list --count` walks the
// API used before, including across merges and a criss-cross merge (two
// merge bases), where symmetric-difference shortcuts are easiest to get wrong.
test("drift and compare counts match independent rev-list walks across merges", async () => {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rtgv-ahead-behind-")));
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "A");
    git(repoPath, "config", "user.email", "a@example.test");
    commit(repoPath, "seed");
    git(repoPath, "checkout", "-b", "x");
    commit(repoPath, "x1");
    git(repoPath, "checkout", "main");
    commit(repoPath, "m1");
    git(repoPath, "checkout", "-b", "y");
    commit(repoPath, "y1");
    // Criss-cross: main merges x, x merges main's pre-merge tip.
    const mainBefore = git(repoPath, "rev-parse", "main").trim();
    git(repoPath, "checkout", "main");
    git(repoPath, "merge", "--no-ff", "-m", "merge x into main", "x");
    git(repoPath, "checkout", "x");
    git(repoPath, "merge", "--no-ff", "-m", "merge main into x", mainBefore);
    commit(repoPath, "x2");
    git(repoPath, "checkout", "main");
    commit(repoPath, "m2");
    git(repoPath, "merge", "--no-ff", "-m", "merge y", "y");
    git(repoPath, "branch", "same", "main");
    git(repoPath, "checkout", "--orphan", "lonely");
    commit(repoPath, "unrelated root");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };
    const branches = ["main", "x", "y", "same", "lonely"];

    for (const base of branches) {
      const drift = await service.getRefDrift(repo, new URLSearchParams({ base }));
      assert.equal(drift.status, 200);
      const baseHash = git(repoPath, "rev-parse", base).trim();
      for (const entry of drift.body.refs) {
        assert.deepEqual(
          { ahead: entry.ahead, behind: entry.behind },
          expectedCounts(repoPath, baseHash, entry.hash),
          `drift ${entry.name} vs ${base}`,
        );
      }

      for (const target of branches) {
        const compare = await service.compareRefs(repo, new URLSearchParams({ base, target }));
        assert.equal(compare.status, 200);
        const targetHash = git(repoPath, "rev-parse", target).trim();
        assert.deepEqual(
          { ahead: compare.body.ahead, behind: compare.body.behind },
          expectedCounts(repoPath, baseHash, targetHash),
          `compare ${base}..${target}`,
        );
      }
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

function expectedCounts(repoPath, baseHash, targetHash) {
  return {
    ahead: Number(git(repoPath, "rev-list", "--count", targetHash, "--not", baseHash).trim()),
    behind: Number(git(repoPath, "rev-list", "--count", baseHash, "--not", targetHash).trim()),
  };
}

function commit(repoPath, message) {
  git(repoPath, "commit", "--allow-empty", "-m", message);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
