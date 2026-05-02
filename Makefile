SHELL := /bin/bash

PNPM ?= pnpm
RTGV_REPOS ?=
VITE_RTGV_API_BASE_URL ?= http://127.0.0.1:4175
UI_HOST ?= 127.0.0.1
UI_PORT ?= 5173
RTGV_REF_POLL_MS ?=
MAX_ITERATIONS ?= 30

.DEFAULT_GOAL := help

.PHONY: help install dev dev-self dev-app dev-api dev-ui validate-repos build build-api build-ui test test-api verify audit orbit recover clean status

help:
	@printf "Realtime Git Viewer commands\n\n"
	@printf "Setup:\n"
	@printf "  make install                         Install dependencies from lockfile\n"
	@printf "\nDevelopment:\n"
	@printf "  make dev                             Start UI on 127.0.0.1:5173\n"
	@printf "  make dev-self                        Start API and UI for this repository\n"
	@printf "  make dev-app RTGV_REPOS=id=/repo     Start API and UI together\n"
	@printf "  make dev-api RTGV_REPOS=id=/repo     Start API with allowlisted Git repos\n"
	@printf "  make dev-ui                          Start UI with API base URL\n"
	@printf "\nBuild and test:\n"
	@printf "  make build                           Build API and UI\n"
	@printf "  make build-api                       Syntax-check API\n"
	@printf "  make build-ui                        Build UI\n"
	@printf "  make test                            Run configured tests\n"
	@printf "  make verify                          Run full Orbit verification gate\n"
	@printf "  make audit                           Run high-severity dependency audit\n"
	@printf "\nAutomation:\n"
	@printf "  make orbit MAX_ITERATIONS=30         Run Orbit implementation loop\n"
	@printf "  make recover                         Run Orbit recovery script\n"
	@printf "\nMaintenance:\n"
	@printf "  make clean                           Remove generated build output\n"
	@printf "  make status                          Show git status\n"

install:
	$(PNPM) install --frozen-lockfile

dev:
	$(MAKE) dev-ui

dev-self:
	$(MAKE) dev-app RTGV_REPOS="viewer=$(CURDIR)"

dev-app: validate-repos
	@if [[ -z "$(RTGV_REPOS)" ]]; then \
		echo "RTGV_REPOS is required, e.g. make dev-app RTGV_REPOS=viewer=/absolute/path"; \
		echo "For the current repository, run: make dev-self"; \
		exit 1; \
	fi
	@set -euo pipefail; \
	echo "Starting Realtime Git Viewer"; \
	echo "  API:  $(VITE_RTGV_API_BASE_URL)"; \
	echo "  UI:   http://$(UI_HOST):$(UI_PORT)"; \
	echo "  Repos: $(RTGV_REPOS)"; \
	echo ""; \
	RTGV_REPOS="$(RTGV_REPOS)" RTGV_REF_POLL_MS="$(RTGV_REF_POLL_MS)" $(PNPM) dev:api & \
	api_pid=$$!; \
	trap 'kill $$api_pid 2>/dev/null || true' EXIT INT TERM; \
	VITE_RTGV_API_BASE_URL="$(VITE_RTGV_API_BASE_URL)" $(PNPM) dev:ui -- --host "$(UI_HOST)" --port "$(UI_PORT)" --strictPort

dev-api: validate-repos
	@if [[ -z "$(RTGV_REPOS)" ]]; then \
		echo "RTGV_REPOS is required, e.g. make dev-api RTGV_REPOS=viewer=/absolute/path"; \
		exit 1; \
	fi
	RTGV_REPOS="$(RTGV_REPOS)" RTGV_REF_POLL_MS="$(RTGV_REF_POLL_MS)" $(PNPM) dev:api

validate-repos:
	@RTGV_REPOS="$(RTGV_REPOS)" bash scripts/dev/validate-repos.sh

dev-ui:
	VITE_RTGV_API_BASE_URL="$(VITE_RTGV_API_BASE_URL)" $(PNPM) dev:ui -- --host "$(UI_HOST)" --port "$(UI_PORT)" --strictPort

build:
	$(PNPM) build

build-api:
	$(PNPM) build:api

build-ui:
	$(PNPM) build:ui

test:
	$(PNPM) test

test-api:
	$(PNPM) --filter @realtime-git-viewer/api test

verify:
	bash scripts/orbit/full-implementation/verify.sh

audit:
	$(PNPM) audit --audit-level high

orbit:
	MAX_ITERATIONS="$(MAX_ITERATIONS)" bash scripts/orbit/full-implementation/run-loop.sh

recover:
	bash scripts/orbit/full-implementation/recover.sh

clean:
	rm -rf apps/ui/dist

status:
	git status --short --ignored
