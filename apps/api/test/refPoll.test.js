import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { REF_POLL_PRECHECK_MIN_REFS, createGitService } from "../src/gitService.js";

// The live poller reads large ref sets through a ref-store pre-check and a
// per-object cache. Whatever path it takes, every poll must observe exactly
// what a fresh full `listRefs` would, including the internal symref and
// nested-tag markers that event classification relies on.
test("polled ref snapshots match a full ref listing across ref changes", async () => {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rtgv-ref-poll-")));
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "A");
    git(repoPath, "config", "user.email", "a@example.test");
    commit(repoPath, "c1");
    const c1 = rev(repoPath, "HEAD");
    commit(repoPath, "c2");
    const c2 = rev(repoPath, "HEAD");

    // Enough refs that the pre-check path is active.
    const count = REF_POLL_PRECHECK_MIN_REFS + 100;
    const lines = [];
    for (let i = 0; i < count; i += 1) {
      lines.push(`create refs/heads/bulk/b${String(i).padStart(4, "0")} ${i % 2 ? c1 : c2}`);
    }
    git(repoPath, "update-ref", "--stdin", { input: `${lines.join("\n")}\n` });
    git(repoPath, "tag", "-a", "-m", "annotated", "v1", c1);
    git(repoPath, "tag", "-a", "-m", "nested", "v1-nested", "v1");
    git(repoPath, "update-ref", "refs/remotes/origin/main", c2);
    git(repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10_000,
      diffMaxBytes: 65_536,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    let snapshot = await service.getRefSnapshot(repo);
    await assertMatchesFullListing(service, repo, snapshot, "initial");

    const poll = async (label) => {
      const result = await service.collectRefEvents(repo, snapshot);
      snapshot = result.snapshot;
      await assertMatchesFullListing(service, repo, snapshot, label);
      return result.events;
    };

    assert.deepEqual(await poll("steady state"), []);
    assert.deepEqual(await poll("steady state again"), []);

    // Fast-forward onto a commit no ref named before.
    commit(repoPath, "c3");
    const c3 = rev(repoPath, "HEAD");
    let events = await poll("fast-forward");
    assert.deepEqual(
      events.map((event) => [event.type, event.ref.name]),
      [["commit_added", "refs/heads/main"]],
    );

    // Lightweight and annotated tags on new objects, a nested tag chain,
    // a rewrite, a deletion, and a symref retarget, all in one poll.
    git(repoPath, "tag", "light", c3);
    git(repoPath, "tag", "-a", "-m", "a2", "v2", c3);
    git(repoPath, "tag", "-a", "-m", "n2", "v2-nested", "v2");
    git(repoPath, "update-ref", "refs/heads/bulk/b0001", c3);
    git(repoPath, "update-ref", "refs/heads/bulk/b0000", c1);
    git(repoPath, "update-ref", "-d", "refs/heads/bulk/b0002");
    git(repoPath, "update-ref", "refs/remotes/origin/dev", c3);
    git(repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/dev");
    events = await poll("mixed changes");
    const types = new Map(events.map((event) => [event.ref.name, event.type]));
    assert.equal(types.get("refs/tags/light"), "ref_created");
    assert.equal(types.get("refs/tags/v2-nested"), "ref_created");
    assert.equal(types.get("refs/heads/bulk/b0002"), "ref_deleted");
    assert.equal(types.get("refs/heads/bulk/b0000"), "history_rewritten");
    assert.equal(types.get("refs/remotes/origin/HEAD"), "ref_updated");
    assert.equal(snapshot.get("refs/tags/v2-nested").hash, c3);

    // A public symref into a hidden namespace is never listed.
    git(repoPath, "update-ref", "refs/notes/commits", c3);
    git(repoPath, "symbolic-ref", "refs/heads/sneaky", "refs/notes/commits");
    events = await poll("hidden symref");
    assert.deepEqual(events, []);
    assert.equal(snapshot.has("refs/heads/sneaky"), false);

    // Many refs move onto objects already named elsewhere: served from the
    // per-object cache.
    const moves = [];
    for (let i = 3; i < count; i += 1) {
      moves.push(`update refs/heads/bulk/b${String(i).padStart(4, "0")} ${c3}`);
    }
    git(repoPath, "update-ref", "--stdin", { input: `${moves.join("\n")}\n` });
    await poll("mass move to known objects");

    // Many refs appear on objects never seen: the poller falls back to a
    // full read.
    let stream = "";
    for (let i = 0; i < 300; i += 1) {
      const message = `fresh ${i}\n`;
      stream +=
        `commit refs/heads/fresh/f${i}\n` +
        `committer A <a@example.test> ${1_700_000_000 + i} +0000\n` +
        `data ${message.length}\n${message}from ${c3}\n\n`;
    }
    git(repoPath, "fast-import", "--quiet", { input: stream });
    events = await poll("mass creation on new objects");
    assert.equal(events.filter((event) => event.type === "ref_created").length, 300);
    assert.deepEqual(await poll("steady state after mass update"), []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

async function assertMatchesFullListing(service, repo, snapshot, label) {
  const full = await service.listRefs(repo);
  assert.deepEqual(
    [...snapshot.values()].map(describeRef),
    full.map(describeRef),
    label,
  );
}

function describeRef(ref) {
  return { ...ref, symref: ref.symref ?? null, nestedTag: ref.nestedTag ?? false };
}

function commit(repoPath, message) {
  git(repoPath, "commit", "--allow-empty", "-m", message);
}

function rev(repoPath, name) {
  return git(repoPath, "rev-parse", name).trim();
}

function git(cwd, ...args) {
  const options = typeof args.at(-1) === "object" ? args.pop() : {};
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input: options.input,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
