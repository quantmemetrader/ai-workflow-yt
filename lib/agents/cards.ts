/**
 * The buttons an AI employee puts under what it says.
 *
 * The studio's ask was for agents that "can execute itself, less like a
 * working platform with a AI, but more agentic" — and the half of that which
 * is not autonomy is this: when an agent finishes something, the next step
 * should be one press, not a sentence somebody has to compose.
 *
 * A card action is deliberately one of only two things:
 *
 *   — **say**: post a prepared line into the same channel, *as the person who
 *     pressed it*. That is all an approval is here. It routes through the same
 *     `postMessage` and the same `dispatchAgentMentions` a typed message does,
 *     so a button can start an agent but cannot reach anything a person in
 *     that room could not reach by typing. Nothing is signed by the agent, and
 *     nothing skips a permission check.
 *   — **open**: a link. Approving a script, granting access, spending money —
 *     anything with a real gate behind it — is a link to the screen that holds
 *     the gate, never a button that pretends to be it.
 *   — **run**: one of a short, fixed list of operations a screen already
 *     offers as its own button, by name (`RUN_OPS`), about one project. The
 *     press is checked exactly as that screen's route checks it — the same
 *     module, the same "may you edit this project" — so it reaches nothing
 *     the presser could not start from the project page. 剪辑师 asking for
 *     the host's clips offers "先用素材库画面": the project page's stock
 *     footage one-go, one press from where the question was asked.
 *
 * Kept out of `lib/agents/index.ts` because the message list has to draw these
 * and that file is `server-only`.
 */
export type CardActionKind = "say" | "open" | "run";

/** The operations a `run` button may name. Anything else is dropped. */
export const RUN_OPS = ["stock-cut"] as const;
export type RunOp = (typeof RUN_OPS)[number];

export type CardAction = {
  /** Unique within its message; what the press names. */
  id: string;
  label: string;
  labelEn: string;
  kind: CardActionKind;
  /** `say`: the line posted into the channel. */
  body?: string;
  /** `open`: where it goes, always a path inside this app. */
  href?: string;
  /** `run`: which operation, and the project (`wp_…`) it is about. */
  op?: RunOp;
  projectId?: string;
  tone?: "primary" | "quiet";
};

/** Who pressed what, written back onto the message so the card stops offering
 * a decision that has already been made. */
export type CardDone = { actionId: string; by: string; at: string };

const MAX_ACTIONS = 4;
const MAX_LABEL = 40;
const MAX_BODY = 2_000;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/**
 * The actions on a message, validated.
 *
 * `meta` is a jsonb column: whatever is in it got there from this codebase,
 * but it is still read back as `unknown` and a row written by an older version
 * is a normal thing to meet. Anything that does not check out is dropped
 * rather than drawn.
 */
export function readCardActions(meta: unknown): CardAction[] {
  const raw = (meta as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(raw)) return [];

  const out: CardAction[] = [];
  for (const item of raw.slice(0, MAX_ACTIONS)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const id = str(a.id, 64);
    const label = str(a.label, MAX_LABEL);
    const labelEn = str(a.labelEn, MAX_LABEL) ?? label;
    if (!id || !label || !labelEn) continue;
    if (out.some((x) => x.id === id)) continue;

    if (a.kind === "say") {
      const body = str(a.body, MAX_BODY);
      if (!body) continue;
      out.push({ id, label, labelEn, kind: "say", body, tone: tone(a.tone) });
    } else if (a.kind === "open") {
      const href = str(a.href, 512);
      // Inside this app only. An absolute URL on a button an agent wrote is a
      // link to somewhere the studio did not agree to go.
      if (!href || !href.startsWith("/") || href.startsWith("//")) continue;
      out.push({ id, label, labelEn, kind: "open", href, tone: tone(a.tone) });
    } else if (a.kind === "run") {
      const op = (RUN_OPS as readonly string[]).includes(String(a.op)) ? (a.op as RunOp) : null;
      const projectId = str(a.projectId, 64);
      if (!op || !projectId || !/^wp_[0-9a-z]{10,40}$/i.test(projectId)) continue;
      out.push({ id, label, labelEn, kind: "run", op, projectId, tone: tone(a.tone) });
    }
  }
  return out;
}

function tone(value: unknown): CardAction["tone"] {
  return value === "primary" ? "primary" : "quiet";
}

export function readCardDone(meta: unknown): CardDone | null {
  const raw = (meta as { done?: unknown } | null)?.done;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const actionId = str(d.actionId, 64);
  const by = str(d.by, 200);
  const at = str(d.at, 40);
  return actionId && by && at ? { actionId, by, at } : null;
}
