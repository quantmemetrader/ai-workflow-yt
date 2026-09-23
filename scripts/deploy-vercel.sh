#!/usr/bin/env bash
#
# Deploy the app to Vercel, without git.
#
#   npm run deploy:vercel
#
# The project is *not* connected to a repository on purpose: this uploads the
# working directory as a tarball, so what goes live is what is on this machine,
# not what somebody last pushed. No commit is needed and none is made.
#
# It refuses to run if the tree does not typecheck or lint, for the same reason
# `scripts/deploy.sh` does: a deployment is not the place to find out.
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------- the token
#
# Kept out of the repository. Put it in .env.vercel (gitignored) as
#   VERCEL_TOKEN="vcp_…"
# or export it before running this.
if [ -z "${VERCEL_TOKEN:-}" ] && [ -f .env.vercel ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.vercel
  set +a
fi

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "!! No VERCEL_TOKEN. Put it in .env.vercel or export it." >&2
  echo "   Create one at https://vercel.com/account/tokens" >&2
  exit 1
fi
export VERCEL_TOKEN

VERCEL="npx --yes vercel@latest"
PROJECT_ID=$(python3 -c "import json;print(json.load(open('.vercel/project.json'))['projectId'])")
TEAM_ID=$(python3 -c "import json;print(json.load(open('.vercel/project.json'))['orgId'])")

echo "==> checks"
npx tsc --noEmit
npm run lint

# ------------------------------------------------------------ the queue
#
# Hobby builds one thing at a time. A deployment stuck in BLOCKED cannot be
# cancelled through the API, and every later one queues behind it, which looks
# exactly like a deploy that is merely slow. A production deploy of this app
# takes about forty seconds; if it is taking minutes, this is why.
echo "==> queue"
blocked=$(curl -s --max-time 30 \
  "https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=10" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  | python3 -c "import json,sys; print(sum(1 for d in json.load(sys.stdin).get('deployments',[]) if d.get('state')=='BLOCKED'))")

if [ "$blocked" != "0" ]; then
  # Said, not enforced. A new deploy does go through while older ones sit in
  # BLOCKED — that is how this one was shipped — so refusing here would block
  # a deploy that works. What it is worth is knowing why the dashboard looks
  # like a graveyard, and why a deploy might take longer than the usual forty
  # seconds.
  echo "    note: ${blocked} older deployment(s) are BLOCKED (Hobby builds one at"
  echo "          a time). They cannot be cancelled and drain on their own."
else
  echo "    clear"
fi

# ------------------------------------------------------------ the deploy
#
# --archive=tgz uploads a tarball rather than thousands of files, which is both
# faster and the thing that makes this independent of git.
echo "==> deploy"
url=$($VERCEL deploy --prod --yes --archive=tgz 2>&1 | tee /dev/stderr \
  | python3 -c "
import json,sys
raw = sys.stdin.read()
start = raw.find('{')
if start >= 0:
    try:
        print(json.loads(raw[start:]).get('url',''))
        sys.exit(0)
    except Exception:
        pass
# Older CLI output: the last line that looks like a URL.
for line in reversed(raw.splitlines()):
    if 'vercel.app' in line:
        print(line.strip().split()[-1]); break
")

echo
echo "==> health"
ALIAS="${VERCEL_ALIAS:-https://ai-workspace-video.vercel.app}"
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${ALIAS}/api/health" || true)
  if [ "$code" = "200" ]; then
    curl -s --max-time 20 "${ALIAS}/api/health"
    echo
    echo "==> live at ${ALIAS}"
    exit 0
  fi
  sleep 5
done

echo "!! ${ALIAS}/api/health did not answer 200 (last: ${code})." >&2
echo "   The deployment may still be propagating, or the alias may point at an" >&2
echo "   older build. Check: $VERCEL ls ${PROJECT_ID}" >&2
exit 1
