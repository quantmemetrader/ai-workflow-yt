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

# One deploy at a time: two builds at once ran the box out of memory (29 Sep).
exec 9>/tmp/aura-deploy.lock
if ! flock -n 9; then
  echo "!! another deploy is already running; wait for it to finish" >&2
  exit 1
fi

echo "==> checks"
# The project outgrew tsc's default 4 GB heap (it died with "heap out of memory"); the box has 64 GB.
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
# Code that would make the build trace the whole project (see the script).
node scripts/check-trace-sources.mjs
npm run smoke

echo "==> renderer fonts"
# Director v2 draws its captions (libass) and graphics (Remotion) in Noto
# Sans CJK SC Black/Bold: OFL, ~17 MB each, gitignored, so fetched here into
# remotion/public/fonts. The script skips a face that is already there, so
# this costs nothing after the first deploy. A failure does not stop the
# deploy: v1 does not use these faces, and a v2 render without them falls
# back to the variable face until the next deploy fetches them.
bash scripts/fetch-cjk-font.sh --otf-only || echo "!! the CJK caption fonts could not be fetched (scripts/fetch-cjk-font.sh --otf-only); v2 renders use the fallback face" >&2

echo "==> build"
# Into .next-build, never where the live server reads (next.config.ts
# distDir), with an id per deploy for Next's skew protection.
release="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
# Lowest CPU and IO priority: the build uses every core for ~3 minutes, and
# live chats streaming on the same box stalled while it ran.
# Capped at 24 GB (a healthy build needs a few): a build that runs away is
# stopped at once with a clear message, instead of the kernel OOM-killing it
# ten minutes in — or killing the live server's processes instead.
if ! systemd-run --user --scope --quiet -p MemoryMax=24G -p MemorySwapMax=0 -- \
  env NEXT_DEPLOYMENT_ID="$release" NODE_OPTIONS=--max-old-space-size=8192 nice -n 19 ionice -c3 npx next build; then
  echo "!! the build failed or passed its 24 GB memory cap." >&2
  echo "   If it was the cap: node scripts/check-trace-output.mjs .next-build shows which pages trace too much." >&2
  exit 1
fi
# Nothing traced from old releases, temp files, or thousands of stray files.
node scripts/check-trace-output.mjs .next-build

echo "==> stage release ${release}"
# Moves the build into releases/<id>, keeps every older script an open tab
# may still ask for, and points .next/standalone at the new release in one
# rename. See the script for why.
bash scripts/stage-release.sh "$release"

mkdir -p logs

echo "==> reload"
if pm2 describe aura >/dev/null 2>&1; then
  # Only the app and the workers. The scheduled scripts (digest, plan, hot
  # lists, social sync…) are cron apps, and pm2 runs a cron app once every
  # time it is (re)loaded: reloading them on each deploy ran the paid TikHub
  # collection and the social sync every few minutes on a busy day. They pick
  # up new code on their next scheduled run anyway.
  pm2 reload ecosystem.config.cjs --only aura,aura-worker --update-env
  # A scheduled app that is new in the ecosystem file is started once, so it
  # exists; the ones already there are left alone.
  for app in $(node -e "console.log(require(\"./ecosystem.config.cjs\").apps.map(a=>a.name).join(\" \"))"); do
    pm2 describe "$app" >/dev/null 2>&1 || pm2 start ecosystem.config.cjs --only "$app"
  done
  # A reload keeps the instance count it already had; the ecosystem file asks
  # for two workers so a render never holds up the small jobs behind it.
  pm2 scale aura-worker 2 >/dev/null 2>&1 || true
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
