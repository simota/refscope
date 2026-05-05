#!/usr/bin/env node
// Entry shim for the `refscope` bin. The shim only exists so the published
// package has a stable, minimal launcher; all logic lives in src/cli.mjs.

import { run } from "../src/cli.mjs";

run(process.argv.slice(2)).catch((error) => {
  // Top-level safety net. Specific failures should already have printed a
  // user-facing message and exited; reaching this branch means an unexpected
  // throw escaped the orchestration code.
  process.stderr.write(`refscope: ${error?.message ?? error}\n`);
  process.exit(1);
});
