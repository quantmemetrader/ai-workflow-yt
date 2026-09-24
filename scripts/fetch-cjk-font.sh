#!/usr/bin/env bash
# Refetch the self-hosted Simplified Chinese webfont.
#
# The site ships Noto Sans SC rather than asking for 'PingFang SC' and hoping:
# a Hong Kong Mac answers that with PingFang HK and a Hong Kong PC with
# Microsoft JhengHei, both Traditional cuts, which is how correct text ended up
# drawn in the wrong characters. Google's unicode-range subsetting is kept, so
# a page downloads the two or three of the 101 files it needs.
#
# Run from the repo root. Rewrites public/fonts/noto-sans-sc/ and app/fonts.css.
set -euo pipefail

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
