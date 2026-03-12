#!/usr/bin/env bash

set -euo pipefail

ENV_FILE=".env.production"
INSTALL_DOCKER="false"
SEED_STORE="false"

usage() {
  cat <<'EOF'
Usage:
  ./deploy/digitalocean-deploy.sh [--env-file .env.production] [--install-docker] [--seed-store]

Options:
  --env-file        Path to production env file. Default: .env.production
  --install-docker  Install Docker Engine + Compose plugin on Ubuntu.
  --seed-store      Seed the optional store catalog after deploy.
  -h, --help        Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --install-docker)
      INSTALL_DOCKER="true"
      shift
      ;;
    --seed-store)
      SEED_STORE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "${INSTALL_DOCKER}" == "true" ]]; then
  sudo apt update
  sudo apt install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git
  sudo usermod -aG docker "$USER"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but not installed." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  echo "Start from .env.production.example and fill in real values." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required_vars=(
  DATABASE_URL
  DIRECT_URL
  SUPABASE_URL
  SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  APP_DOMAIN
  API_DOMAIN
  ACME_EMAIL
  PUBLIC_BASE_URL
  NEXT_PUBLIC_API_BASE_URL
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required env var in ${ENV_FILE}: ${var_name}" >&2
    exit 1
  fi
done

echo "Building and starting SteadyAI services..."
if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  echo "Logging into GHCR..."
  printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin
fi

echo "Pulling prebuilt SteadyAI images..."
docker compose --env-file "${ENV_FILE}" pull backend web caddy

echo "Starting SteadyAI services..."
docker compose --env-file "${ENV_FILE}" up -d --no-build

echo "Applying Prisma schema..."
docker compose --env-file "${ENV_FILE}" exec -T backend npx prisma db push

if [[ "${SEED_STORE}" == "true" ]]; then
  echo "Seeding store catalog..."
  docker compose --env-file "${ENV_FILE}" exec -T backend npm run seed:store
fi

echo
echo "Deployment complete."
echo "Web: https://${APP_DOMAIN}"
echo "API: https://${API_DOMAIN}/api/health"
echo "MCP: https://${API_DOMAIN}/mcp"
