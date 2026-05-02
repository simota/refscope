// Bundle script that prepares `apps/cli` for both local execution and npm
// publishing:
//   1. Copy `apps/api/src/*.js` into `apps/cli/src/bundled-api/` so the
//      published tarball does not depend on the workspace.
//   2. Run `vite build` against the mock with VITE_RTGV_API_BASE_URL=""
//      so the UI fetches the API through relative paths.
//   3. Copy `mock/dist/*` into `apps/cli/src/static/` so the same static
//      tree ships inside the package.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIR = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(CLI_DIR, "..", "..");
const API_SRC = path.join(REPO_ROOT, "apps", "api", "src");
const MOCK_DIST = path.join(REPO_ROOT, "mock", "dist");
const BUNDLED_API_DIR = path.join(CLI_DIR, "src", "bundled-api");
const STATIC_DIR = path.join(CLI_DIR, "src", "static");

run().catch((error) => {
  process.stderr.write(`build: ${error?.stack ?? error}\n`);
  process.exit(1);
});

async function run() {
  if (await isAlreadyBundled() && !process.env.REFSCOPE_BUILD_FORCE) {
    // The repo ships pre-built bundled-api/ and static/ so `npx github:` works
    // without invoking vite. Skip when those exist; pass REFSCOPE_BUILD_FORCE=1
    // to rebuild explicitly.
    log("bundled-api/ and static/ already present, skipping (set REFSCOPE_BUILD_FORCE=1 to override)");
    return;
  }

  log("syncing API source into bundled-api/");
  await syncApiSource();

  log("building mock UI for relative API base");
  await buildMock();

  log("syncing mock dist into static/");
  await syncStaticDist();

  log("done");
}

async function isAlreadyBundled() {
  try {
    await fs.access(path.join(BUNDLED_API_DIR, "config.js"));
    await fs.access(path.join(STATIC_DIR, "index.html"));
    return true;
  } catch {
    return false;
  }
}

async function syncApiSource() {
  await resetDir(BUNDLED_API_DIR);
  const entries = await fs.readdir(API_SRC, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".js")) continue;
    if (entry.name.endsWith(".test.js")) continue;
    await fs.copyFile(path.join(API_SRC, entry.name), path.join(BUNDLED_API_DIR, entry.name));
  }
}

async function buildMock() {
  // Run vite directly so this script works under both pnpm and plain npm
  // (the latter is what `npx github:simota/refscope` triggers).
  const mockDir = path.join(REPO_ROOT, "mock");
  const env = { ...process.env, VITE_RTGV_API_BASE_URL: "" };
  const localBin = path.join(mockDir, "node_modules", ".bin", "vite");
  let viteAvailableLocally = false;
  try {
    await fs.access(localBin);
    viteAvailableLocally = true;
  } catch {
    /* fall through to npx */
  }
  if (viteAvailableLocally) {
    await runProcess(localBin, ["build"], { cwd: mockDir, env });
  } else {
    await runProcess("npx", ["--yes", "vite@6.4.2", "build"], { cwd: mockDir, env });
  }
}

async function syncStaticDist() {
  await resetDir(STATIC_DIR);
  await copyDir(MOCK_DIST, STATIC_DIR);
}

async function resetDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function copyDir(source, destination) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function log(message) {
  process.stdout.write(`[refscope build] ${message}\n`);
}
