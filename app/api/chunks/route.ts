import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Every script and stylesheet this build ships, so the browser can fetch them
 * while the person reads the first page.
 *
 * The server is in Amsterdam and the studio is in Hong Kong. A page's own
 * script loads only when its rail entry is first clicked, and every deploy
 * renames them all, so that first click after a deploy waited on a cold trip
 * to Amsterdam: 0.6 to 2 seconds of nothing. `components/shell/Warmup.tsx`
 * asks this list once per build and prefetches it at idle priority.
 *
 * The names are already public (any page references them); nothing here is
 * a secret. Read once per process: a build does not change under a running
 * server.
 */
let cached: string[] | null = null;

async function list(): Promise<string[]> {
  if (cached) return cached;
  // A release carries its own build's list (scripts/stage-release.sh): its
  // chunks folder also holds older builds' scripts, kept for tabs opened
  // before a deploy, and warming those would be wasted bandwidth.
  try {
    const own = JSON.parse(await readFile(path.join(process.cwd(), "chunks.json"), "utf8")) as unknown;
    if (Array.isArray(own)) {
      cached = own.filter((x): x is string => typeof x === "string");
      return cached;
    }
  } catch {
    // Not a release (a plain `next start`): read the folder.
  }
  for (const dist of [".next-build", ".next"]) {
    try {
      const names = await readdir(path.join(process.cwd(), dist, "static", "chunks"));
      cached = names.filter((n) => n.endsWith(".js") || n.endsWith(".css")).map((n) => `/_next/static/chunks/${n}`);
      return cached;
    } catch {
      // try the next place
    }
  }
  cached = [];
  return cached;
}

export async function GET() {
  return Response.json({ files: await list() }, { headers: { "cache-control": "private, max-age=300" } });
}
