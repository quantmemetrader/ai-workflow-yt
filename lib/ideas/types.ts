/**
 * Video ideas worked out from the stored research (client-safe types).
 *
 * The shapes Home's ideas panel and the ideas service agree on. The table is
 * `ideas` (lib/db/schema/project.ts).
 */
export type IdeaEvidence = {
  /** Where it came from, e.g. "抖音财经榜" or "微博热搜". */
  label: string;
  title: string;
  url: string | null;
  /** The numbers that make it evidence, already formatted ("播放 2759万 · 赞率 4.1%"). */
  numbers: string;
  thumbnail?: string | null;
  platform?: string | null;
};

export type IdeaStatus = "new" | "saved" | "started" | "dismissed";

export type Idea = {
  id: string;
  batchId: string;
  seed: string | null;
  title: string;
  /** Other ways to title it. */
  titles: string[];
  angle: string | null;
  why: string | null;
  hook: string | null;
  format: string | null;
  /** 1-5. */
  strength: number | null;
  evidence: IdeaEvidence[];
  status: IdeaStatus;
  projectId: string | null;
  createdAt: string;
};
