import "server-only";
import type { Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import type { ToolDef } from "@/lib/ai/openrouter";
import type { AgentKey } from "@/lib/agents/catalog";

/**
 * What a tool hands back, and what it is allowed to know.
 *
 * The agent used to be able to search files and nothing else, which made it an
 * assistant that could *talk about* the studio and not one that could do
 * anything in it. Every module now brings its own pack of tools, so the same
 * agent — on any screen — can summarise a channel, send a message, watch a
 * topic, or cut a video.
 *
 * Two rules hold across every pack, and they are the reason this file exists
 * rather than each module inventing its own shape:
 *
 *   1. **Every tool runs as the person.** No tool takes a tenant or a user id;
 *      they take the viewer, and each one goes through the same service the
 *      screens use, with the same permission checks. An agent physically
 *      cannot reach further than whoever invoked it (spec §2).
 *   2. **Entitlement decides what exists.** A person without the `video`
 *      module is not offered the video tools *and* cannot run them by naming
 *      one — `toolsFor` decides what is offered and `runTool` re-checks,
 *      because a model is perfectly capable of calling something it was never
 *      shown.
 */
export type ToolResult = {
  text: string;
  /** File ids the answer rests on. These become the citation list. */
  citations?: string[];
  /** Matches that exist but this person may not read. Said, never described. */
  withheld?: number;
  /**
   * Set when the tool *changed* something. The screen refreshes on it, and the
   * turn's record carries it, so an edit made by conversation leaves the same
   * trail as an edit made by hand.
   */
  changed?: boolean;
  /**
   * What the tool actually made or changed — its receipt.
   *
   * Set only on real success, never on a refusal or a failure returned as
   * text. It is the one thing an AI employee's reply is checked against
   * before it reaches a channel: 策划 once told the studio it had "just
   * finished" a script and "saved it to the library" under an id copied from
   * the channel's, having called nothing but three reads, and 剪辑师 went
   * looking for it. A claim of work done, and every id quoted, has to be
   * backed by a receipt from this turn (`lib/agents/mentions.ts`).
   */
  artifacts?: Artifact[];
};

/** The things a receipt can be about. `assignment` is a colleague being
 * handed a task through `assign_task`; its id is the message that did it. */
export type ArtifactKind =
  | "script"
  | "video_project"
  | "work_project"
  | "article"
  | "topic"
  | "file"
  | "render"
  | "competitor"
  | "assignment";

/** `started` is work handed to the worker that finishes later (making a
 * whole video), so "started" can be claimed and "finished" cannot yet. */
export type ArtifactAction = "created" | "updated" | "rendered" | "started" | "assigned";

export type Artifact = { kind: ArtifactKind; id: string; title?: string; action: ArtifactAction };

/**
 * Every id prefix `lib/ids.ts` mints, longest first so `scr_` is never read
 * as `sc…`. Kept here as a list because `IdPrefix` is a type and has no
 * value to iterate; a prefix added there and not here is simply not checked.
 */
const ID_PREFIXES = [
  "comp", "acct", "bank", "beat", "cand", "post", "shot", "team",
  "apb", "apr", "arv", "art", "aud", "bdg", "brf", "chk", "chn", "cit", "cmt", "con", "dep", "doc", "emp", "exp", "fil", "fld", "gfx", "hot", "int", "inv", "job", "lvt", "msg", "ntf", "pch", "prj", "rct", "rep", "req", "rev", "rnd", "scr", "ses", "sug", "tgt", "tnt", "top", "tpl", "trx", "tup", "use", "usr", "ver",
  "am", "bl", "cd", "cf", "ch", "cv", "kn", "lv", "pm", "rq", "sv", "tc", "wp",
] as const;

/**
 * Anything in a piece of text that looks like one of this studio's ids.
 *
 * Twenty to thirty-two characters after the prefix rather than exactly the
 * twenty-six a real one has: a model that invents an id rarely counts, and a
 * near-miss is exactly the kind of id that must be caught, not skipped.
 */
const ID_PATTERN = new RegExp(`\\b(?:${ID_PREFIXES.join("|")})_[0-9a-z]{20,32}\\b`, "gi");

export function idsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(ID_PATTERN)].map((m) => m[0].toLowerCase()))];
}

/**
 * What the person is looking at while they ask.
 *
 * Without this, "summarise this channel" and "cut that bit out" are
 * unanswerable — the model would have to guess an id, and a guessed id is
 * either wrong or someone else's. The screen says what is open; the tools
 * check the viewer may read it before using it.
 *
 * Every field is optional and every one is verified where it is used. A client
 * that sends a channel id it cannot read gets the same answer as a client that
 * sends nothing.
 */
export type ToolContext = {
  viewer: Viewer;
  /** The module whose screen is open, when the agent was opened from one. */
  module?: Module;
  /** The chat channel on screen. */
  channelId?: string;
  /** The video project on screen. */
  projectId?: string;
  /** The research topic on screen. */
  topicId?: string;
  /** The file or document on screen. */
  fileId?: string;
  /** The script on screen. */
  scriptId?: string;
  /**
   * Only tools that read. Set for an employee answering a colleague with
   * nothing verified in hand: it looks things up and says what it found, it
   * does not start work on a colleague's say-so (`lib/agents/mentions.ts`).
   */
  readOnly?: boolean;
  /**
   * Set when an AI employee is answering a tag in a channel: where in the
   * chain of hand-offs this turn sits, so a colleague it hands work to with
   * `assign_task` is counted against the same bound and the same budget as a
   * tag would be. Absent for a person's own assistant and for the panels.
   */
  team?: {
    hop: number;
    /** Employees that already answered in this branch. */
    spoken: AgentKey[];
    /** Answers left to the whole chain, shared with every branch of it. */
    budget: { left: number };
    /** Colleagues this turn has already handed work to, so its reply's own
     * `@` of them is not a second dispatch. Written by `assign_task`. */
    assigned: AgentKey[];
    /** The person who started the chain, by name, for whoever is handed
     * work further down to ask when something is missing. */
    origin: string | null;
    /** Runs once this turn's reply is posted, so the channel reads in the
     * order things happened: the hand-off, the reply, then the colleague. */
    later: (work: () => Promise<void>) => void;
  };
};

/**
 * One module's tools.
 *
 * `module` is the entitlement that gates the whole pack. `defs` is what the
 * model is shown. `run` is called only after the gate has been re-checked.
 */
export type ToolPack = {
  /** The entitlement that gates the pack, or several when any one will do:
   * the creator's own channel is read by Research, Script and Video alike. */
  module: Module | Module[];
  defs: ToolDef[];
  run: (ctx: ToolContext, name: string, args: Record<string, unknown>) => Promise<ToolResult>;
};

/** Whether a viewer holding these modules is offered this pack. */
export const holdsPack = (modules: readonly string[], pack: ToolPack): boolean =>
  (Array.isArray(pack.module) ? pack.module : [pack.module]).some((m) => modules.includes(m));

/* ---------------------------------------------------------------- reading */

/** Model arguments are never trustworthy; every read coerces. */
export const str = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export const num = (v: unknown, fallback = 0): number =>
  Number.isFinite(Number(v)) ? Number(v) : fallback;

/** An id the model produced, checked for shape before it reaches a query. */
export const id = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[a-z]{1,6}_[0-9a-z]{10,40}$/i.test(s) ? s : null;
};

/** 1:04.2 — how a person says a position in a video. */
export const clock = (ms: number): string => {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  return `${m}:${(total - m * 60).toFixed(1).padStart(4, "0")}`;
};
