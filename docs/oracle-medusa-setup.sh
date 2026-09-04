#!/usr/bin/env bash
#
# Oracle Cloud Free Tier - Medusa backend provisioning script
# ------------------------------------------------------------
# Purpose: bring up the REAL Medusa backend (server + worker in SHARED mode),
# Postgres, and Redis on an Oracle Cloud Always Free VM (VM.Standard.A1.Flex,
# 2 OCPU / 12 GB recommended).
#
# Why shared mode: the free A1 supports 2 OCPU / 12GB total. Running Medusa in
# `shared` worker mode keeps the server + background worker in ONE process, so
# a single instance hosts the whole backend (no separate worker = fits the free
# allocation comfortably). No Render billing involved.
#
# Target OS: Ubuntu LTS 24.04 (an Always Free-eligible image).
# Run as:   bash docs/oracle-medusa-setup.sh
#
# After this runs, Medusa listens on :9000 at your VM public IP.
# Point storefront/change-room at http://<PUBLIC_IP>:9000
#
# Required to customize below: your GitHub repo the VM can clone.
# For a private repo, either set GH_TOKEN below or pre-auth ssh-agent.

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Configuration - EDIT THESE
# ---------------------------------------------------------------------------
REPO_URL="https://github.com/louji2308/change-room.git"   # or git@github.com:...
BRANCH="main"
APP_PORT=9000
DB_NAME="medusa"
DB_USER="medusa"
DB_PASS="change-me-strong-db-password"     # MUST CHANGE
JWT_SECRET="$(openssl rand -hex 32)"        # generated if left as-is
COOKIE_SECRET="$(openssl rand -hex 32)"     # generated if left as-is
# Only needed if REPO_URL is private:
GH_TOKEN="${GH_TOKEN:-}"                    # set to a PAT if repo is private

echo "==> Medusa backend provisioner (Oracle Always Free)"
echo "    db_pass        = ${DB_PASS}"
echo "    medusa port    = ${APP_PORT}"

# ---------------------------------------------------------------------------
# 1. System packages + Node 22 + pnpm
# ---------------------------------------------------------------------------
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends \
  git curl ca-certificates gnupg openssl postgresql postgresql-contrib redis-server

# Node.js 22 (LTS, satisfies engine >=22.12)
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo npm i -g pnpm@10.11.1 corepack 2>/dev/null || sudo npm i -g pnpm@10.11.1

node -v
pnpm -v

# ---------------------------------------------------------------------------
# 2. Start + enable Postgres & Redis on boot
# ---------------------------------------------------------------------------
sudo systemctl enable --now postgresql
sudo systemctl enable --now redis-server
sudo systemctl status postgresql --no-pager | head -n 3 || true
sudo systemctl status redis-server --no-pager | head -n 3 || true

# ---------------------------------------------------------------------------
# 3. Create medusa Postgres role + database
# ---------------------------------------------------------------------------
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

echo "==> Postgres ready: db=${DB_NAME} user=${DB_USER}"

# ---------------------------------------------------------------------------
# 4. Clone repo
# ---------------------------------------------------------------------------
APP_DIR="/opt/change-room"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
cd "$APP_DIR"
if [ -d ".git" ]; then
  echo "==> Repo already present, pulling..."
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull
else
  echo "==> Cloning ${REPO_URL}"
  if [ -n "$GH_TOKEN" ]; then
    git clone "https://x-access-token:${GH_TOKEN}@${REPO_URL#https://}" .
  else
    git clone "$REPO_URL" .
  fi
  git checkout "$BRANCH"
fi

# ---------------------------------------------------------------------------
# 5. Configure backend .env
# ---------------------------------------------------------------------------
BACKEND_DIR="$APP_DIR/apps/backend"
PUBLIC_IP="$(curl -fsSL -4 https://ifconfig.me || echo localhost)"
cat > "$BACKEND_DIR/.env" <<ENV
NODE_ENV=production
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
REDIS_URL=redis://localhost:6379
MEDUSA_WORKER_MODE=shared
MEDUSA_BACKEND_URL=http://${PUBLIC_IP}:${APP_PORT}
STORE_CORS=http://localhost:8000
ADMIN_CORS=http://localhost:7001
AUTH_CORS=http://localhost:8000
JWT_SECRET=${JWT_SECRET}
COOKIE_SECRET=${COOKIE_SECRET}
DISABLE_MEDUSA_ADMIN=false
CACHE_TTL=60
ENV

echo "==> .env written to ${BACKEND_DIR}/.env"
echo "    PS: keep these secrets; they are regenerated on each run."

# ---------------------------------------------------------------------------
# 6. Install deps + build backend
# ---------------------------------------------------------------------------
cd "$APP_DIR"
corepack enable 2>/dev/null || true
pnpm install --frozen-lockfile

echo "==> Building medusa backend (this needs ~2GB; VM has 12GB)"
pnpm --filter @dtc/backend build

# ---------------------------------------------------------------------------
# 7. Migrate + seed + start
# ---------------------------------------------------------------------------
echo "==> Running migrations"
pnpm --filter @dtc/backend predeploy

if [ -f "$BACKEND_DIR/src/migration-scripts/initial-data-seed.ts" ]; then
  echo "==> Seeding initial data (first run only)"
  pnpm --filter @dtc/backend seed
fi

echo "==> Starting Medusa (shared mode) on :${APP_PORT}"
echo "    CONGRATULATIONS - it is now running. Keep this process in a tmux/screen,"
echo "    or jump to the systemd unit in the repo root to run it as a service."
cd "$BACKEND_DIR"
exec pnpm start -- --port "$APP_PORT"
