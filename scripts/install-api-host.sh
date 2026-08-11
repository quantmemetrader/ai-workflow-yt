#!/usr/bin/env bash
#
# Install the API host as a service on this machine.
#
# The site (Vercel) serves pages; this machine owns the SQLite database and
# answers /api. Run once with sudo:
#
#     sudo bash scripts/install-api-host.sh
#
# Safe to re-run: it rebuilds, rewrites the unit, and restarts.

set -euo pipefail

APP_USER=ubuntu
APP_DIR=/home/ubuntu/aiVideoFreeLance
PORT=4501
SERVICE=throughline-api

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo:  sudo bash scripts/install-api-host.sh" >&2
  exit 1
fi

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── Node lives under nvm, not /usr/bin ──────────────────────────────────────
# systemd gets no login shell, so nvm's PATH does not exist for it. Resolve the
# interpreter now and write the absolute path into the unit. Re-run this script
# after upgrading node, because that path moves with the version.
NODE_BIN=$(sudo -u "$APP_USER" bash -lc 'command -v node' 2>/dev/null || true)
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  NODE_BIN=$(ls -d /home/"$APP_USER"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Could not find node for user $APP_USER." >&2
  exit 1
fi
NODE_DIR=$(dirname "$NODE_BIN")
say "node: $NODE_BIN"

# ── Secrets and the database path ───────────────────────────────────────────
if [[ ! -f "$APP_DIR/.env.api" ]]; then
  say "Creating $APP_DIR/.env.api"
  SECRET=$(openssl rand -hex 32)
  cat > "$APP_DIR/.env.api" <<EOF
# The API host owns the database. Never set API_ORIGIN here — that is for the
# site deployment, and setting it here makes this server proxy /api to itself.
TL_DB=$APP_DIR/data/throughline.db
TL_SECRET=$SECRET
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env.api"
  chmod 600 "$APP_DIR/.env.api"
else
  say "Keeping existing $APP_DIR/.env.api"
fi

install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data"

# ── Build the API target ────────────────────────────────────────────────────
# Its own output directory: rewrites are baked into the route manifest at build
# time, so a build carrying the site's API_ORIGIN would make this server
# forward /api to itself and hang every request.
say "Building the API target (.next-api)"
sudo -u "$APP_USER" env PATH="$NODE_DIR:$PATH" NEXT_DIST_DIR=.next-api \
  bash -c "cd '$APP_DIR' && npx next build" | tail -3

# ── The service ─────────────────────────────────────────────────────────────
say "Writing /etc/systemd/system/$SERVICE.service"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Throughline API host (owns the SQLite database)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.api
Environment=NODE_ENV=production
Environment=NEXT_DIST_DIR=.next-api
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_BIN $APP_DIR/node_modules/next/dist/bin/next start -p $PORT -H 0.0.0.0
Restart=always
RestartSec=3
StandardOutput=append:$APP_DIR/api-host.log
StandardError=append:$APP_DIR/api-host.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

# ── Firewall ────────────────────────────────────────────────────────────────
say "Opening port $PORT"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT"/tcp && echo "  ufw: allowed"
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="$PORT"/tcp && firewall-cmd --reload && echo "  firewalld: allowed"
else
  echo "  No active host firewall found — nothing to open locally."
  echo "  If the port is still unreachable, it is blocked at your provider"
  echo "  (Hetzner/DO/AWS security group), not on this machine."
fi

# ── Check ───────────────────────────────────────────────────────────────────
sleep 3
say "Result"
systemctl is-active --quiet "$SERVICE" && echo "  service: running" || {
  echo "  service: FAILED — last lines:"; journalctl -u "$SERVICE" -n 20 --no-pager; exit 1; }

CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/session" || echo 000)
echo "  local  http://127.0.0.1:$PORT/api/session -> $CODE"
IP=$(curl -s -m 5 https://api.ipify.org || echo "this-server")
echo "  public http://$IP:$PORT/api/session"

cat <<EOF

Next, on Vercel:

  1. Project → Settings → Environment Variables
       API_ORIGIN = http://$IP:$PORT
  2. Redeploy. API_ORIGIN is read at BUILD time, so an existing deployment
     will not pick it up without one.
  3. Confirm the split — this should hang or 502 if the port is closed, and
     return JSON once it is open:
       curl -m 10 http://$IP:$PORT/api/session

Before you leave it running: over plain http the session cookie crosses the
internet unencrypted on every request. Point a subdomain here and put Caddy in
front, then use https:// for API_ORIGIN instead:

  sudo apt install -y caddy
  echo 'api.your-domain.com { reverse_proxy :$PORT }' | sudo tee /etc/caddy/Caddyfile
  sudo systemctl restart caddy

Useful:
  systemctl status $SERVICE
  journalctl -u $SERVICE -f
EOF
