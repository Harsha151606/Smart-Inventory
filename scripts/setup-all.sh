#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for cmd in docker openssl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] Required tool '$cmd' is not installed."
    exit 1
  fi
done

ensure_docker_running() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  echo "[docker] Docker daemon is not running. Attempting to start it..."
  if [ "$(uname -s)" = "Darwin" ]; then
    if [ -d "/Applications/Docker.app" ]; then
      open -a Docker
    elif [ -d "/Applications/OrbStack.app" ]; then
      open -a OrbStack
    elif command -v colima >/dev/null 2>&1; then
      colima start
    else
      echo "[error] Start Docker Desktop, OrbStack, or Colima, then re-run this script."
      exit 1
    fi
  else
    echo "[error] Docker daemon is stopped. Start Docker (e.g., sudo systemctl start docker) and re-run."
    exit 1
  fi

  for i in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
      echo "[docker] Docker daemon is ready."
      return 0
    fi
    sleep 2
  done
  echo "[error] Timed out waiting for Docker daemon. Open Docker Desktop and wait until it shows Running."
  exit 1
}

echo "=== 1/4 Cleaning legacy Python files & installing Git guards ==="
./scripts/purge-git-python.sh

echo "=== 2/4 Generating cryptographic .env secrets ==="
if [ ! -f ".env" ]; then
  PG_PASS="$(openssl rand -hex 24)"
  REDIS_PASS="$(openssl rand -hex 24)"
  JWT_SEC="$(openssl rand -hex 32)"
  PEPPER_SEC="$(openssl rand -hex 32)"
  QR_SEC="$(openssl rand -hex 32)"
  ADMIN_PASS="Adm!$(openssl rand -hex 6)9Z"

  cat > .env <<EOF
NODE_ENV=production
PORT=8000
COOKIE_SECURE=false
CORS_ORIGIN=http://localhost:8080
ALLOW_PUBLIC_REGISTRATION=false

POSTGRES_USER=inventory_app
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=smart_inventory

REDIS_PASSWORD=${REDIS_PASS}

JWT_SECRET=${JWT_SEC}
PASSWORD_PEPPER=${PEPPER_SEC}
QR_SIGNING_KEY=${QR_SEC}

ADMIN_NAME=Admin
ADMIN_EMAIL=admin@inventory.local
ADMIN_PASSWORD=${ADMIN_PASS}
EOF
  chmod 600 .env
  echo "[secrets] Created .env with fresh 256-bit random secrets (chmod 600)."
  echo "[admin]   Bootstrap Login Email:    admin@inventory.local"
  echo "[admin]   Bootstrap Login Password: ${ADMIN_PASS}"
else
  echo "[secrets] Existing .env preserved."
fi

echo "=== 3/4 Building and starting hardened Docker containers ==="
ensure_docker_running
if ! docker compose up --build -d; then
  echo "[error] Container startup failed. Recent backend logs:"
  docker compose logs --tail=50 backend || true
  exit 1
fi

echo "=== 4/4 Waiting for health endpoints ==="
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/nginx-health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:8080/api/auth/status >/dev/null 2>&1; then
    echo "[ready] Smart Inventory Manager is LIVE at http://localhost:8080"
    exit 0
  fi
  sleep 2
done

echo "[warn] Containers started, check logs with: docker compose logs -f"
