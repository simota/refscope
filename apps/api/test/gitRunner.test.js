import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GitCommandError, buildGitEnv, runGit } from "../src/gitRunner.js";

test("builds a non-interactive local-only git environment", () => {
  const env = buildGitEnv({
    HOME: "/tmp/rtgv-home",
    GIT_DIR: "/tmp/other/.git",
    GIT_NO_LAZY_FETCH: "0",
    GIT_TERMINAL_PROMPT: "1",
    GIT_PAGER: "/tmp/unsafe-git-pager",
    PAGER: "/tmp/unsafe-pager",
    GIT_OPTIONAL_LOCKS: "1",
    GIT_ATTR_NOSYSTEM: "0",
    GIT_CONFIG_GLOBAL: "/tmp/unsafe.gitconfig",
    SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
    SSH_AGENT_PID: "12345",
    SSH_ASKPASS: "/tmp/ssh-askpass",
    SSH_ASKPASS_REQUIRE: "force",
    HTTP_PROXY: "http://user:secret@proxy.example.test:8080",
    HTTPS_PROXY: "http://user:secret@secure-proxy.example.test:8080",
    ALL_PROXY: "socks5://user:secret@proxy.example.test:1080",
    NO_PROXY: "localhost,127.0.0.1",
    http_proxy: "http://user:secret@lower-proxy.example.test:8080",
    GCM_INTERACTIVE: "always",
    GCM_CREDENTIAL_STORE: "plaintext",
    GCM_TRACE: "/tmp/gcm-trace.log",
  });

  assert.equal(env.HOME, "/tmp/rtgv-home");
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_NO_REPLACE_OBJECTS, "1");
  assert.equal(env.GIT_NO_LAZY_FETCH, "1");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_PAGER, "cat");
  assert.equal(env.PAGER, "cat");
  assert.equal(env.GIT_OPTIONAL_LOCKS, "0");
  assert.equal(env.GIT_ATTR_NOSYSTEM, "1");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.match(env.GIT_CONFIG_GLOBAL, /^(\/dev\/null|NUL)$/);
  assert.equal(env.SSH_AUTH_SOCK, undefined);
  assert.equal(env.SSH_AGENT_PID, undefined);
  assert.equal(env.SSH_ASKPASS, undefined);
  assert.equal(env.SSH_ASKPASS_REQUIRE, undefined);
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.ALL_PROXY, undefined);
  assert.equal(env.NO_PROXY, undefined);
  assert.equal(env.http_proxy, undefined);
  assert.equal(env.GCM_INTERACTIVE, undefined);
  assert.equal(env.GCM_CREDENTIAL_STORE, undefined);
  assert.equal(env.GCM_TRACE, undefined);
});

test("rejects explicit git pager options", async () => {
  const repoPath = createTempPath("rtgv-runner-pager-");
  try {
    git(repoPath, "init", "-b", "main");

    assert.throws(
      () => runGit(
        { id: "demo", name: "demo", path: repoPath },
        ["--paginate", "status"],
        { timeoutMs: 5000, maxBytes: 1024 },
      ),
      /Git pager options are not allowed/,
    );

    assert.throws(
      () => runGit(
        { id: "demo", name: "demo", path: repoPath },
        ["-p", "status"],
        { timeoutMs: 5000, maxBytes: 1024 },
      ),
      /Git pager options are not allowed/,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("rejects leading git global options", async () => {
  const repoPath = createTempPath("rtgv-runner-global-options-");
  try {
    git(repoPath, "init", "-b", "main");

    for (const args of [
      ["-c", "core.pager=/tmp/unsafe-pager", "status"],
      ["--git-dir", "/tmp/other/.git", "status"],
      ["--work-tree", "/tmp/other", "status"],
      ["--namespace", "hidden", "status"],
    ]) {
      assert.throws(
        () => runGit(
          { id: "demo", name: "demo", path: repoPath },
          args,
          { timeoutMs: 5000, maxBytes: 1024 },
        ),
        /Git global options are not allowed/,
      );
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("rejects git commands outside the API read allowlist", async () => {
  const repoPath = createTempPath("rtgv-runner-command-");
  try {
    git(repoPath, "init", "-b", "main");

    assert.throws(
      () => runGit(
        { id: "demo", name: "demo", path: repoPath },
        ["status", "--short"],
        { timeoutMs: 5000, maxBytes: 1024 },
      ),
      /Git command is not allowed/,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("rejects git output file options before spawning git", async () => {
  const repoPath = createTempPath("rtgv-runner-output-option-");
  try {
    git(repoPath, "init", "-b", "main");

    for (const args of [
      ["diff", "--output=/tmp/rtgv-diff.patch", "HEAD"],
      ["diff", "--output", "/tmp/rtgv-diff.patch", "HEAD"],
    ]) {
      assert.throws(
        () => runGit(
          { id: "demo", name: "demo", path: repoPath },
          args,
          { timeoutMs: 5000, maxBytes: 1024 },
        ),
        /Git output file options are not allowed/,
      );
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("rejects git no-index diff before spawning git", async () => {
  const repoPath = createTempPath("rtgv-runner-no-index-");
  try {
    git(repoPath, "init", "-b", "main");

    assert.throws(
      () => runGit(
        { id: "demo", name: "demo", path: repoPath },
        ["diff", "--no-index", "/tmp/rtgv-left", "/tmp/rtgv-right"],
        { timeoutMs: 5000, maxBytes: 1024 },
      ),
      /Git no-index diff is not allowed/,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("rejects invalid git timeout and output bounds before spawning git", () => {
  const repoPath = createTempPath("rtgv-runner-limits-");
  try {
    git(repoPath, "init", "-b", "main");

    for (const options of [
      { timeoutMs: 0, maxBytes: 1024 },
      { timeoutMs: Number.POSITIVE_INFINITY, maxBytes: 1024 },
      { timeoutMs: 2_147_483_648, maxBytes: 1024 },
      { timeoutMs: 5000, maxBytes: 0 },
      { timeoutMs: 5000, maxBytes: Number.POSITIVE_INFINITY },
      { timeoutMs: 5000, maxBytes: 16 * 1024 * 1024 + 1 },
    ]) {
      assert.throws(
        () => runGit(
          { id: "demo", name: "demo", path: repoPath },
          ["log", "-1", "--format=%H"],
          options,
        ),
        /Git (timeoutMs|maxBytes) must be a positive safe integer/,
      );
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("rejects non-absolute repository paths before spawning git", () => {
  assert.throws(
    () => runGit(
      { id: "demo", name: "demo", path: "relative/repo" },
      ["log", "-1", "--format=%H"],
      { timeoutMs: 5000, maxBytes: 1024 },
    ),
    /Git repository path must be absolute/,
  );
});

test("rejects non-git repository paths before spawning git", () => {
  const repoPath = createTempPath("rtgv-runner-non-git-");
  try {
    assert.throws(
      () => runGit(
        { id: "demo", name: "demo", path: repoPath },
        ["log", "-1", "--format=%H"],
        { timeoutMs: 5000, maxBytes: 1024 },
      ),
      /Git repository path must be a Git working tree root/,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("rejects non-canonical repository paths before spawning git", () => {
  const repoPath = createTempPath("rtgv-runner-canonical-");
  const linkPath = `${repoPath}-link`;
  try {
    git(repoPath, "init", "-b", "main");
    fs.symlinkSync(repoPath, linkPath, "dir");

    assert.throws(
      () => runGit(
        { id: "demo", name: "demo", path: linkPath },
        ["log", "-1", "--format=%H"],
        { timeoutMs: 5000, maxBytes: 1024 },
      ),
      /Git repository path must be canonical/,
    );
  } finally {
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("ignores repository replacement refs during git reads", async () => {
  const repoPath = createTempPath("rtgv-runner-replace-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "original\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "original commit");
    const originalCommit = git(repoPath, "rev-parse", "HEAD").trim();

    fs.writeFileSync(path.join(repoPath, "README.md"), "replacement\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "replacement commit");
    const replacementCommit = git(repoPath, "rev-parse", "HEAD").trim();
    git(repoPath, "replace", originalCommit, replacementCommit);

    const { stdout } = await runGit(
      { id: "demo", name: "demo", path: repoPath },
      ["show", "-s", "--format=%s", originalCommit],
      { timeoutMs: 5000, maxBytes: 1024 },
    );

    assert.equal(stdout.trim(), "original commit");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("bounds git stderr output with the same maxBytes limit", async () => {
  const repoPath = createTempPath("rtgv-runner-stderr-");
  try {
    git(repoPath, "init", "-b", "main");

    await assert.rejects(
      runGit(
        { id: "demo", name: "demo", path: repoPath },
        ["cat-file", "-t", "x".repeat(2048)],
        { timeoutMs: 5000, maxBytes: 64 },
      ),
      (error) => {
        assert.equal(error instanceof GitCommandError, true);
        assert.equal(error.truncated, true);
        assert.equal(error.stderr.length, 0);
        return true;
      },
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("ignores inherited git environment repository overrides", async () => {
  const repoPath = createTempPath("rtgv-runner-env-");
  const otherRepoPath = createTempPath("rtgv-runner-env-other-");
  const originalGitDir = process.env.GIT_DIR;
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "allowed\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "allowed repository commit");

    git(otherRepoPath, "init", "-b", "main");
    git(otherRepoPath, "config", "user.name", "Realtime Test");
    git(otherRepoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(otherRepoPath, "README.md"), "other\n");
    git(otherRepoPath, "add", "README.md");
    git(otherRepoPath, "commit", "-m", "other repository commit");

    process.env.GIT_DIR = path.join(otherRepoPath, ".git");
    const { stdout } = await runGit(
      { id: "demo", name: "demo", path: repoPath },
      ["log", "-1", "--format=%s"],
      { timeoutMs: 5000, maxBytes: 1024 },
    );

    assert.equal(stdout.trim(), "allowed repository commit");
  } finally {
    if (originalGitDir == null) {
      delete process.env.GIT_DIR;
    } else {
      process.env.GIT_DIR = originalGitDir;
    }
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(otherRepoPath, { recursive: true, force: true });
  }
});

test("ignores user global git configuration during git reads", async () => {
  const repoPath = createTempPath("rtgv-runner-global-config-");
  const homePath = createTempPath("rtgv-runner-home-");
  const originalHome = process.env.HOME;
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "allowed\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "allowed repository commit");
    const fullHash = git(repoPath, "rev-parse", "HEAD").trim();

    fs.writeFileSync(
      path.join(homePath, ".gitconfig"),
      [
        "[core]",
        "\tabbrev = 40",
        "",
      ].join("\n"),
    );

    process.env.HOME = homePath;

    const { stdout } = await runGit(
      { id: "demo", name: "demo", path: repoPath },
      ["log", "-1", "--abbrev-commit", "--format=%h"],
      { timeoutMs: 5000, maxBytes: 1024 },
    );

    assert.notEqual(stdout.trim(), fullHash);
  } finally {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(homePath, { recursive: true, force: true });
  }
});

function createTempPath(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
  return result.stdout;
}
