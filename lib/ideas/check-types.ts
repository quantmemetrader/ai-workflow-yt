/**
 * 研究员's check on a topic somebody typed into Home's task box
 * (client-safe types; the work is in `lib/ideas/check.ts`).
 *
 * The client's gap: "without research on the title it just goes straight to
 * script generation". A typed topic now goes to 研究员 first, who reads the
 * stored research for it and answers with a verdict, three titles and the
 * rows behind them. The answer is also an ordinary idea (`ideas` row, seed =
 * what was typed), so it can be started like any other idea and shows in the
 * ideas panel on the next visit.
 */
import type { Idea, IdeaEvidence } from "@/lib/ideas/types";

/**
 * hot      on the lists now, and not yet done to death
 * warm     some heat, nothing special
 * cold     the stored data barely mentions it
 * crowded  hot, but many accounts have already made the same video
 */
export type CheckLevel = "hot" | "warm" | "cold" | "crowded";

export type TitleOption = {
  title: string;
  /** One line on why this title, from 研究员. */
  why: string;
};

export type TitleCheck = {
  /** The stored idea: `title` is the first option, `titles` the other two. */
  idea: Idea;
  /** The topic as it was checked, the employee tags taken out. */
  text: string;
  verdict: { level: CheckLevel; line: string };
  /** Three titles, 研究员's favourite first. */
  options: TitleOption[];
  /** One to three rows that support the verdict, with their own numbers. */
  evidence: IdeaEvidence[];
  /** Videos on the same subject that did well, from the stored rows. */
  similar: IdeaEvidence[];
  risk: string | null;
  /** Too little stored data on this topic to say much; the card says so. */
  thin: boolean;
  /** 研究员's short answer in the conversation: the verdict, or what changed. */
  reply: string;
  /** What was read, so the card can say it plainly: stored list snapshots,
   * how many lists, the rows directly about the topic, the channel's uploads. */
  scanned: { snapshots: number; lists: number; related: number; channel: number; days: number };
  /** The search words, one entry per idea in the topic ("AI/人工智能/大模型"). */
  terms: string[];
  /** The same words in full, sent back with a follow-up so every round
   * searches the rows the same way. */
  groups: string[][];
  model: string;
};

/** What the card sends back for another round. */
export type CheckPrevious = { id: string; instructions?: string[]; groups?: string[][] };
