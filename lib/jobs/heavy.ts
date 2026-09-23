/**
 * Heavy work, paused until the studio moves to a bigger server.
 *
 * Rendering (an export, or the director's cut-and-render) and auto-edit run
 * FFmpeg and Chrome on the box for minutes at a time, and the current box
 * cannot take that next to everything else it runs. Requests are still
 * accepted and kept in the queue; the worker just does not claim them, so they
 * start on their own once this is switched back on. The Video screen says so,
 * so nobody waits on a render that is not coming.
 *
 * Switch back on with HEAVY_JOBS_PAUSED=0 in the worker's and the app's env.
 *
 * Done 2026-09-23: the studio is on the 16-core / 64 GB box, and .env.local
 * sets HEAVY_JOBS_PAUSED=0. The default stays "paused" so a box without that
 * line — a fresh checkout, a small staging machine — cannot be flattened by a
 * render nobody expected.
 */
export const HEAVY_JOB_TYPES = ["video.export", "video.direct", "video.autoedit"] as const;

export const HEAVY_JOBS_PAUSED = process.env.HEAVY_JOBS_PAUSED !== "0";
