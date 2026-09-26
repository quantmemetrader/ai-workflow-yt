import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { checkTitle, chooseCheckTitle, cleanGroups } from "@/lib/ideas/check";

/**
 * 研究员's check on a topic typed into Home's task box (`lib/ideas/check.ts`).
 *
 * POST { text, previous?, instruction? } — check it, or have another round
 * ("换个角度") on the idea the last round stored. Ten to twenty seconds of
 * model work as a rule (at most `CHECK_BUDGET_MS`), so it is awaited here in
 * a route handler and not in a server action, which would hold up every
 * navigation behind it; the card on Home shows its own progress meanwhile.
 *
 * PATCH { id, title } — the title picked on the card becomes the idea's own,
 * just before `startFromTopicAction` makes the project from it.
 */
export const maxDuration = 120;

function allowed(modules: readonly string[]) {
  return modules.includes("chat") || modules.includes("research");
}

export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !allowed(viewer.modules)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; previous?: unknown; instruction?: unknown };
  const text = typeof body.text === "string" ? body.text.slice(0, 400) : "";
  const prev = body.previous && typeof body.previous === "object" ? (body.previous as { id?: unknown; instructions?: unknown; groups?: unknown }) : null;
  /* The idea is read back on the server by id; the earlier lines and the
     search words are the person's own and only steer the next round. */
  const previous =
    prev && typeof prev.id === "string"
      ? {
          id: prev.id.slice(0, 64),
          instructions: Array.isArray(prev.instructions) ? prev.instructions.filter((x): x is string => typeof x === "string").slice(-3) : [],
          groups: cleanGroups(prev.groups),
        }
      : null;
  const instruction = typeof body.instruction === "string" ? body.instruction.slice(0, 200) : null;
  try {
    const res = await checkTitle(viewer, { text, previous, instruction });
    if (!res.ok) return Response.json({ error: res.error }, { status: 422 });
    return Response.json({ check: res.check }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    /* Logged in full; the card gets a plain line (a database error's text
       is no use to the person and says more about the system than it should). */
    console.error("[ideas/check] check", err);
    const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
    return Response.json({ error: zh ? "研究员这次没看完（服务器出错），再试一次。" : "The researcher could not finish (a server error); try again." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !allowed(viewer.modules)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; title?: unknown };
  if (typeof body.id !== "string" || typeof body.title !== "string") return Response.json({ error: "Say id and title" }, { status: 400 });
  const idea = await chooseCheckTitle(viewer, body.id.slice(0, 64), body.title.slice(0, 120));
  if (!idea) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ idea });
}
