// Insights: tag releases reachable from a ref, and path ownership.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService } from "../src/gitService.js";
import { createRequestHandler } from "../src/http.js";
import {
  OWNERS_COMMIT_CAP,
  aggregatePathOwners,
  parseTagList,
  pathOwnersArgs,
  rangeAuthorsArgs,
  summarizeRange,
  tagListArgs,
} from "../src/insightsService.js";

const H1 = "1111111111111111111111111111111111111111";
const H2 = "2222222222222222222222222222222222222222";
const H3 = "3333333333333333333333333333333333333333";

// ─── Pure helpers ───────────────────────────────────────────────────────────

test("tagListArgs filters by reachability and reads no free text", () => {
  const args = tagListArgs(H1, true);
  assert.equal(args[0], "for-each-ref");
  assert.ok(args.includes(`--merged=${H1}`));
  assert.ok(tagListArgs(H1, false).includes(`--no-merged=${H1}`));
  assert.equal(args.at(-1), "refs/tags");
  assert.ok(!/contents|subject|taggername|body/.test(args.join(" ")));
});

test("parseTagList keeps commit tags, peels one annotation, drops the rest, newest first", () => {
  const line = (...fields) => fields.join("\0");
  const out = [
    line("refs/tags/v1", H1, "commit", "", "", "100", "100", "", ""),
    line("refs/tags/v2", H2, "tag", H3, "commit", "300", "", "200", ""),
    line("refs/tags/tree-tag", H1, "tag", H2, "tree", "400", "", "", ""),
    line("refs/tags/nested", H1, "tag", H2, "tag", "500", "", "", ""),
    line("refs/tags/alias", H1, "commit", "", "", "600", "600", "", "refs/tags/v1"),
    line("refs/heads/x", H1, "commit", "", "", "700", "700", "", ""),
    line("refs/tags/short", H1, "commit"),
  ].join("\n");
  const tags = parseTagList(out);
  assert.deepEqual(
    tags.map((tag) => [tag.shortName, tag.commit, tag.annotated]),
    [
      ["v2", H3, true],
      ["v1", H1, false],
    ],
  );
  assert.equal(tags[0].taggedAt, new Date(300_000).toISOString());
  assert.equal(tags[0].committedAt, new Date(200_000).toISOString());
});

test("rangeAuthorsArgs keeps tip and ^base as separate tokens after --end-of-options", () => {
  const args = rangeAuthorsArgs(H2, H1);
  const end = args.indexOf("--end-of-options");
  assert.deepEqual(args.slice(end + 1), [H2, `^${H1}`, "--"]);
  assert.deepEqual(rangeAuthorsArgs(H2, null).slice(end + 1), [H2, "--"]);
});

test("summarizeRange counts commits and distinct contributors, ignoring junk lines", () => {
  const out = [`${H1}\0a@x\0A`, `${H2}\0A@X\0A again`, `${H3}\0\0Nameonly`, "garbage", ""].join("\n");
  assert.deepEqual(summarizeRange(out), { commitCount: 3, contributorCount: 2, truncated: false });
});

test("pathOwnersArgs passes the pathspec after -- and excludes merges", () => {
  const args = pathOwnersArgs(H1, ":(literal,top)src");
  assert.ok(args.includes("--no-merges") && args.includes("--numstat"));
  assert.deepEqual(args.slice(-3), [H1, "--", ":(literal,top)src"]);
  assert.deepEqual(pathOwnersArgs(H1, null).slice(-2), [H1, "--"]);
});

test("aggregatePathOwners groups by e-mail, sums churn, and computes the majority set", () => {
  const rec = (hash, name, email, seconds, ...numstat) =>
    `\x1e${hash}\0${name}\0${email}\0${seconds}\n\n${numstat.join("\n")}\n`;
  const out =
    rec(H1, "Ann New", "ANN@x", 1000, "3\t1\tsrc/a.js", "-\t-\timg.png") +
    rec(H2, "Ann Old", "ann@x", 500, "2\t0\tsrc/b.js") +
    rec(H3, "Bob", "bob@x", 900, "10\t5\t\"weird\\tpath\"") +
    "\x1enot-a-hash\0Eve\0eve@x\0" + "1\n" +
    // Git C-quotes control characters in numstat paths, so a path cannot
    // carry a raw record separator; the quoted form is just a path.
    rec(H1, "Ann New", "ann@x", 100, `1\t1\t"x\\036${H2}"`);
  const result = aggregatePathOwners(out, { recentSinceMs: 800_000 });
  assert.equal(result.scannedCommits, 4);
  assert.equal(result.authors.length, 2);
  const [ann, bob] = result.authors;
  assert.equal(ann.author, "Ann New");
  assert.deepEqual(ann.authorAliases, ["Ann Old"]);
  assert.deepEqual(bob.authorAliases ?? [], []);
  assert.equal(ann.commits, 3);
  assert.equal(ann.added, 6);
  assert.equal(ann.deleted, 2);
  assert.equal(ann.binaryChanges, 1);
  assert.equal(ann.recentCommits, 1);
  assert.equal(ann.lastChangedAt, new Date(1_000_000).toISOString());
  assert.equal(ann.firstChangedAt, new Date(100_000).toISOString());
  assert.equal(bob.commits, 1);
  assert.equal(bob.added, 10);
  assert.equal(result.majorityAuthors, 1);
  assert.equal(result.lastChangedAt, new Date(1_000_000).toISOString());
});

test("aggregatePathOwners stops at the commit cap and reports truncation", () => {
  let out = "";
  for (let i = 0; i <= OWNERS_COMMIT_CAP; i += 1) out += `\x1e${H1}\0A\0a@x\0${i}\n`;
  const result = aggregatePathOwners(out, { recentSinceMs: 0 });
  assert.equal(result.scannedCommits, OWNERS_COMMIT_CAP);
  assert.equal(result.truncated, true);
});

// ─── Against a real repository ──────────────────────────────────────────────

test("getReleases lists reachable tags with per-release counts and unreleased commits", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "a.txt", "1\n");
    commit(repoPath, "first", "Ann", "ann@x", "2024-01-01T00:00:00Z");
    git(repoPath, "tag", "v0.1.0");
    write(repoPath, "a.txt", "2\n");
    commit(repoPath, "second", "Bob", "bob@x", "2024-02-01T00:00:00Z");
    write(repoPath, "a.txt", "3\n");
    commit(repoPath, "third", "Ann", "ann@x", "2024-03-01T00:00:00Z");
    git(repoPath, "tag", "-a", "v0.2.0", "-m", "Release 0.2.0");
    write(repoPath, "a.txt", "4\n");
    commit(repoPath, "fourth", "Cid", "cid@x", "2024-04-01T00:00:00Z");
    // A tag on another line is counted but not listed.
    git(repoPath, "checkout", "-q", "-b", "side", "v0.1.0");
    write(repoPath, "b.txt", "side\n");
    commit(repoPath, "side", "Ann", "ann@x", "2024-05-01T00:00:00Z");
    git(repoPath, "tag", "side-1");
    git(repoPath, "checkout", "-q", "main");
    // A tag of a tree is not a release.
    git(repoPath, "tag", "tree-tag", git(repoPath, "rev-parse", "HEAD^{tree}").trim());

    const { service, repo } = setup(repoPath);
    const result = await service.getReleases(repo, new URLSearchParams(""));
    assert.equal(result.status, 200);
    const body = result.body;
    assert.deepEqual(
      body.releases.map((r) => [r.shortName, r.annotated, r.commitCount, r.contributorCount, r.previous?.shortName ?? null]),
      [
        ["v0.2.0", true, 2, 2, "v0.1.0"],
        ["v0.1.0", false, 1, 1, null],
      ],
    );
    assert.equal(body.releases[0].name, "refs/tags/v0.2.0");
    assert.deepEqual(
      [body.unreleased.since.shortName, body.unreleased.commitCount, body.unreleased.contributorCount],
      ["v0.2.0", 1, 1],
    );
    assert.equal(body.totalTags, 2);
    assert.equal(body.otherTagCount, 1);
    assert.equal(body.truncated, false);

    const side = await service.getReleases(repo, new URLSearchParams("ref=refs/heads/side&limit=1"));
    assert.equal(side.status, 200);
    assert.deepEqual(side.body.releases.map((r) => r.shortName), ["side-1"]);
    assert.equal(side.body.releases[0].previous.shortName, "v0.1.0");
    assert.equal(side.body.releases[0].commitCount, 1);
    assert.equal(side.body.unreleased.commitCount, 0);
    assert.equal(side.body.truncated, true);

    assert.equal((await service.getReleases(repo, new URLSearchParams("ref=--output=x"))).status, 400);
    assert.equal((await service.getReleases(repo, new URLSearchParams("ref=nope"))).status, 404);
    assert.equal((await service.getReleases(repo, new URLSearchParams("limit=0"))).status, 400);
    assert.equal((await service.getReleases(repo, new URLSearchParams("ref=a&ref=b"))).status, 400);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

function noMergedCount(repoPath, commit) {
  return parseTagList(git(repoPath, ...tagListArgs(commit, false))).length;
}

test("getReleases otherTagCount equals the --no-merged count across tag kinds", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "a.txt", "1\n");
    commit(repoPath, "first", "Ann", "ann@x", "2024-01-01T00:00:00Z");
    git(repoPath, "tag", "v1");
    git(repoPath, "checkout", "-q", "-b", "side");
    write(repoPath, "b.txt", "side\n");
    commit(repoPath, "side", "Bob", "bob@x", "2024-02-01T00:00:00Z");
    git(repoPath, "tag", "side-light");
    git(repoPath, "tag", "-a", "side-annotated", "-m", "side");
    // A tag of a tag and a tag of a tree are not release candidates either way.
    git(repoPath, "tag", "-a", "side-nested", "-m", "nested", "side-annotated");
    git(repoPath, "tag", "side-tree", git(repoPath, "rev-parse", "HEAD^{tree}").trim());
    git(repoPath, "checkout", "-q", "main");
    write(repoPath, "a.txt", "2\n");
    commit(repoPath, "second", "Ann", "ann@x", "2024-03-01T00:00:00Z");
    git(repoPath, "tag", "-a", "v2", "-m", "two");

    const { service, repo } = setup(repoPath);
    for (const ref of ["HEAD", "refs/heads/side", "v1"]) {
      const result = await service.getReleases(repo, new URLSearchParams({ ref }));
      assert.equal(result.status, 200);
      assert.equal(result.body.otherTagCount, noMergedCount(repoPath, result.body.commit), ref);
    }
    const head = await service.getReleases(repo, new URLSearchParams(""));
    assert.equal(head.body.otherTagCount, 2);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getReleases counts other tags through the reachability read when a tag object is missing", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "a.txt", "1\n");
    commit(repoPath, "first", "Ann", "ann@x", "2024-01-01T00:00:00Z");
    git(repoPath, "tag", "v1");
    git(repoPath, "checkout", "-q", "-b", "side");
    write(repoPath, "b.txt", "side\n");
    commit(repoPath, "side", "Bob", "bob@x", "2024-02-01T00:00:00Z");
    git(repoPath, "tag", "side-1");
    git(repoPath, "checkout", "-q", "main");
    // The plain tag list stops on this ref; --merged / --no-merged skip it.
    fs.appendFileSync(path.join(repoPath, ".git", "packed-refs"), `${H1} refs/tags/broken\n`);

    const { service, repo } = setup(repoPath);
    const result = await service.getReleases(repo, new URLSearchParams(""));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.releases.map((r) => r.shortName), ["v1"]);
    assert.equal(result.body.otherTagCount, 1);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getReleases reports no release when nothing is tagged", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "a.txt", "1\n");
    commit(repoPath, "first", "Ann", "ann@x", "2024-01-01T00:00:00Z");
    const { service, repo } = setup(repoPath);
    const result = await service.getReleases(repo, new URLSearchParams(""));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.releases, []);
    assert.equal(result.body.unreleased, null);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getPathOwners ranks authors of a folder and of a single file", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "src/a.js", "a\n");
    write(repoPath, "docs/readme.md", "r\n");
    commit(repoPath, "init", "Ann", "ann@x", "2024-01-01T00:00:00Z");
    write(repoPath, "src/a.js", "a\nb\nc\n");
    commit(repoPath, "grow", "Bob", "bob@x", "2024-05-01T00:00:00Z");
    write(repoPath, "src/b.js", "x\n");
    const head = commit(repoPath, "add b", "Bob", "BOB@x", "2024-06-01T00:00:00Z");
    write(repoPath, "docs/readme.md", "r2\n");
    const tip = commit(repoPath, "docs", "Cid", "cid@x", "2024-06-02T00:00:00Z");

    const { service, repo } = setup(repoPath);
    const folder = await service.getPathOwners(repo, new URLSearchParams(`commit=${tip}&path=src`));
    assert.equal(folder.status, 200);
    assert.equal(folder.body.path, "src");
    assert.equal(folder.body.scannedCommits, 3);
    assert.deepEqual(
      folder.body.authors.map((a) => [a.author, a.commits, a.added, a.deleted, a.recentCommits]),
      [
        ["Bob", 2, 3, 0, 2],
        ["Ann", 1, 1, 0, 0],
      ],
    );
    assert.equal(folder.body.majorityAuthors, 1);
    assert.equal(folder.body.recentWindowDays, 90);

    const file = await service.getPathOwners(repo, new URLSearchParams(`commit=${head}&path=docs/readme.md`));
    assert.deepEqual(file.body.authors.map((a) => a.author), ["Ann"]);

    const whole = await service.getPathOwners(repo, new URLSearchParams(`commit=${tip}&limit=1`));
    assert.equal(whole.body.authors.length, 1);
    assert.equal(whole.body.authorCount, 3);

    // The pathspec is literal: magic in the client path does not apply.
    const magic = await service.getPathOwners(repo, new URLSearchParams(`commit=${tip}&path=*.js`));
    assert.equal(magic.status, 200);
    assert.equal(magic.body.scannedCommits, 0);

    assert.equal((await service.getPathOwners(repo, new URLSearchParams("commit=HEAD"))).status, 400);
    assert.equal((await service.getPathOwners(repo, new URLSearchParams(`commit=${"f".repeat(40)}`))).status, 404);
    assert.equal((await service.getPathOwners(repo, new URLSearchParams(`commit=${tip}&path=../x`))).status, 400);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("insight routes are reachable over HTTP", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "a.txt", "hello\n");
    const head = commit(repoPath, "init", "Ann", "ann@x", "2024-01-01T00:00:00Z");
    git(repoPath, "tag", "v1");
    const config = makeConfig(repoPath);
    const handler = createRequestHandler(config, createGitService(config));
    const releases = await call(handler, "/api/repos/demo/releases?ref=HEAD");
    assert.equal(releases.status, 200);
    assert.equal(releases.body.releases[0].shortName, "v1");
    const owners = await call(handler, `/api/repos/demo/paths/owners?commit=${head}&path=a.txt`);
    assert.equal(owners.status, 200);
    assert.equal(owners.body.authors[0].author, "Ann");
    assert.equal((await call(handler, "/api/repos/nope/releases")).status, 404);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function tempRepo() {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "refscope-insights-")));
  git(repoPath, "init", "-q", "-b", "main");
  git(repoPath, "config", "user.name", "Refscope Test");
  git(repoPath, "config", "user.email", "refscope@example.test");
  git(repoPath, "config", "core.logAllRefUpdates", "true");
  return repoPath;
}

function write(repoPath, rel, content) {
  const target = path.join(repoPath, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commit(repoPath, message, name = "Refscope Test", email = "refscope@example.test", date = "2024-01-01T00:00:00Z") {
  git(repoPath, "add", "-A");
  gitEnv(repoPath, { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, "commit", "-q", "-m", message);
  return git(repoPath, "rev-parse", "HEAD").trim();
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function makeConfig(repoPath) {
  return {
    repositories: new Map([["demo", { id: "demo", name: "demo", path: repoPath }]]),
    gitTimeoutMs: 10_000,
    diffMaxBytes: 4_000_000,
    refPollMs: 1000,
    allowedOrigins: new Set(),
    enforceLoopbackHost: false,
  };
}

function setup(repoPath) {
  const config = makeConfig(repoPath);
  return { service: createGitService(config), repo: config.repositories.get("demo") };
}

async function call(handler, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let status = 0;
    let body = "";
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return headers[name.toLowerCase()];
      },
      writeHead(code, extra) {
        status = code;
        Object.assign(headers, extra ?? {});
      },
      end(chunk) {
        if (chunk) body += chunk;
        try {
          resolve({ status, body: body ? JSON.parse(body) : null });
        } catch (error) {
          reject(error);
        }
      },
      write(chunk) {
        body += chunk;
      },
    };
    const req = { method: "GET", url, headers: { host: "127.0.0.1:4175" }, on() {} };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function gitEnv(cwd, env, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}
