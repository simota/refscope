SHELL := /bin/bash

PNPM ?= pnpm
RTGV_REPOS ?=
VITE_RTGV_API_BASE_URL ?= http://127.0.0.1:4175
MOCK_HOST ?= 127.0.0.1
MOCK_PORT ?= 5173
RTGV_REF_POLL_MS ?=
MAX_ITERATIONS ?= 30

.DEFAULT_GOAL := help

.PHONY: help install dev dev-self dev-app dev-api dev-mock build build-api build-mock test test-api verify audit orbit recover clean status

help:
	@printf "Realtime Git Viewer commands\n\n"
	@printf "Setup:\n"
	@printf "  make install                         Install dependencies from lockfile\n"
	@printf "\nDevelopment:\n"
	@printf "  make dev                             Start mock UI on 127.0.0.1:5173\n"
	@printf "  make dev-self                        Start API and UI for this repository\n"
	@printf "  make dev-app RTGV_REPOS=id=/repo     Start API and mock UI together\n"
	@printf "  make dev-api RTGV_REPOS=id=/repo     Start API with allowlisted Git repos\n"
	@printf "  make dev-mock                        Start mock UI with API base URL\n"
	@printf "\nBuild and test:\n"
	@printf "  make build                           Build API and mock UI\n"
	@printf "  make build-api                       Syntax-check API\n"
	@printf "  make build-mock                      Build mock UI\n"
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
	$(MAKE) dev-mock

dev-self:
	$(MAKE) dev-app RTGV_REPOS="viewer=$(CURDIR)"

dev-app:
	@if [[ -z "$(RTGV_REPOS)" ]]; then \
		echo "RTGV_REPOS is required, e.g. make dev-app RTGV_REPOS=viewer=/absolute/path"; \
		echo "For the current repository, run: make dev-self"; \
		exit 1; \
	fi
	@set -euo pipefail; \
	echo "Starting Realtime Git Viewer"; \
	echo "  API:  $(VITE_RTGV_API_BASE_URL)"; \
	echo "  UI:   http://$(MOCK_HOST):$(MOCK_PORT)"; \
	echo "  Repos: $(RTGV_REPOS)"; \
	echo ""; \
	RTGV_REPOS="$(RTGV_REPOS)" RTGV_REF_POLL_MS="$(RTGV_REF_POLL_MS)" $(PNPM) dev:api & \
	api_pid=$$!; \
	trap 'kill $$api_pid 2>/dev/null || true' EXIT INT TERM; \
	VITE_RTGV_API_BASE_URL="$(VITE_RTGV_API_BASE_URL)" $(PNPM) dev:mock -- --host "$(MOCK_HOST)" --port "$(MOCK_PORT)" --strictPort

dev-api:
	@if [[ -z "$(RTGV_REPOS)" ]]; then \
		echo "RTGV_REPOS is required, e.g. make dev-api RTGV_REPOS=viewer=/absolute/path"; \
		exit 1; \
	fi
	RTGV_REPOS="$(RTGV_REPOS)" RTGV_REF_POLL_MS="$(RTGV_REF_POLL_MS)" $(PNPM) dev:api

dev-mock:
	VITE_RTGV_API_BASE_URL="$(VITE_RTGV_API_BASE_URL)" $(PNPM) dev:mock -- --host "$(MOCK_HOST)" --port "$(MOCK_PORT)" --strictPort

build:
	$(PNPM) build

build-api:
	$(PNPM) build:api

build-mock:
	$(PNPM) build:mock

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
	rm -rf mock/dist

status:
	git status --short --ignored
