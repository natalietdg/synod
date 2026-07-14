#!/usr/bin/env bash
# Bootstrap Synod on a fresh Alibaba Cloud ECS instance (Ubuntu 22.04/24.04).
# Idempotent: safe to re-run to pull the latest code and restart the service.
#
#   sudo bash setup-ecs.sh <DASHSCOPE_API_KEY>
#
# What this proves for the record: the backend process runs on Alibaba Cloud ECS,
# and its reasoning calls go to Alibaba Cloud Model Studio (see src/agents/qwen.ts).
set -euo pipefail

DASHSCOPE_API_KEY="${1:-}"
REPO_URL="https://github.com/natalietdg/synod.git"
APP_DIR="/opt/synod"
ENV_FILE="/etc/synod.env"

if [[ $(id -u) -ne 0 ]]; then
  echo "Run as root (sudo): this installs packages and a systemd unit." >&2
  exit 1
fi

if [[ -z "$DASHSCOPE_API_KEY" && ! -f "$ENV_FILE" ]]; then
  echo "Usage: sudo bash setup-ecs.sh <DASHSCOPE_API_KEY>" >&2
  echo "(The key is only needed on first run; after that it lives in $ENV_FILE.)" >&2
  exit 1
fi

echo "==> Installing Node 20 and git"
if ! command -v node >/dev/null || [[ "$(node --version)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs git
fi

echo "==> Creating service user"
id -u synod &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin synod

echo "==> Fetching Synod"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci
chown -R synod:synod "$APP_DIR"

echo "==> Writing environment ($ENV_FILE)"
if [[ -n "$DASHSCOPE_API_KEY" ]]; then
  cat > "$ENV_FILE" <<EOF
PORT=80
LLM_PROVIDER=qwen
DASHSCOPE_API_KEY=$DASHSCOPE_API_KEY
EOF
  chmod 600 "$ENV_FILE"
fi

echo "==> Installing systemd service"
cp "$APP_DIR/deploy/alibaba/synod.service" /etc/systemd/system/synod.service
systemctl daemon-reload
systemctl enable synod
systemctl restart synod

sleep 2
systemctl --no-pager status synod || true
echo
echo "Synod is up. Public URL: http://$(curl -fsS --max-time 5 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || hostname -I | awk '{print $1}')/"
