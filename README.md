# Realtime Git Viewer

Realtime Git Viewer is a web UI concept for inspecting Git history updates as they happen. The current repository contains the product/architecture specification and a Vite React mock UI for the proposed viewer.

## Repository layout

- `docs/spec-v0.md`: product and architecture specification.
- `mock/`: Vite React mock UI.

## Prerequisites

- Node.js 22 or newer.
- Corepack enabled, or pnpm 10.9.0 available on `PATH`.

This repository uses pnpm workspaces from the root. Keep a single root `pnpm-lock.yaml` committed when dependencies are installed or changed.

## Setup

```sh
corepack enable
pnpm install
```

## Development

Start the mock UI from the repository root:

```sh
pnpm dev
```

Equivalent explicit command:

```sh
pnpm dev:mock
```

## Build

Build the mock UI from the repository root:

```sh
pnpm build
```

Equivalent explicit command:

```sh
pnpm build:mock
```
