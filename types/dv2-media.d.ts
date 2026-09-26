/**
 * The media library's record shapes, declared ahead of the library itself.
 *
 * `lib/video/v2/types.ts` names `import("@/lib/media").Candidate` and
 * `.Asset`, as the plan writes them. The library is being built on the
 * `wt-msrc` worktree (`lib/media/types.ts`, commit 3209f8f) and is not on
 * `wt-dv2` yet, so on this branch that import would resolve to nothing and
 * every workstream's `tsc` would fail on a file it is not allowed to touch.
 *
 * This is an *ambient* module declaration, not a stub file: TypeScript only
 * consults it when module resolution finds no real `lib/media`. The moment
 * `wt-msrc` is merged, the real module wins and this file is dead; delete it
 * in the same merge commit. Nothing may import from it at runtime, and
 * nothing does — it declares types only.
 *
 * Copied from `wt-msrc:lib/media/types.ts` so W3 codes against the shapes
 * the library actually has (`thumb`, `durationMs`, `author.name`, a
 * `handle` the fetcher reads), not the ones §2 item 9 of the plan guessed.
 */
declare module "@/lib/media" {
  export type MediaKind = "video" | "image";

  export type Platform = "douyin" | "tiktok" | "bilibili" | "youtube" | "pinterest" | "bing" | "pexels" | "unsplash" | "openverse";

  export type Orientation = "portrait" | "landscape" | "square";

  /** How the bytes are obtained. Opaque to the editor; only the fetcher reads it. */
  export type FetchHandle =
    | { via: "direct"; url: string; headers?: Record<string, string>; expiresAt?: string }
    | { via: "yt-dlp"; url: string; fallbackUrl?: string }
    | { via: "image"; url: string; fallbackUrl?: string; headers?: Record<string, string> };

  export type Candidate = {
    /** `<platform>:<the platform's own id>` — stable across searches. */
    id: string;
    kind: MediaKind;
    platform: Platform;
    title: string;
    description?: string;
    /** The permalink a person can open, never a CDN address. */
    url: string;
    author: { name: string; url?: string; id?: string };
    /** A thumbnail that can be fetched right now, for a judge or a picker. */
    thumb: string;
    durationMs?: number;
    width?: number;
    height?: number;
    orientation?: Orientation;
    stats?: { views?: number; likes?: number };
    /** ISO date, when the platform said. */
    publishedAt?: string;
    handle: FetchHandle;
    /** "Pexels License", "CC BY 4.0", "stock:<domain>"; absent for a platform clip. */
    licence?: string;
    /** Ready to print: "抖音 @作者", "YouTube · 频道". */
    credit: string;
  };

  /** A candidate that has been taken into the studio's own Files. */
  export type Asset = {
    fileId: string;
    candidate: Candidate;
    /** The normalised file on this machine, while it is still there. */
    localPath?: string;
    credit: string;
    fetchedAt: string;
    durationMs?: number;
    width?: number;
    height?: number;
    window?: { start: number; end: number };
    /** True when this run had already fetched the same clip and window. */
    cached?: boolean;
  };
}
