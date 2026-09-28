#!/usr/bin/env bash
#
# Turn a finished build into a release and point the live server at it.
#
#   bash scripts/stage-release.sh <release-id>
#
# Why releases. `next build` used to write straight into .next, which is
# where the running server reads its manifests and route bundles from. For the
# minute or two a build took, the live site was reading a half-written tree
# ("The client reference manifest for route … does not exist"), and every
# build deleted the previous build's scripts, so a tab left open across a
# deploy failed on its next click with Next's bare "This page couldn't load".
#
# Now the build goes to .next-build (next.config.ts `distDir`), is moved here
# into releases/<id>, and .next/standalone becomes a symlink to it. pm2 still
# runs .next/standalone/server.js; Node resolves the symlink when a process
# starts, so a running instance keeps reading its own release until pm2's
# rolling reload replaces it. Old scripts are kept (static-archive/) and
# copied into every release, so an old tab can still load what it asks for;
# Next's deploymentId then makes its next navigation a clean full load.
set -euo pipefail

cd "$(dirname "$0")/.."
root=$(pwd)
id="${1:?release id}"
dist=".next-build"
# Releases live OUTSIDE the project (29 Sep): inside it, every page's file
# trace took in all of them — 215,000 files, a 54 GB build, OOM-killed.
store="${RELEASES_DIR:-$HOME/aura-releases}"
rel="$store/$id"
link="$root/.next/standalone"

test -f "$dist/standalone/server.js" || { echo "!! no standalone build in $dist" >&2; exit 1; }
mkdir -p "$store" "$root/static-archive" "$root/.next"

rm -rf "$rel"
mv "$dist/standalone" "$rel"
rm -rf "$rel/$dist/static" "$rel/public"
cp -r "$dist/static" "$rel/$dist/static"
cp -r public "$rel/public"

# This build's own scripts, for /api/chunks (the warm-up prefetch). Written
# before older builds' files are added, so the warm-up never fetches those.
node -e '
const fs = require("fs");
const dir = process.argv[1];
const files = fs.readdirSync(dir).filter((n) => /\.(js|css)$/.test(n)).map((n) => "/_next/static/chunks/" + n);
process.stdout.write(JSON.stringify(files));
' "$rel/$dist/static/chunks" > "$rel/chunks.json"

# Every script any open tab might still ask for. The legacy tree (before
# releases) is folded in once; files are content-hashed, so nothing collides.
if [ -d "$link/.next/static" ] && [ ! -L "$link" ]; then
  cp -r --update=none "$link/.next/static/." "$root/static-archive/"
fi
cp -r --update=none "$rel/$dist/static/." "$root/static-archive/"
find "$root/static-archive" -type f -mtime +14 -delete 2>/dev/null || true
cp -r --update=none "$root/static-archive/." "$rel/$dist/static/"

# Point the live path at the new release in one rename. The first time,
# .next/standalone is still a real directory: it is kept as a release.
if [ -e "$link" ] && [ ! -L "$link" ]; then
  mv "$link" "$store/legacy-$(date -u +%Y%m%d%H%M%S)"
fi
ln -sfn "$rel" "$root/.next/standalone.next"
mv -Tf "$root/.next/standalone.next" "$link"
echo "    live: $(readlink "$link")"

# Keep the newest two releases (the live one and the one before it, which
# instances still finishing the rolling reload may read). Older scripts that
# open tabs ask for are in static-archive/, copied into every release.
live=$(readlink -f "$link")
ls -1d "$store"/*/ 2>/dev/null | sed 's#/$##' | sort | head -n -2 | while read -r d; do
  [ "$(readlink -f "$d")" = "$live" ] || rm -rf "$d"
done
# Releases from before the move, left inside the project: gone once they are
# not live (a later deploy clears the last one).
for d in "$root"/releases/*/; do
  [ -d "$d" ] || continue
  d="${d%/}"
  [ "$(readlink -f "$d")" = "$live" ] || [ "$d" = "${PREV_LIVE:-}" ] || rm -rf "$d"
done
rmdir "$root/releases" 2>/dev/null || true
