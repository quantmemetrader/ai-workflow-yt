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

# ── Pick a node that can actually run this app ──────────────────────────────
# Not "what is on PATH". This machine has two: /usr/bin/node is v20, and nvm
# has v22 — and a login shell resolves the v20 first. The app stores its state
# through node:sqlite, which only exists from Node 22.5, so asking PATH picks
# the one interpreter that cannot load lib/server/db.ts, and the failure lands
# during "Collecting page data" where it reads like a Next.js problem.
#
# The requirement is checkable, so check it rather than guess a path. systemd
# also gets no login shell, so whichever one wins is written in absolutely.
# Re-run this script after a node upgrade, because that path moves.
say "Looking for a node with node:sqlite (needs >= 22.5)"
NODE_BIN=""
for candidate in \
  $(ls -d /home/"$APP_USER"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V -r) \
  "$(sudo -u "$APP_USER" bash -lc 'command -v node' 2>/dev/null || true)" \
  /usr/local/bin/node /usr/bin/node
do
  [[ -n "$candidate" && -x "$candidate" ]] || continue
  if "$candidate" -e "require('node:sqlite')" >/dev/null 2>&1; then
    NODE_BIN="$candidate"
    echo "  using $candidate ($("$candidate" -v))"
    break
  fi
  echo "  skipping $candidate ($("$candidate" -v 2>/dev/null || echo unknown)) — no node:sqlite"
done
if [[ -z "$NODE_BIN" ]]; then
  cat >&2 <<'EOF'

No installed node supports node:sqlite, which this app stores its state in.
It needs Node 22.5 or newer. Install one, then re-run:

  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install 22

EOF
  exit 1
fi
NODE_DIR=$(dirname "$NODE_BIN")

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
# Invoked through $NODE_BIN directly, not npx: npx would resolve node from PATH
# again and could pick the v20 back up, which is the failure this script exists
# to avoid.
cd "$APP_DIR"
sudo -u "$APP_USER" env \
  NEXT_DIST_DIR=.next-api \
  NODE_ENV=production \
  PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin" \
  "$NODE_BIN" "$APP_DIR/node_modules/next/dist/bin/next" build | tail -3

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

# Anything else already on the port has to go, or the service dies on
# EADDRINUSE — and because output is redirected to the log file, the journal
# shows only "status=1/FAILURE" with no reason in it. A hand-started server
# from testing is the usual culprit.
systemctl stop "$SERVICE" 2>/dev/null || true
STRAY=$(ss -lntpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)
if [[ -n "$STRAY" ]]; then
  say "Port $PORT is already held by pid(s): $STRAY — stopping them"
  for p in $STRAY; do kill "$p" 2>/dev/null || true; done
  sleep 2
  for p in $STRAY; do kill -9 "$p" 2>/dev/null || true; done
  sleep 1
fi

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
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "  service: FAILED"
  # The unit sends stdout and stderr to the log file, so the journal only ever
  # carries the exit code. The reason is in the app log; print both.
  echo "  --- journal ---"
  journalctl -u "$SERVICE" -n 8 --no-pager || true
  echo "  --- $APP_DIR/api-host.log ---"
  tail -25 "$APP_DIR/api-host.log" 2>/dev/null || echo "  (no log yet)"
  exit 1
fi
echo "  service: running"

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
