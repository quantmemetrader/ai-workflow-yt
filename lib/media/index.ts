/**
 * The media library's public shapes, for type imports.
 *
 * `lib/video/v2/types.ts` names the library's `Asset` and `Candidate` as
 * `import("@/lib/media").Asset` (PLAN.md §2 Stage 0 item 4), and this is the
 * module that path resolves to. Types only, on purpose: the library's
 * runtime modules (`search`, `fetch`, `credits`) are `server-only`, and a
 * component that reads the director's types must not pull them into a
 * client bundle. The runtime entry points are imported by their own paths,
 * and by one file only: `lib/video/v2/media-adapter.ts`.
 */
export type { Asset, Candidate, FetchHandle, MediaKind, Orientation, Platform, SearchOpts, SearchProvider } from "./types";
