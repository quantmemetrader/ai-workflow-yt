#!/usr/bin/env bash
# Refetch the self-hosted Simplified Chinese fonts: the website's webfont and
# the render box's heavy caption faces.
#
# Part 1 — the site. It ships Noto Sans SC rather than asking for 'PingFang
# SC' and hoping: a Hong Kong Mac answers that with PingFang HK and a Hong
# Kong PC with Microsoft JhengHei, both Traditional cuts, which is how correct
# text ended up drawn in the wrong characters. Google's unicode-range
# subsetting is kept, so a page downloads the two or three of the 101 files it
# needs. Rewrites public/fonts/noto-sans-sc/ and app/fonts.css.
#
# Part 2 — the renderer. libass (captions) and Chromium under Remotion
# (graphics) are pointed at remotion/public/fonts. The variable NotoSansSC.ttf
# there cannot answer a request for the Black weight: libass takes the
# variable file's default instance and, asked for weight 900, falls back to
# DejaVu plus CJK Regular (measured on the box, engine report §3). The
# director v2 caption spec is 72 px Noto Sans CJK SC *Black*, so the static
# Black and Bold OTFs from Google's noto-cjk release (SIL OFL 1.1) are fetched
# into that directory. Seventeen megabytes each: gitignored, refetched by this
# script at deploy, never committed.
#
# Run from the repo root.
#   fetch-cjk-font.sh             both parts
#   fetch-cjk-font.sh --otf-only  the renderer faces only (no app/fonts.css write)
#   fetch-cjk-font.sh --web-only  the webfont only
set -euo pipefail

MODE=both
case "${1:-}" in
  --otf-only) MODE=otf ;;
  --web-only) MODE=web ;;
  "") ;;
  *) echo "usage: $0 [--otf-only|--web-only]" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------- part 2
# First, because the site part rewrites app/fonts.css and a failure there
# should not leave the renderer without its faces.
fetch_otf() {
  local dir=remotion/public/fonts
  local base='https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese'
  local face file tmp size
  mkdir -p "$dir"
  for face in Black Bold; do
    file="$dir/NotoSansCJKsc-$face.otf"
    # An OpenType CFF file opens with the four bytes "OTTO"; the real ones are
    # ~17 MB. Anything else in that place — a GitHub error page saved as a
    # font, a half download — is fetched again.
    if [ -f "$file" ] && [ "$(head -c 4 "$file")" = "OTTO" ] && [ "$(stat -c %s "$file")" -gt 10000000 ]; then
      echo "have $file"
      continue
    fi
    tmp="$file.part"
    echo "fetching NotoSansCJKsc-$face.otf"
    curl -fsSL --retry 3 --retry-delay 2 --max-time 600 -o "$tmp" "$base/NotoSansCJKsc-$face.otf"
    size=$(stat -c %s "$tmp")
    if [ "$(head -c 4 "$tmp")" != "OTTO" ] || [ "$size" -le 10000000 ]; then
      rm -f "$tmp"
      echo "NotoSansCJKsc-$face.otf: not an OpenType file ($size bytes)" >&2
      exit 1
    fi
    mv "$tmp" "$file"
    echo "wrote $file ($size bytes)"
  done
  # Say what fontconfig makes of them, so a wrong family name is caught here
  # and not in a render that quietly used DejaVu.
  if command -v fc-scan >/dev/null 2>&1; then
    fc-scan --format '%{file}: %{family[0]} / %{style[0]} / weight %{weight}\n' "$dir"/NotoSansCJKsc-*.otf
  fi
}

if [ "$MODE" != web ]; then fetch_otf; fi
if [ "$MODE" = otf ]; then exit 0; fi

# ---------------------------------------------------------------- part 1
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
API='https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600&display=swap'
OUT=public/fonts/noto-sans-sc
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsS -H "User-Agent: $UA" "$API" -o "$TMP/src.css"
grep -o 'https://fonts.gstatic.com/[^)]*' "$TMP/src.css" | sort -u > "$TMP/urls.txt"
echo "$(wc -l < "$TMP/urls.txt") subsets"

mkdir -p "$OUT"
rm -f "$OUT"/*.woff2
( cd "$TMP" && xargs -P 8 -n 1 curl -fsS -O < urls.txt )

python3 - "$TMP" "$OUT" <<'PY'
import os, re, shutil, sys
tmp, out = sys.argv[1], sys.argv[2]
names = {}
for fn in os.listdir(tmp):
    if not fn.endswith(".woff2"):
        continue
    m = re.search(r"\.(\d+)\.woff2$", fn)
    names[fn] = f"noto-sans-sc-{int(m.group(1)):03d}.woff2" if m else f"noto-sans-sc-{fn[-16:]}"
    shutil.copyfile(os.path.join(tmp, fn), os.path.join(out, names[fn]))

css = open(os.path.join(tmp, "src.css"), encoding="utf-8").read()
css = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]*)\)",
             lambda m: f"url(/fonts/noto-sans-sc/{names[m.group(1).rsplit('/', 1)[-1]]})", css)
head = open("app/fonts.css", encoding="utf-8").read().split("*/\n\n", 1)[0] + "*/\n\n"
open("app/fonts.css", "w", encoding="utf-8").write(head + css)
print(len(names), "files")
PY
