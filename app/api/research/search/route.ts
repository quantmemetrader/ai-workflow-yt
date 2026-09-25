import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { SEARCH_PLATFORMS, searchPlatform, type SearchPlatform } from "@/lib/research/platform-search";

/** A phrase on one platform, as a plain GET (see platform-search.ts). */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const platform = req.nextUrl.searchParams.get("platform") as SearchPlatform;
  if (!q || !SEARCH_PLATFORMS.includes(platform)) return Response.json({ error: "Say what and where" }, { status: 400 });
  const res = await searchPlatform(platform, q);
  return Response.json(res, { headers: { "Cache-Control": "private, max-age=300" } });
}
