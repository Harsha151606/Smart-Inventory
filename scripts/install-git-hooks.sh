#!/usr/bin/env bash
set -euo pipefail

if [ ! -d ".git" ]; then
  echo "[hooks] Not a git repository. Skipping hook installation."
  exit 0
fi

HOOK_PATH=".git/hooks/pre-commit"
cat > "$HOOK_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

STAGED=$(git diff --cached --name-only --diff-filter=ACMR)

if echo "$STAGED" | grep -Eq '\.py$|^requirements\.txt$'; then
  echo "BLOCKED: Python files (*.py / requirements.txt) are forbidden in this repository."
  echo "$STAGED" | grep -E '\.py$|^requirements\.txt$'
  exit 1
fi

if echo "$STAGED" | grep -Eq '(^|/)\.env($|\.)' && ! echo "$STAGED" | grep -Eq '(^|/)\.env\.example$'; then
  echo "BLOCKED: Real .env files cannot be committed to Git."
  exit 1
fi

if echo "$STAGED" | grep -Eq 'k8s/secrets\.yaml$'; then
  echo "BLOCKED: Real Kubernetes secrets cannot be committed to Git."
  exit 1
fi
EOF

chmod +x "$HOOK_PATH"
echo "[hooks] Installed pre-commit guard blocking .py, .env, and secret files."
