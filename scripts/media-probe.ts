/**
 * The media library, from the command line.
 *
 * Searches every relevant source for a query and prints what came back,
 * one row a candidate; with `--fetch N` it takes the first N into Files
 * the way the editor would and prints their ids and credits.
 *
 *   TSX_TSCONFIG_PATH=$PWD/tsconfig.json node --env-file=.env.local --dns-result-order=ipv4first \
 *     --conditions=react-server --import tsx scripts/media-probe.ts "特斯拉 Optimus 工厂" \
 *     [--en "Tesla Optimus factory"] [--kind video|image] [--portrait|--landscape] [--limit 5] [--max 120] \
 *     [--providers douyin,youtube] [--cc] [--budget 8000] \
 *     [--fetch N --user <userId> [--folder "<name>"] [--window 10-20] [--project <projectId>] [--cleanup]]
 *
 * `--en` gives the sources that search badly in Chinese (Pinterest, the
 * stock libraries) an English query of their own. `--folder` puts the
 * imports in a top-level folder of that name, made if missing, so a test
 * run is easy to find and clear. `--cleanup` soft-deletes them again once
 * printed. `--project` records them on that project's credits.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { folders } from "@/lib/db/schema";
import { viewerById } from "@/lib/auth/viewer-by-id";
import type { Viewer } from "@/lib/auth/types";
import { createFolder, softDelete } from "@/lib/files/service";
import { searchMedia, type ProviderKey } from "@/lib/media/search";
import { fetchAssets } from "@/lib/media/fetch";
import { creditLine, creditsBlock, recordUsedAssets } from "@/lib/media/credits";
import type { Asset, Candidate } from "@/lib/media/types";

/* ------------------------------------------------------------------- args */

type Args = { query: string; en?: string; kind: "video" | "image"; orientation: "portrait" | "landscape" | "any"; limit: number; max?: number; providers?: ProviderKey[]; cc: boolean; budget: number; fetch: number; user?: string; folder?: string; window?: { start: number; end: number }; project?: string; cleanup: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { query: "", kind: "video", orientation: "any", limit: 5, cc: false, budget: 8_000, fetch: 0, cleanup: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    if (a === "--en") args.en = next();
    else if (a === "--kind") args.kind = next() === "image" ? "image" : "video";
    else if (a === "--portrait") args.orientation = "portrait";
    else if (a === "--landscape") args.orientation = "landscape";
    else if (a === "--limit") args.limit = Number(next()) || 5;
    else if (a === "--max") args.max = Number(next()) || undefined;
    else if (a === "--providers") args.providers = next().split(",").map((s) => s.trim()).filter(Boolean) as ProviderKey[];
    else if (a === "--cc") args.cc = true;
    else if (a === "--budget") args.budget = Number(next()) || 8_000;
    else if (a === "--fetch") args.fetch = Number(next()) || 1;
    else if (a === "--user") args.user = next();
    else if (a === "--folder") args.folder = next();
    else if (a === "--project") args.project = next();
    else if (a === "--cleanup") args.cleanup = true;
    else if (a === "--window") {
      const [s, e] = next().split("-").map(Number);
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) args.window = { start: s, end: e };
    } else positional.push(a);
  }
  args.query = positional.join(" ").trim();
  if (!args.query) throw new Error('usage: media-probe.ts "<query>" [--en "<english>"] [--kind video|image] [--portrait|--landscape] [--fetch N --user <id>]');
  return args;
}

/* ------------------------------------------------------------------ table */

/* CJK glyphs take two columns in a terminal; padding by string length misaligns every Chinese title. */
const width = (s: string) => Array.from(s).reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
function fit(s: string, cols: number): string {
  let out = "";
  for (const ch of Array.from(s)) {
    if (width(out + ch) > cols - 1 && width(s) > cols) {
      out += "…";
      break;
    }
    out += ch;
  }
  return out + " ".repeat(Math.max(0, cols - width(out)));
}

const fmtDuration = (ms?: number) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : "-");

function printTable(candidates: Candidate[]) {
  const cols: [string, number, (c: Candidate) => string][] = [
    ["provider", 10, (c) => c.platform],
    ["title", 40, (c) => c.title],
    ["dur", 6, (c) => fmtDuration(c.durationMs)],
    ["size", 10, (c) => (c.width && c.height ? `${c.width}x${c.height}` : c.orientation ?? "-")],
    ["author", 18, (c) => c.author.name],
    ["credit", 34, (c) => c.credit],
    ["licence", 18, (c) => c.licence ?? "-"],
    ["thumb", 60, (c) => c.thumb],
  ];
  console.log(cols.map(([h, w]) => fit(h, w)).join(" "));
  console.log(cols.map(([, w]) => "-".repeat(w)).join(" "));
  for (const c of candidates) console.log(cols.map(([, w, f]) => fit(f(c), w)).join(" "));
}

/* ----------------------------------------------------------------- folder */

async function folderNamed(viewer: Viewer, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.tenantId, viewer.tenantId), isNull(folders.parentId), eq(folders.name, name), isNull(folders.deletedAt)))
    .limit(1);
  if (existing) return existing.id;
  return (await createFolder(viewer, { name })).id;
}

/* ------------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const query = args.en ? { zh: args.query, en: args.en } : args.query;
  console.log(`search: ${JSON.stringify(query)}  kind=${args.kind} orientation=${args.orientation} limit=${args.limit}/provider budget=${args.budget}ms${args.cc ? " licence=cc" : ""}`);

  const result = await searchMedia(query, { kind: args.kind, orientation: args.orientation, limit: args.limit, maxDurationS: args.max, budgetMs: args.budget, providers: args.providers, licence: args.cc ? "cc" : "any" });
  console.log(`\n${result.candidates.length} candidates in ${result.ms} ms`);
  for (const p of result.providers) {
    console.log(`  ${fit(p.provider, 10)} ${String(p.count).padStart(2)} in ${String(p.ms).padStart(5)} ms  q="${p.query}"${p.timedOut ? "  TIMED OUT" : ""}${p.error ? `  error: ${p.error}` : ""}`);
  }
  console.log("");
  printTable(result.candidates);

  if (!args.fetch) return;
  if (!args.user) throw new Error("--fetch needs --user <userId>: the imports belong to somebody");
  const viewer = await viewerById(args.user);
  if (!viewer) throw new Error(`no such user ${args.user}`);
  const folderId = args.folder ? await folderNamed(viewer, args.folder) : null;

  const picks = result.candidates.slice(0, args.fetch);
  console.log(`\nfetching ${picks.length} into ${args.folder ? `"${args.folder}"` : "the stock folder"} as ${viewer.name}${args.window ? ` (window ${args.window.start}-${args.window.end}s)` : ""}`);
  const t0 = Date.now();
  const { assets, failed } = await fetchAssets(viewer, picks, { windowS: args.window, folderId, forLine: args.query });
  console.log(`fetched ${assets.length}, failed ${failed.length}, ${Date.now() - t0} ms`);
  for (const f of failed) console.log(`  FAILED ${f.candidate.id}: ${f.error}`);
  for (const a of assets) {
    console.log(`  ${a.fileId}  ${a.candidate.platform}  ${fmtDuration(a.durationMs)}  ${a.width ?? "?"}x${a.height ?? "?"}  ${a.cached ? "(cached) " : ""}${a.credit}  ${a.localPath ?? ""}`);
  }
  if (assets.length) {
    console.log(`\n${creditLine(assets)}\n`);
    console.log(creditsBlock(assets));
  }
  if (args.project && assets.length) {
    const recorded = await recordUsedAssets(args.project, assets, { forLine: args.query });
    console.log(`\nrecorded ${recorded.length} on project ${args.project}`);
  }
  if (args.cleanup) {
    const gone: string[] = [];
    for (const a of assets as Asset[]) {
      await softDelete(viewer, a.fileId);
      gone.push(a.fileId);
    }
    console.log(`\nsoft-deleted: ${gone.join(", ") || "nothing"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
