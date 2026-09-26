/**
 * A video in a chat message, as the message list draws it.
 *
 * The owner, after 剪辑师 finished a cut: "when the agent says done, we
 * should get a download button or view button or a small preview right
 * there in chat." A message used to *name* a render — "渲染好了，可以在
 * 导出里下载了" — and leave the reader to go and find it. Now any message
 * that names a finished render or a video file carries a card: a poster
 * that plays the small copy in place, the length and size, and the presses
 * that matter (下载, 打开项目, 在剪辑台打开).
 *
 * This file is the pure half: the card's shape, and the reader that finds
 * what a message names. The server half (`lib/chat/videos.ts`) turns those
 * ids into cards, for one reader, with the same permission checks every
 * other read makes — so the list (a client component) and the pages (server)
 * share one reading and no `server-only` import.
 */
export type VideoCard = {
  /** A finished render (`video_exports`), or a video file (an upload). */
  kind: "render" | "file";
  /** The export's id, or the file's. */
  id: string;
  /** The full file: what 下载 hands over. */
  fileId: string;
  /** The 480p copy to play in place; null plays the file itself. */
  proxyFileId: string | null;
  title: string;
  durationMs: number | null;
  sizeBytes: number | null;
  /** "9:16" for a render; worked out from the frame for a file; null unknown. */
  aspect: string | null;
  /** The video project it belongs to (the editor), when the reader may open it. */
  videoProjectId: string | null;
  /** The project it belongs to (the page), when the reader may see it. */
  project: { id: string; title: string } | null;
  /** An upload this message also put in a project's bin ("已加入项目素材"). */
  binned: boolean;
};

/** What a message names, before anything is checked. */
export type VideoRefs = { exportIds: string[]; fileIds: string[]; jobIds: string[] };

const RENDER_ID = /\brnd_[0-9a-z]{20,32}\b/gi;
const FILE_ID = /\bfil_[0-9a-z]{20,32}\b/gi;

function str(value: unknown, max = 64): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/**
 * Every render and video file a message might be about, from wherever a
 * message keeps such a thing:
 *
 *   — `meta.render` — the worker's "渲染好了" line, which names its export
 *     and file outright (`lib/agents/narrate.ts`);
 *   — `meta.narration.jobId` — the same line written before it did: the job
 *     row still knows which export it rendered;
 *   — `meta.receipts` and `meta.handoff.artifacts` — what an employee's turn
 *     made or handed on, when one of those is a render or a file;
 *   — `meta.attachments` — files a person put on the message;
 *   — and ids written in the text itself.
 *
 * Ids only, never a title or a link from the message: everything is re-read
 * from the tables for the reader, and anything they may not open is simply
 * not a card.
 */
export function videoRefsOf(meta: unknown, body: string | null | undefined): VideoRefs {
  const exportIds = new Set<string>();
  const fileIds = new Set<string>();
  const jobIds = new Set<string>();
  const m = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};

  const render = m.render as { exportId?: unknown; fileId?: unknown } | undefined;
  if (render && typeof render === "object") {
    const e = str(render.exportId);
    const f = str(render.fileId);
    if (e) exportIds.add(e);
    if (f) fileIds.add(f);
  }

  const narration = m.narration as { jobId?: unknown; type?: unknown; phase?: unknown } | undefined;
  if (narration && typeof narration === "object" && narration.phase === "done") {
    const j = str(narration.jobId);
    if (j && (narration.type === "video.export" || narration.type === "video.direct")) jobIds.add(j);
  }

  const take = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list.slice(0, 12)) {
      if (!item || typeof item !== "object") continue;
      const a = item as { kind?: unknown; id?: unknown; fileId?: unknown };
      const id = str(a.id) ?? str(a.fileId);
      if (!id) continue;
      if (a.kind === "render") exportIds.add(id);
      else if (a.kind === "file" || a.kind === "video" || a.kind === undefined) fileIds.add(id);
    }
  };
  take(m.receipts);
  take((m.handoff as { artifacts?: unknown } | undefined)?.artifacts);
  take(m.attachments);

  for (const id of (body ?? "").match(RENDER_ID) ?? []) exportIds.add(id.toLowerCase());
  for (const id of (body ?? "").match(FILE_ID) ?? []) fileIds.add(id.toLowerCase());

  return { exportIds: [...exportIds], fileIds: [...fileIds], jobIds: [...jobIds] };
}

/** Whether a message names anything worth looking up. */
export function hasVideoRefs(refs: VideoRefs): boolean {
  return refs.exportIds.length > 0 || refs.fileIds.length > 0 || refs.jobIds.length > 0;
}

/** "2:31", or "1:02:05" past an hour — a video's length, as a card says it. */
export function videoClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "48 MB" — a file's size, as a card says it. */
export function videoBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "9:16" from a frame's size; null when the frame is unknown. */
export function aspectOf(width: number | null | undefined, height: number | null | undefined): string | null {
  if (!width || !height) return null;
  const r = width / height;
  if (Math.abs(r - 16 / 9) < 0.08) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.08) return "9:16";
  if (Math.abs(r - 1) < 0.08) return "1:1";
  if (Math.abs(r - 4 / 3) < 0.08) return "4:3";
  return r > 1 ? "16:9" : "9:16";
}
