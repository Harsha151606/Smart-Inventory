#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REGISTRY="${1:-local}"
TAG="${2:-1.0.0}"
NAMESPACE="smart-inventory"

for cmd in docker kubectl openssl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] Required tool '$cmd' is not installed."
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "[docker] Docker daemon is not running. Attempting to start it..."
  if [ "$(uname -s)" = "Darwin" ] && [ -d "/Applications/Docker.app" ]; then
    open -a Docker
    for i in $(seq 1 30); do
      if docker info >/dev/null 2>&1; then break; fi
      sleep 2
    done
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "[error] Docker daemon is still unreachable. Open Docker Desktop first, then re-run."
    exit 1
  fi
fi

if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "[error] No reachable Kubernetes cluster. Enable Kubernetes in Docker Desktop Settings -> Kubernetes -> Enable Kubernetes, or start minikube/kind."
  exit 1
fi

if [ "$REGISTRY" = "local" ]; then
  BACKEND_IMG="smart-inventory-backend:${TAG}"
  FRONTEND_IMG="smart-inventory-frontend:${TAG}"
else
  BACKEND_IMG="${REGISTRY}/smart-inventory-backend:${TAG}"
  FRONTEND_IMG="${REGISTRY}/smart-inventory-frontend:${TAG}"
fi

echo "=== 1/5 Building hardened images ==="
docker build -t "$BACKEND_IMG" ./backend
docker build -t "$FRONTEND_IMG" ./frontend

if [ "$REGISTRY" != "local" ]; then
  echo "=== 2/5 Pushing images to ${REGISTRY} ==="
  docker push "$BACKEND_IMG"
  docker push "$FRONTEND_IMG"
else
  echo "=== 2/5 Local image mode (loading into kind/minikube if present) ==="
  if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -q .; then
    kind load docker-image "$BACKEND_IMG" "$FRONTEND_IMG"
  elif command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
    minikube image load "$BACKEND_IMG"
    minikube image load "$FRONTEND_IMG"
  fi
fi

echo "=== 3/5 Creating Restricted Pod Security namespace & secrets ==="
kubectl apply -f k8s/namespace.yaml

if ! kubectl -n "$NAMESPACE" get secret inventory-secrets >/dev/null 2>&1; then
  kubectl -n "$NAMESPACE" create secret generic inventory-secrets \
    --from-literal=POSTGRES_USER="inventory_app" \
    --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
    --from-literal=POSTGRES_DB="smart_inventory" \
    --from-literal=REDIS_PASSWORD="$(openssl rand -hex 24)" \
    --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
    --from-literal=PASSWORD_PEPPER="$(openssl rand -hex 32)" \
    --from-literal=QR_SIGNING_KEY="$(openssl rand -hex 32)"
  echo "[secrets] Generated inventory-secrets inside cluster (never written to disk)."
else
  echo "[secrets] Existing inventory-secrets preserved."
fi

echo "=== 4/5 Applying hardened Kubernetes manifests ==="
kubectl apply -k k8s/

kubectl -n "$NAMESPACE" set image deployment/smart-inventory-backend api="$BACKEND_IMG"
kubectl -n "$NAMESPACE" set image deployment/smart-inventory-frontend web="$FRONTEND_IMG"

if [ "$REGISTRY" = "local" ]; then
  kubectl -n "$NAMESPACE" patch deployment smart-inventory-backend -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","imagePullPolicy":"IfNotPresent"}]}}}}'
  kubectl -n "$NAMESPACE" patch deployment smart-inventory-frontend -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","imagePullPolicy":"IfNotPresent"}]}}}}'
fi

echo "=== 5/5 Waiting for rollouts ==="
kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=120s
kubectl -n "$NAMESPACE" rollout status deployment/redis --timeout=120s
kubectl -n "$NAMESPACE" rollout status deployment/smart-inventory-backend --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/smart-inventory-frontend --timeout=180s

echo "[done] Deployed cleanly to namespace '${NAMESPACE}'."
echo "Local access: kubectl -n ${NAMESPACE} port-forward svc/frontend 8080:80"
