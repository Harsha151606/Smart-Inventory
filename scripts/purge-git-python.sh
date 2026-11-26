#!/usr/bin/env bash
set -euo pipefail

REWRITE_HISTORY=false
if [ "${1:-}" = "--rewrite-history" ]; then
  REWRITE_HISTORY=true
fi

echo "[clean] Removing legacy Python and old Flask template files..."
find . -maxdepth 4 -type f -name '*.py' -not -path './.git/*' -delete
rm -rf requirements.txt inventory.db templates static

if [ -d ".git" ]; then
  git rm -r --cached --ignore-unmatch '*.py' requirements.txt inventory.db templates static >/dev/null 2>&1 || true
  ./scripts/install-git-hooks.sh
  echo "[clean] Untracked all legacy Python files from Git index."
fi

REMAINING=$(find . -type f -name '*.py' -not -path './.git/*' | wc -l | tr -d ' ')
if [ "$REMAINING" -ne 0 ]; then
  echo "[error] Found $REMAINING remaining .py files!"
  exit 1
fi
echo "[clean] Verified: 0 .py files remain in workspace."

if [ "$REWRITE_HISTORY" = true ]; then
  if ! command -v git-filter-repo >/dev/null 2>&1; then
    echo "[error] git-filter-repo is required for --rewrite-history. Install via: brew install git-filter-repo"
    exit 1
  fi
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
  git filter-repo --path-glob '*.py' --path requirements.txt --invert-paths --force
  if [ -n "$REMOTE_URL" ]; then
    git remote add origin "$REMOTE_URL" 2>/dev/null || git remote set-url origin "$REMOTE_URL"
  fi
  echo "[clean] Purged all .py files from entire Git history. Run: git push --force --all"
fi
