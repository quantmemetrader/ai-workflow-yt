#!/usr/bin/env bash
#
# Build and (re)start the app under pm2 on this machine.
#
#   npm run deploy
#
# Standalone output is self-contained except for two things Next deliberately
# leaves behind: the static chunks and public/. They are copied in here, which
# is the step everyone forgets and then wonders why the page loads with no CSS.
set -euo pipefail

cd "$(dirname "$0")/.."
root=$(pwd)

echo "==> checks"
npx tsc --noEmit
npm run smoke

echo "==> build"
npm run build

# Staging now happens in the `postbuild` script, so that a plain `npm run build`
# also leaves a complete standalone tree. It used not to, and a stray build
# after a deploy quietly emptied public/ — which took out every design-only
# module page until the next deploy.

mkdir -p logs

echo "==> reload"
if pm2 describe aura >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "==> health"
port="${PORT:-3300}"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    curl -s "http://127.0.0.1:${port}/api/health"
    echo
    echo "==> up on port ${port}"
    exit 0
  fi
  sleep 1
done

echo "!! did not come up; last 40 log lines:" >&2
pm2 logs aura --lines 40 --nostream >&2
exit 1
