import { readdir } from "node:fs/promises";
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
  const dir = path.join(process.cwd(), ".next", "static", "chunks");
  try {
    const names = await readdir(dir);
    cached = names.filter((n) => n.endsWith(".js") || n.endsWith(".css")).map((n) => `/_next/static/chunks/${n}`);
  } catch {
    cached = [];
  }
  return cached;
}

export async function GET() {
  return Response.json({ files: await list() }, { headers: { "cache-control": "private, max-age=300" } });
}
