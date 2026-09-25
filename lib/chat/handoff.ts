import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";

/**
 * A hand-off, as the message list draws it.
 *
 * The "交给 剪辑师" line under a message used to be read back out of the text:
 * any `@剪辑师` in what an agent wrote became a hand-off chip, which is how a
 * planner claiming work it had not done turned into a real-looking hand-over
 * (reports/agent-fight.md). A checked hand-off now travels beside the text as
 * `meta.handoff = { from, to, artifacts, verified: true }`, written by the
 * dispatcher once the work behind it has been seen to exist; this is the
 * reader for that, and the chip links straight to what was handed over.
 *
 * Two older shapes are still in the table and still meant something:
 *
 *   — `{ scriptId, projectId, from: "script-page" }`, from the script page's
 *     "send to the editor" button (`home/actions.ts`), and
 *   — `{ scriptId, versionNo, approvalId, projectId, approvedBy }`, from an
 *     approved script (`lib/agents/handoff.ts`).
 *
 * Both were always a script going to the editor, with real ids, so they are
 * read as that. Anything else — including a new-shape hand-off that is not
 * marked verified — is not a hand-off here, and the message falls back to
 * what its text says (see `Handoff` in ChannelSurface).
 *
 * Pure and dependency-free, so the pages (server) and the list (client) share
 * one reading. `meta` is a jsonb column and arrives as `unknown`; anything that
 * does not check out is dropped rather than drawn.
 */
export type HandoffArtifact = {
  kind: string;
  id: string;
  title: string | null;
  /** Always a path inside this app, or null when there is nowhere to go. */
  href: string | null;
};

export type ChatHandoff = {
  from: AgentKey | "human";
  to: AgentKey;
  artifacts: HandoffArtifact[];
  /** False for the two older shapes above: real, but written before checks. */
  verified: boolean;
};

const MAX_ARTIFACTS = 6;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;
}

function agentKey(value: unknown): AgentKey | null {
  return typeof value === "string" && (AGENT_KEYS as readonly string[]).includes(value) ? (value as AgentKey) : null;
}

/**
 * A path inside this app. `//host` and `https://…` are somewhere else, and so
 * is `/\host`: browsers read a backslash as a slash, so it is a second way
 * of writing `//host`. Whitespace is refused with it (a tab or a newline is
 * dropped by the URL parser, which is how `/\t/host` would become `//host`).
 */
function localHref(value: unknown): string | null {
  const href = str(value, 512);
  return href && href.startsWith("/") && !href.startsWith("//") && !/[\\\s]/.test(href) ? href : null;
}

/**
 * Where an artifact of a given kind lives, when the hand-off did not say.
 * Only kinds with a page of their own; the rest are drawn without a link.
 */
export function artifactHref(kind: string, id: string): string | null {
  const safe = encodeURIComponent(id);
  switch (kind) {
    case "script":
      return `/script/${safe}`;
    case "project":
    case "work_project":
      return `/projects/${safe}`;
    case "video":
    case "video_project":
      return `/video?project=${safe}`;
    case "file":
      return `/files/${safe}`;
    default:
      return null;
  }
}

function readArtifacts(raw: unknown): HandoffArtifact[] {
  if (!Array.isArray(raw)) return [];
  const out: HandoffArtifact[] = [];
  for (const item of raw.slice(0, MAX_ARTIFACTS)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const kind = str(a.kind, 32);
    const id = str(a.id, 64);
    if (!kind || !id) continue;
    if (out.some((x) => x.kind === kind && x.id === id)) continue;
    out.push({ kind, id, title: str(a.title, 120), href: localHref(a.href) ?? artifactHref(kind, id) });
  }
  return out;
}

/** The hand-off a message carries, or null when it carries none we trust. */
export function readHandoff(meta: unknown): ChatHandoff | null {
  const raw = (meta as { handoff?: unknown } | null)?.handoff;
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;

  // The checked shape.
  const to = agentKey(h.to);
  if (to) {
    if (h.verified !== true) return null;
    return {
      from: agentKey(h.from) ?? "human",
      to,
      artifacts: readArtifacts(h.artifacts),
      verified: true,
    };
  }

  // The two older shapes: a script on its way to the editor.
  const scriptId = str(h.scriptId, 64);
  if (!scriptId) return null;
  const projectId = str(h.projectId, 64);
  const artifacts: HandoffArtifact[] = [{ kind: "script", id: scriptId, title: null, href: artifactHref("script", scriptId) }];
  if (projectId) artifacts.push({ kind: "video", id: projectId, title: null, href: artifactHref("video", projectId) });
  return { from: "script", to: "video", artifacts, verified: false };
}

/**
 * What kind of message this is, for the list to frame it: the researcher's
 * morning brief and the planner's day plan are documents, not chat lines, and
 * are drawn as a card. Null for everything else.
 */
export type ChatCardKind = "digest" | "plan";

export function readCardKind(meta: unknown): ChatCardKind | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (m.digest && typeof m.digest === "object") return "digest";
  if (m.plan && typeof m.plan === "object") return "plan";
  return null;
}
