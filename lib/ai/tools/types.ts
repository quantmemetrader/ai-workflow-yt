import "server-only";
import type { Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import type { ToolDef } from "@/lib/ai/openrouter";

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
};

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
