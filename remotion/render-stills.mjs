/**
 * Every graphic of one render, drawn in one go.
 *
 *   node render-stills.mjs specs.json
 *
 * `specs.json` is `{ width, height, accent, graphics: [{ out, props }] }`.
 *
 * The CLI bundled the composition with webpack and started a browser for
 * every single still — eleven seconds a graphic, most of it the same bundle
 * being rebuilt. This bundles once, keeps the bundle beside the sources until
 * they change, opens one browser, and draws every still through it: the first
 * render of a deployment pays for the bundle, the rest cost a few hundred
 * milliseconds each.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const specsPath = process.argv[2];
if (!specsPath) {
  console.error("usage: node render-stills.mjs specs.json");
  process.exit(2);
}
const specs = JSON.parse(readFileSync(specsPath, "utf8"));

/** The bundle, rebuilt only when a source file under src/ has changed. */
async function serveUrl() {
  const src = path.join(here, "src");
  const hash = createHash("sha1");
  for (const name of readdirSync(src).sort()) {
    const p = path.join(src, name);
    hash.update(name).update(String(statSync(p).mtimeMs)).update(String(statSync(p).size));
  }
  hash.update(readFileSync(path.join(here, "package.json")));
  const key = hash.digest("hex").slice(0, 12);
  const dir = path.join(here, ".bundle", key);
  if (existsSync(path.join(dir, "index.html"))) return dir;
  mkdirSync(path.join(here, ".bundle"), { recursive: true });
  const out = await bundle({ entryPoint: path.join(src, "index.ts"), outDir: dir, onProgress: () => {} });
  return out;
}

const started = Date.now();
const url = await serveUrl();
const bundled = Date.now() - started;

const browser = await openBrowser("chrome", { chromiumOptions: { gl: "swangle" } });
try {
  const composition = await selectComposition({
    serveUrl: url,
    id: "Overlay",
    inputProps: { cues: [], style: null, graphics: [], accent: specs.accent },
    puppeteerInstance: browser,
    logLevel: "error",
  });

  for (const g of specs.graphics) {
    await renderStill({
      // Both: `props` is what the composition renders with, `inputProps` is
      // what the root is given. Setting only the latter drew the same still
      // three times.
      composition: { ...composition, width: specs.width, height: specs.height, props: g.props },
      serveUrl: url,
      output: g.out,
      frame: 20,
      imageFormat: "png",
      inputProps: g.props,
      puppeteerInstance: browser,
      logLevel: "error",
    });
  }
  console.log(JSON.stringify({ ok: true, stills: specs.graphics.length, bundleMs: bundled, totalMs: Date.now() - started }));
} finally {
  await browser.close({ silent: true });
}
