#!/usr/bin/env bash
set -euo pipefail

repos="${RTGV_REPOS:-}"

if [[ -z "$repos" ]]; then
  cat >&2 <<'EOF'
Repo path is missing.

Run one of these commands from the repository root:
  make dev-self
  make dev-app RTGV_REPOS=viewer=/absolute/path/to/git/repo
EOF
  exit 1
fi

IFS=',' read -ra entries <<< "$repos"

for entry in "${entries[@]}"; do
  if [[ "$entry" != *=* ]]; then
    cat >&2 <<EOF
Repo entry must look like id=/absolute/path.

Problem entry:
  $entry

Example:
  make dev-app RTGV_REPOS=viewer=/absolute/path/to/git/repo
EOF
    exit 1
  fi

  repo_id="${entry%%=*}"
  repo_path="${entry#*=}"

  if [[ -z "$repo_id" || -z "$repo_path" ]]; then
    cat >&2 <<EOF
Repo entry must include both an id and a path.

Problem entry:
  $entry

Example:
  viewer=/absolute/path/to/git/repo
EOF
    exit 1
  fi

  if [[ "$repo_path" != /* ]]; then
    cat >&2 <<EOF
Repo path must be absolute.

Problem path for "$repo_id":
  $repo_path

Use a full path, for example:
  make dev-app RTGV_REPOS=$repo_id=$(pwd)
EOF
    exit 1
  fi

  if [[ ! -e "$repo_path" ]]; then
    cat >&2 <<EOF
Repo path does not exist.

Problem path for "$repo_id":
  $repo_path

Check the folder path, then run:
  make dev-app RTGV_REPOS=$repo_id=/absolute/path/to/git/repo
EOF
    exit 1
  fi

  if [[ ! -e "$repo_path/.git" ]]; then
    cat >&2 <<EOF
Repo path is not a Git repository root.

Problem path for "$repo_id":
  $repo_path

Choose the folder that contains .git, then run:
  make dev-app RTGV_REPOS=$repo_id=/absolute/path/to/git/repo
EOF
    exit 1
  fi
done
