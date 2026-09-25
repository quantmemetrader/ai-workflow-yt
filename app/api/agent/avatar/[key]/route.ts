import { AGENT_KEYS } from "@/lib/agents/catalog";
import { spriteSvg, type SpriteKey } from "@/lib/agents/pixel";

/**
 * An AI employee's face as an image file.
 *
 * Nearly everywhere draws the faces inline (`AgentIcon`), but two places only
 * know a user row's `avatar_url` — the member faces in a channel's header and
 * the members sheet — and showed the employees there as grey initials ("研").
 * `ensureAgent` points each agent's `avatar_url` here, so those two show the
 * same pixel face as the message list.
 *
 * A URL rather than a `data:` URI on the row: the URL is ~30 bytes in every
 * message's payload, the SVG ~1.4KB, and the channel re-renders every few
 * seconds. The sprite is built from code, the same for every studio, and says
 * nothing about anybody, so it is served without a database read and cached
 * for a year; the `?v=` on the stored URL is what changes when a face does.
 *
 * `content-type` is set exactly: the app sends `nosniff`, so an SVG served as
 * anything else would not draw.
 */
const KEYS: readonly SpriteKey[] = [...AGENT_KEYS, "host"];

export async function GET(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!(KEYS as readonly string[]).includes(key)) return new Response("Not found", { status: 404 });

  return new Response(spriteSvg(key as SpriteKey), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
