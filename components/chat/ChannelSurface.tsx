"use client";

import * as React from "react";
import Link from "next/link";
import { formatTextarea, type Format } from "@/components/canvas/composer-format";
import { FormattedPreview, HAS_MARKUP } from "@/components/ui/FormattedPreview";
import { Markdown } from "@/components/ui/Markdown";
import { JUMP_EVENT } from "@/components/shell/CommandPalette";
import { AGENT_COLORS, AGENT_LABELS, AGENT_TINTS, isTagStart, parseAgentMentions, splitMentions, type AgentKey } from "@/lib/agents/catalog";
import {
  AgentMark,
  MentionMenu,
  filterTargets,
  mentionTargets,
  type MentionPerson,
  type MentionTarget,
} from "./MentionMenu";
import { bytes, uploadToStudio, type Attaching } from "./upload";
import type { CardAction, CardDone } from "@/lib/agents/cards";
import type { ChatCardKind, ChatHandoff, HandoffArtifact } from "@/lib/chat/handoff";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon, type IconName } from "@/components/ui/Icon";
import { clock, dayLabel, minutesBetween, sameDay } from "./when";
import { initials, soft, threadCss, tidyMarkdown, withoutLeadingPictures } from "./look";
import type { StepKey } from "@/lib/agents/steps";
import { JobChip, WorkingPill } from "./Working";

/**
 * The channel's main column: header, messages, composer.
 *
 * Grown from `components/canvas/ChannelScreen.tsx` — the artboard transcription
 * — and kept to its markup, classes and pixel values, so the two can be read
 * side by side and folded back together. It exists separately because the
 * three things the studio asked for all land in this one column and none of
 * them are in the artboard:
 *
 *   1. **Roles you can see.** An AI employee's message carries its pixel
 *      face and its job — "AI 员工 · 视频" — in that employee's colour, not a
 *      grey APP pill that could be any integration. "so i think just make
 *      each role clearer in the chat".
 *   2. **Tagging.** `@` opens a picker of people *and* agents, and a tag that
 *      names an agent is drawn as the agent, not as blue text.
 *   3. **Files.** An attach button, because there was not one.
 */

export type ChannelAttachment = { id: string; name: string; kind: string; sizeBytes: number | null };

export type ChannelMessage = {
  id: string;
  authorName: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  /** Written by one of the studio's AI employees. */
  isAgent?: boolean;
  /** Which one, so it gets its own icon and colour. */
  agentKey?: AgentKey | null;
  /** The agent's job, straight off its user row: "AI 员工 · 视频". */
  roleLabel?: string | null;
  attachments?: ChannelAttachment[];
  /** The buttons an AI employee put under this message. */
  actions?: CardAction[];
  /** Set once somebody has pressed one of them. */
  done?: CardDone | null;
  /** A checked hand-off recorded beside the text (`meta.handoff`). */
  handoff?: ChatHandoff | null;
  /** A morning brief or a day plan, drawn as a document rather than a line. */
  card?: ChatCardKind | null;
  /** On screen but not yet acknowledged by the server. Drawn a shade back, so
   * "sent" and "sending" are not the same picture. */
  pending?: boolean;
  /** The project this message's work is in, when the reader may see it:
   * drawn as an "打开项目" button. */
  project?: { id: string; title: string } | null;
  /** A director run or a render it started, followed by a live chip. */
  job?: { videoProjectId: string } | null;
};

/** An employee at work in the room right now (`lib/chat/pending.ts`). */
export type ChannelPending = {
  id: string;
  agent: AgentKey;
  step: StepKey;
  /** When the turn started (ISO). */
  since: string;
  job?: { videoProjectId: string } | null;
};

export type ChannelMember = { name: string; avatar: string | null };

/**
 * How long a run of messages from one person stays one block. Within it the
 * name, badge and face are drawn once and the rest sit under them; past it,
 * or across a day, the author is named again. Worked out from the messages'
 * own timestamps, so the server and the browser group identically.
 */
const GROUP_MINUTES = 5;

/**
 * The list's own rules on top of the shared thread rules (`threadCss`): the
 * brief and plan drawn as documents, the hand-off line, the header buttons.
 *
 * Two of them tune the shared ones for a channel: a little more room above a
 * new author (12, was 10), because a message here often ends in a hand-off
 * line and the next author's name sat right under it; and the hand-off line
 * itself, which leads with an arrow and a readable grey so "交给 剪辑师"
 * reads as work passed on, not as a caption.
 */
const CSS = `
${threadCss("[data-chat-surface]")}
[data-chat-surface] .msg { padding-top: 12px; padding-bottom: 4px; }
[data-chat-surface] .doc { margin-top: 7px; max-width: calc(72ch + 34px); border-radius: 12px; padding: 12px 16px 13px; }
[data-chat-surface] .doc .txt { margin-top: 0; }
[data-chat-surface] .doc .txt > div > p:first-child { font-size: 14.5px; }
[data-chat-surface] .handoff { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
[data-chat-surface] .handoff .lbl2 { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: #8a8a8a; }
[data-chat-surface] .handoff.quiet .lbl2 { color: #a3a3a3; }
[data-chat-surface] .handoff .lbl2 svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
[data-chat-surface] .handoff .to { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px 0 4px; border-radius: 8px; font-size: 12px; font-weight: 600; color: #171717; border: 1px solid transparent; }
[data-chat-surface] .handoff.quiet .to { font-weight: 500; color: #525252; background: #fff; border: 1px dashed #d4d4d4; }
[data-chat-surface] .handoff .art { display: inline-flex; align-items: center; gap: 5px; height: 24px; max-width: 260px; padding: 0 9px; border-radius: 8px; border: 1px solid #e5e5e5; background: #fff; font-size: 12px; color: #404040; text-decoration: none; }
[data-chat-surface] .handoff .art span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-chat-surface] a.art:hover { border-color: #c7c7c7; color: #171717; }
[data-chat-surface] .proj { display: inline-flex; align-items: center; gap: 6px; height: 24px; max-width: 320px; padding: 0 10px 0 8px; border-radius: 8px; border: 1px solid #d4d4d4; background: #fff; color: #171717; font-size: 12px; font-weight: 500; text-decoration: none; }
[data-chat-surface] .proj svg { color: #525252; flex-shrink: 0; }
[data-chat-surface] .proj span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-chat-surface] a.proj:hover { border-color: #a3a3a3; background: #fafafa; }
[data-chat-surface] .hdr-btn { background: transparent; border: 0; cursor: pointer; padding: 0; }
[data-chat-surface] .hdr-btn:hover, [data-chat-surface] .ico2.note:hover { background: #f4f4f5; }
`;

/**
 * What each kind of hand-over is called, and drawn with — every kind a
 * receipt can name (`ArtifactKind` in lib/ai/tools/types), plus the two the
 * older hand-offs used. A kind this list does not know is still drawn, as
 * "内容", rather than as its raw English id in a Chinese sentence.
 */
const ARTIFACT: Record<string, { zh: string; en: string; icon: IconName }> = {
  script: { zh: "脚本", en: "Script", icon: "pen" },
  video: { zh: "视频项目", en: "Video project", icon: "clapper" },
  video_project: { zh: "视频项目", en: "Video project", icon: "clapper" },
  project: { zh: "项目", en: "Project", icon: "spark" },
  work_project: { zh: "项目", en: "Project", icon: "spark" },
  file: { zh: "文件", en: "File", icon: "upload" },
  article: { zh: "文章", en: "Article", icon: "comment" },
  topic: { zh: "选题", en: "Topic", icon: "bulb" },
  render: { zh: "成片", en: "Render", icon: "film" },
  competitor: { zh: "对标账号", en: "Channel to watch", icon: "eye" },
  assignment: { zh: "任务", en: "Task", icon: "check" },
};
const OTHER_ARTIFACT = { zh: "内容", en: "Item", icon: "external" as IconName };

/**
 * @mentions carry the artboard's .ment pill — and an agent's tag carries that
 * employee's own colour, because "I asked a colleague" and "I asked the video
 * agent" are different events and used to look identical.
 *
 * A message with formatting in it — the composer's own B, I, link and list
 * buttons write Markdown — is drawn as formatted. The tags in it are still
 * named underneath, by `Handoff`, so a hand-off reads as a hand-off either way.
 */
function Body({ body }: { body: string }) {
  if (HAS_MARKUP.test(body)) {
    return (
      <div className="txt">
        <Markdown text={tidyMarkdown(body)} />
      </div>
    );
  }
  /* Plain text keeps its line breaks: an employee's reply is often a few
     short lines, and run together they read as one breathless sentence. */
  return (
    <div className="txt plain">
      {splitMentions(body).map((part, i) =>
        part.isTag ? (
          <span
            className="ment"
            key={i}
            style={
              part.agent
                ? { color: AGENT_COLORS[part.agent], background: soft(AGENT_TINTS[part.agent], 0.7), fontWeight: 600 }
                : undefined
            }
          >
            {part.text}
          </span>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </div>
  );
}

/** The receiving employee, face and name, on the colour that follows them —
 *  or, for a mere mention, on white with a dashed edge. */
function Receiver({ agent, zh, quiet = false }: { agent: AgentKey; zh: boolean; quiet?: boolean }) {
  return (
    <span
      className="to"
      style={quiet ? undefined : { background: soft(AGENT_TINTS[agent], 0.55), borderColor: AGENT_TINTS[agent] }}
    >
      <AgentIcon agent={agent} size={16} radius={4} />
      {zh ? AGENT_LABELS[agent].nameLocal : AGENT_LABELS[agent].name}
    </span>
  );
}

function Artifact({ item, zh }: { item: HandoffArtifact; zh: boolean }) {
  // Own keys only: the kind is read out of a jsonb column.
  const known = Object.prototype.hasOwnProperty.call(ARTIFACT, item.kind) ? ARTIFACT[item.kind] : OTHER_ARTIFACT;
  const kind = zh ? known.zh : known.en;
  // "打开…" only on something that opens.
  const label = item.title
    ? `${kind} · ${item.title}`
    : item.href
      ? zh
        ? `打开${kind}`
        : `Open ${kind.toLowerCase()}`
      : kind;
  const inner = (
    <>
      <Icon name={known.icon} size={12} />
      <span>{label}</span>
    </>
  );
  return item.href ? (
    // The script and video pages are heavy; a chip in a list of messages is
    // not a reason to start loading them.
    <Link href={item.href} prefetch={false} className="art" title={label}>
      {inner}
    </Link>
  ) : (
    <span className="art" title={label}>
      {inner}
    </span>
  );
}

/**
 * The "交给 剪辑师" line under a message that hands work on — the one line
 * that makes a channel of agents readable at a glance.
 *
 * Drawn from the hand-off the dispatcher recorded when there is one: who it
 * went to, and a link to each thing handed over. A message without one falls
 * back to the tags in its text, the way every message used to be read; when a
 * person wrote the tag it did reach the employee (sending dispatches it), so
 * it still says 交给. When an employee wrote it, a tag in the text is only a
 * mention — the checked hand-off is the record of work actually passed on —
 * so it is drawn quieter and says 提到.
 */
function Handoff({
  handoff,
  tags,
  byAgent,
  zh,
  project,
}: {
  handoff: ChatHandoff | null | undefined;
  tags: AgentKey[];
  byAgent: boolean;
  zh: boolean;
  /** The project the message's work is in, as its own button. */
  project?: { id: string; title: string } | null;
}) {
  /* One way to the project: the button, not also a chip beside it. */
  const button = project ? <ProjectButton project={project} zh={zh} /> : null;
  if (handoff) {
    const items = project ? handoff.artifacts.filter((a) => !((a.kind === "work_project" || a.kind === "project") && a.id === project.id)) : handoff.artifacts;
    return (
      <div className="handoff">
        {button}
        <span className="lbl2">
          <HandoffArrow />
          {zh ? "交给" : "Over to"}
        </span>
        <Receiver agent={handoff.to} zh={zh} />
        {items.map((a) => (
          <Artifact key={`${a.kind}-${a.id}`} item={a} zh={zh} />
        ))}
      </div>
    );
  }
  if (!tags.length) return button ? <div className="handoff">{button}</div> : null;
  return (
    <div className={byAgent ? "handoff quiet" : "handoff"}>
      {button}
      <span className="lbl2">
        {byAgent ? null : <HandoffArrow />}
        {byAgent ? (zh ? "提到" : "Mentions") : zh ? "交给" : "Over to"}
      </span>
      {tags.map((key) => (
        <Receiver key={key} agent={key} zh={zh} quiet={byAgent} />
      ))}
    </div>
  );
}

/**
 * "打开项目": the project a message's work is in, one press away. Everything
 * lives under a project, and a reply in #研究日报 about a script written
 * for one should not leave anybody hunting for where it went.
 */
function ProjectButton({ project, zh }: { project: { id: string; title: string }; zh: boolean }) {
  const label = zh ? `打开项目《${project.title}》` : `Open the project “${project.title}”`;
  return (
    <Link href={`/projects/${project.id}`} prefetch={false} className="proj" title={label}>
      <Icon name="spark" size={12} />
      <span>{label}</span>
    </Link>
  );
}

/**
 * An employee at work: its face and name like any message of its, and
 * where the text will be, what it is doing right now — "正在看…", "正在写
 * 脚本", "正在粗剪" — with three dots that breathe. Gone the moment its
 * reply lands.
 */
function WorkingRow({ row, zh, locale }: { row: ChannelPending; zh: boolean; locale: string }) {
  const a = AGENT_LABELS[row.agent];
  return (
    <div className="msg" aria-live="polite">
      <div className="face">
        <AgentMark agent={row.agent} />
      </div>
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div className="head">
          <span className="who">{zh ? a.nameLocal : a.name}</span>
          <span className="role" style={{ background: soft(AGENT_TINTS[row.agent], 0.75), color: AGENT_COLORS[row.agent] }}>
            {zh ? a.title : a.titleEn}
          </span>
          <span className="when">{clock(row.since, locale)}</span>
        </div>
        <WorkingPill agent={row.agent} step={row.step} zh={zh} />
        {row.job ? (
          <div>
            <JobChip job={row.job} zh={zh} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The line-icon arrow that leads a hand-off (a mention, 提到, has none). */
function HandoffArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12h13M13 7l5 5-5 5" />
    </svg>
  );
}

/**
 * The buttons under an agent's message.
 *
 * "some buttons and stuff AI can execute itself" — this is the half a person
 * still decides. A `say` button posts a prepared line as whoever pressed it,
 * which is how one press hands work to the next colleague; an `open` button is
 * a plain link to the screen that holds a real gate, because an approval is
 * not something a chat card should be able to grant.
 *
 * Once pressed, the card says who decided and stops offering the decision
 * again — the server refuses a second press either way, and a button that
 * looks live but is not is worse than no button.
 */
function Card({
  actions,
  done,
  zh,
  busy,
  onPress,
}: {
  actions: CardAction[];
  done: CardDone | null | undefined;
  zh: boolean;
  busy: string | null;
  onPress: (id: string) => void;
}) {
  if (!actions.length) return null;
  const chosen = actions.find((a) => a.id === done?.actionId);

  if (done) {
    /* Answered. The buttons that were not pressed are gone, not greyed: a
       disabled button still looks like a thing to try, and people tried. */
    const opens = actions.filter((a) => a.kind === "open");
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 24,
            padding: "0 9px",
            borderRadius: 999,
            background: "#e4faeb",
            color: "#1f7a4d",
            fontSize: 11.5,
            fontWeight: 500,
          }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
          {zh ? `${done.by} 选了「${chosen ? chosen.label : "…"}」` : `${done.by} chose “${chosen ? chosen.labelEn : "…"}”`}
        </span>
        {opens.map((a) => (
          <Link key={a.id} href={a.href ?? "#"} prefetch={false} style={{ fontSize: 12, color: "#525252", textDecoration: "none" }}>
            {zh ? a.label : a.labelEn} →
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
      {actions.map((a) => {
        const primary = a.tone === "primary";
        const style: React.CSSProperties = {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 27,
          padding: "0 11px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "inherit",
          letterSpacing: "inherit",
          cursor: "pointer",
          border: `1px solid ${primary ? "#171717" : "#e2e2e2"}`,
          background: primary ? "#171717" : "#ffffff",
          color: primary ? "#ffffff" : "#383838",
          opacity: 1,
          textDecoration: "none",
        };

        if (a.kind === "open") {
          return (
            // The project and script screens are heavy; a button in a message
            // list is not a reason to start loading them.
            <Link key={a.id} href={a.href ?? "#"} prefetch={false} style={style}>
              {zh ? a.label : a.labelEn}
            </Link>
          );
        }
        return (
          <button
            key={a.id}
            type="button"
            disabled={busy !== null}
            onClick={() => onPress(a.id)}
            style={{ ...style, opacity: style.opacity === 1 && busy === a.id ? 0.55 : style.opacity }}
          >
            {zh ? a.label : a.labelEn}
          </button>
        );
      })}

    </div>
  );
}

/** What a message carries. Re-checked server-side for every reader, so an
 * attachment that is not listed here is one this person may not open. */
function Attachments({ items }: { items: ChannelAttachment[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      {items.map((f) =>
        f.kind === "image" ? (
          <Link key={f.id} href={`/files/${f.id}`} title={f.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${f.id}/thumb`}
              alt={f.name}
              style={{
                maxWidth: 220,
                maxHeight: 160,
                borderRadius: 10,
                border: "1px solid #ededed",
                display: "block",
                objectFit: "cover",
              }}
            />
          </Link>
        ) : (
          <Link key={f.id} href={`/files/${f.id}`} className="chip" style={{ color: "#007be0", borderColor: "#a7d7fd", background: "#f2f9ff" }}>
            <svg viewBox="0 0 24 24">
              <path d="M14 3.5H7.5v17h9v-12z" />
              <path d="M14 3.5v5h2.5" />
            </svg>
            {f.name}
            {f.sizeBytes ? <span style={{ color: "#7c9bb4" }}>{bytes(f.sizeBytes)}</span> : null}
          </Link>
        ),
      )}
    </div>
  );
}

export function ChannelSurface(props: {
  name: string;
  topic: string | null;
  memberCount: number;
  members: ChannelMember[];
  /** Opens the members sheet. */
  onOpenMembers?: () => void;
  messages: ChannelMessage[];
  sending: boolean;
  onSend: (body: string, attachmentIds: string[]) => void;
  locale: string;
  /** Everyone who can be tagged besides the AI employees, who come from the
   * catalog and are always offered. */
  people?: MentionPerson[];
  /** False for somebody without the Files module: no attach button rather
   * than one that 403s. */
  canAttach?: boolean;
  /** False on an announcements channel for anyone but an administrator. */
  canPost?: boolean;
  /** Pressing a button under an agent's message. */
  onPress?: (messageId: string, actionId: string) => void;
  /** The action id currently in flight, so its button reads as busy. */
  pressing?: string | null;
  /** Shown where the composer would be, when there is no composer. */
  readOnlyNote?: string;
  /** A message the server would not take, with what it said. */
  failed?: { body: string; error: string } | null;
  onDismissFailure?: () => void;
  /** The server render's clock, so the day pills hydrate to the same words. */
  now?: string;
  /** The employees at work here right now, drawn after the last message. */
  pending?: ChannelPending[];
  /** A one-to-one conversation: the header is the other person, not a #room. */
  isDirect?: boolean;
  /** The other person's picture, in a direct message. */
  directAvatar?: string | null;
}): React.JSX.Element {
  const zh = props.locale.startsWith("zh");
  /* Falls back to the newest message rather than the clock, so a caller that
     passes no `now` still renders the same thing on both sides. */
  const now = props.now ?? props.messages[props.messages.length - 1]?.createdAt ?? "1970-01-01T00:00:00.000Z";
  const [draft, setDraft] = React.useState("");
  const [attached, setAttached] = React.useState<Attaching[]>([]);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLDivElement>(null);

  /* The newest message is the one you came for. Jump there on open and
     whenever one arrives — unless you have scrolled up to read, in which case
     the view stays where you put it. */
  const lastId = props.messages[props.messages.length - 1]?.id ?? null;
  /* An employee starting work, or moving to its next step, grows the list
     at the bottom too. */
  const working = (props.pending ?? []).map((r) => `${r.id}:${r.step}`).join(",");
  const stuck = React.useRef(true);
  React.useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (stuck.current) el.scrollTop = el.scrollHeight;
  }, [lastId, working]);
  React.useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onScroll = () => {
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const format = (f: Format) => formatTextarea(box.current, f, setDraft);

  /* ---------- tagging ---------- */

  const targets = React.useMemo(() => mentionTargets(props.people ?? [], zh), [props.people, zh]);
  /** The `@…` being typed: where it starts, and what has been typed since.
   * Null whenever the caret is not inside one. */
  const [mention, setMention] = React.useState<{ at: number; query: string } | null>(null);
  const [active, setActive] = React.useState(0);
  const matches = React.useMemo(
    () => (mention ? filterTargets(targets, mention.query) : []),
    [mention, targets],
  );

  /**
   * Is the caret inside a tag?
   *
   * A tag starts at an `@` that begins a word — `isTagStart`, the same rule
   * the message list pills by, so what the picker writes is what gets routed —
   * and runs until whitespace. Recomputed from the value and the caret on
   * every keystroke rather than tracked, which is the only way it survives
   * pasting, deleting and clicking about.
   */
  function readMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) return null;
    if (!isTagStart(value, at)) return null;
    const query = before.slice(at + 1);
    if (/\s/.test(query)) return null;
    return { at, query };
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDraft(value);
    const next = readMention(value, e.target.selectionStart ?? value.length);
    setMention(next);
    setActive(0);
  }

  function pick(target: MentionTarget) {
    const el = box.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? draft.length;
    const next = `${draft.slice(0, mention.at)}@${target.tag} ${draft.slice(caret)}`;
    const to = mention.at + target.tag.length + 2;
    setDraft(next);
    setMention(null);
    // The caret belongs after the tag, not at the end of a message somebody is
    // still in the middle of.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(to, to);
    });
  }

  /* ---------- files ---------- */

  const uploading = attached.some((a) => !a.fileId && !a.error);

  function attach(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 10 - attached.length);
    if (!files.length) return;

    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setAttached((rest) => [...rest, { key, name: file.name, size: file.size, progress: 0 }]);

      void uploadToStudio(file, (fraction) =>
        setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, progress: fraction } : a))),
      )
        .then(({ id }) =>
          setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, fileId: id, progress: 1 } : a))),
        )
        .catch((err: unknown) =>
          setAttached((rest) =>
            rest.map((a) =>
              a.key === key
                ? { ...a, error: err instanceof Error ? err.message : zh ? "上传失败" : "Upload failed" }
                : a,
            ),
          ),
        );
    }
  }

  /* ---------- sending ---------- */

  function send() {
    const body = draft.trim();
    const ids = attached.flatMap((a) => (a.fileId ? [a.fileId] : []));
    // A file still on its way is a message that would arrive without it.
    if (props.sending || uploading) return;
    if (!body && !ids.length) return;
    props.onSend(body, ids);
    setDraft("");
    setAttached([]);
    setMention(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // While the picker is open the arrows and Enter belong to it; Enter
    // sending a half-typed tag was the whole reason pickers get abandoned.
    if (mention && matches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active] ?? matches[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    // Not while an input method is still composing: on a pinyin keyboard
    // Enter commits the letters typed so far, and used to send the message.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const composerLabel = props.isDirect
    ? zh
      ? `发消息给 ${props.name}`
      : `Message ${props.name}`
    : zh
      ? `在 #${props.name} 中发消息`
      : `Message #${props.name}`;
  /* Says what the box can do, not only where it posts: tagging an employee is
     the thing people did not find. */
  const composerPlaceholder = zh
    ? `${composerLabel}，输入 @ 叫上 AI 同事`
    : `${composerLabel} — type @ to bring in an AI teammate`;
  const nothingToSend = !draft.trim() && !attached.some((a) => a.fileId);

  return (
    <div data-chat-surface="" style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div
        style={{
          height: "58px",
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: "11px",
          padding: "0 18px 0 24px",
        }}
      >
        {props.isDirect ? (
          props.directAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.directAvatar} alt="" style={{ width: 32, height: 32, borderRadius: 9, objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "#ececec",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
                color: "#525252",
                flexShrink: 0,
              }}
            >
              {initials(props.name)}
            </div>
          )
        ) : (
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "9px",
              background: "#f4f4f5",
              border: "1px solid #ececec",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              color: "#525252",
              flexShrink: 0,
            }}
          >
            #
          </div>
        )}
        {/* Both lines truncate: a project channel's name is a whole headline,
            and it pushed the member faces and search off the header. */}
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div
            title={props.name}
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "#171717",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {props.name}
          </div>
          {props.topic === null || !props.topic ? null : (
            <div
              title={props.topic}
              style={{
                fontSize: "12px",
                color: "#8a8a8a",
                marginTop: "2px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {props.topic}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={props.onOpenMembers}
          aria-label={zh ? `${props.memberCount} 位成员` : `${props.memberCount} members`}
          title={zh ? `${props.memberCount} 位成员` : `${props.memberCount} members`}
          style={{
            display: "flex",
            alignItems: "center",
            height: "32px",
            padding: "0 5px 0 4px",
            border: "1px solid #ededed",
            borderRadius: "9px",
            gap: "7px",
            background: "#fff",
            cursor: props.onOpenMembers ? "pointer" : "default",
            fontFamily: "inherit",
            letterSpacing: "inherit",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex" }}>
            {/* The employees in a channel now have faces here too: their rows
                carry `/api/agent/avatar/<key>`, the same pixel face as in the
                message list. */}
            {props.members.slice(0, 5).map((member, i) =>
              member.avatar === null ? (
                <div
                  key={member.name + i}
                  title={member.name}
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "7px",
                    border: "2px solid #fff",
                    marginLeft: i === 0 ? "0px" : "-7px",
                    background: "#e5e5e5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "9.5px",
                    fontWeight: 600,
                    color: "#525252",
                    flexShrink: 0,
                    boxSizing: "border-box",
                  }}
                >
                  {initials(member.name)}
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={member.name + i}
                  src={member.avatar}
                  alt=""
                  title={member.name}
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "7px",
                    objectFit: "cover",
                    border: "2px solid #fff",
                    marginLeft: i === 0 ? "0px" : "-7px",
                    boxSizing: "border-box",
                    background: "#fff",
                  }}
                />
              ),
            )}
          </div>
          <span style={{ fontSize: "12px", color: "#525252", paddingRight: "4px", fontVariantNumeric: "tabular-nums" }}>
            {props.memberCount}
          </span>
        </button>
        {/* Search opens the palette over the channel rather than navigating to
            /search and taking the conversation off the screen. */}
        <button
          type="button"
          className="ico2 hdr-btn"
          onClick={() => window.dispatchEvent(new Event(JUMP_EVENT))}
          aria-label={zh ? "搜索" : "Search"}
          title={zh ? "搜索" : "Search"}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.4" />
            <path d="m15.8 15.8 4 4" />
          </svg>
        </button>
        <span
          className="ico2 note"
          role="note"
          tabIndex={0}
          aria-label={props.topic ?? `#${props.name}`}
          title={props.topic ?? `#${props.name}`}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.4" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        </span>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              // The artboard is a fixed frame holding exactly the messages it
              // drew. A real channel outgrows it, and `overflow: hidden` left
              // the older half unreachable.
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              paddingBottom: "10px",
            }}
            ref={list}
          >
            {/* Bottom-aligned by a spacer, not by `justify-content: flex-end`:
                on a column that overflows, flex-end pushes the oldest
                messages out through the top edge, where no scrollbar can
                reach them. That was "I can't scroll up in chat". */}
            <div style={{ flexGrow: 1 }} />
            {props.messages.length === 0 ? (
              <div style={{ padding: "0 24px 18px" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {zh ? `这里还没有消息` : "No messages here yet"}
                </div>
                <p className="mut" style={{ marginTop: 4, lineHeight: 1.6, maxWidth: 460 }}>
                  {zh
                    ? "写下第一条消息，这里的所有人都能看到。输入 @ 可以叫上同事或 AI 同事。"
                    : "Write the first message; everyone here will see it. Type @ to bring in a colleague or an AI teammate."}
                </p>
              </div>
            ) : null}
            {props.messages.map((m, i) => {
              const prev = i === 0 ? null : (props.messages[i - 1] ?? null);
              const newDay = prev === null || !sameDay(prev.createdAt, m.createdAt);
              /* One author's run of messages is one block: same person (or
                 the same employee), same day, a few minutes apart. A card
                 always starts its own block — it is a document, with a
                 byline. */
              const cont =
                prev !== null &&
                !newDay &&
                (m.isAgent === true) === (prev.isAgent === true) &&
                (m.isAgent === true ? (m.agentKey ?? null) === (prev.agentKey ?? null) : true) &&
                prev.authorName === m.authorName &&
                !m.card &&
                !prev.card &&
                minutesBetween(prev.createdAt, m.createdAt) <= GROUP_MINUTES;

              const avatar =
                m.isAgent === true ? (
                  <div className="face">
                    <AgentMark agent={m.agentKey ?? null} />
                  </div>
                ) : m.authorAvatar === null ? (
                  <div
                    className="mav"
                    style={{
                      background: "#ececec",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#525252",
                    }}
                  >
                    {initials(m.authorName)}
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="mav" src={m.authorAvatar} alt="" />
                );

              const tags = parseAgentMentions(m.body);
              const at = clock(m.createdAt, props.locale);
              const agentTint = m.agentKey ? AGENT_TINTS[m.agentKey] : null;
              /* An employee's brief or plan opens with a picture character
                 as its title decoration; the product draws none. */
              const body = m.isAgent === true ? withoutLeadingPictures(m.body) : m.body;

              return (
                <React.Fragment key={m.id}>
                  {newDay ? (
                    <div className="day">
                      <span>{dayLabel(m.createdAt, now, props.locale)}</span>
                    </div>
                  ) : null}
                  {/* A message on screen before the server has it is drawn a
                      shade back, so "sending" and "sent" are not one picture. */}
                  <div className={cont ? "msg cont" : "msg"} style={m.pending ? { opacity: 0.55 } : undefined}>
                    {cont ? (
                      <span className="gut" aria-hidden>
                        {at}
                      </span>
                    ) : null}
                    {avatar}
                    <div style={{ minWidth: 0, flexGrow: 1 }}>
                      {cont ? null : (
                        <div className="head">
                          <span className="who">{m.authorName}</span>
                          {/* The role, not "APP". A colleague and an AI
                              employee used to be told apart by a grey pill
                              that said neither; the employee's own colour,
                              light, says which one without shouting. */}
                          {m.isAgent === true ? (
                            <span
                              className="role"
                              style={{
                                background: agentTint ? soft(agentTint, 0.75) : "#f4f4f5",
                                color: m.agentKey ? AGENT_COLORS[m.agentKey] : "#525252",
                              }}
                            >
                              {m.roleLabel || (zh ? "AI 员工" : "AI STAFF")}
                            </span>
                          ) : null}
                          <span className="when">{at}</span>
                        </div>
                      )}
                      {m.card ? (
                        <div
                          className="doc"
                          style={{
                            background: agentTint ? soft(agentTint, 0.28) : "#fafafa",
                            border: `1px solid ${agentTint ? soft(agentTint, 0.95) : "#ececec"}`,
                          }}
                        >
                          <Body body={body} />
                        </div>
                      ) : (
                        <Body body={body} />
                      )}
                      <Attachments items={m.attachments ?? []} />
                      <Card
                        actions={m.actions ?? []}
                        done={m.done}
                        zh={zh}
                        busy={props.pressing ?? null}
                        onPress={(id) => props.onPress?.(m.id, id)}
                      />
                      <Handoff handoff={m.handoff} tags={tags} byAgent={m.isAgent === true} zh={zh} project={m.project ?? null} />
                      {m.job ? (
                        <div>
                          <JobChip job={m.job} zh={zh} project={m.project ?? null} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            {(props.pending ?? []).map((row) => (
              <WorkingRow key={row.id} row={row} zh={zh} locale={props.locale} />
            ))}
          </div>
          {/* A channel somebody may not post in gets a line saying so rather
              than a composer that refuses on submit. The rule is enforced in
              `postMessage` either way; this is how it reads. */}
          {props.canPost === false ? (
            <div style={{ flexShrink: 0, padding: "6px 24px 18px" }}>
              <div
                style={{
                  border: "1px solid #ededed",
                  borderRadius: 12,
                  background: "#fafafa",
                  padding: "13px 15px",
                  fontSize: 12.5,
                  color: "#737373",
                  lineHeight: 1.6,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Icon name="lock" size={13} color="#a3a3a3" />
                {props.readOnlyNote}
              </div>
            </div>
          ) : (
            <div style={{ flexShrink: 0, padding: "6px 24px 18px", position: "relative" }}>
              {/* A refused message, said out loud. It used to be swallowed, so a
                  send that never happened looked exactly like one that did. */}
              {props.failed ? (
                <div
                  role="alert"
                  style={{
                    marginBottom: 8,
                    border: "1px solid #fdc2c2",
                    background: "#fff7f7",
                    borderRadius: 10,
                    padding: "9px 12px",
                    fontSize: 12.5,
                    color: "#b52a2a",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                  }}
                >
                  <span style={{ flexGrow: 1, minWidth: 0 }}>
                    {zh ? "发送失败：" : "Not sent: "}
                    {props.failed.error}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(props.failed?.body ?? "");
                      props.onDismissFailure?.();
                      box.current?.focus();
                    }}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                      color: "#b52a2a",
                      textDecoration: "underline",
                    }}
                  >
                    {zh ? "取回文字" : "Put it back in the box"}
                  </button>
                </div>
              ) : null}
              <div
                className="composer"
                onDragOver={(e) => {
                  if (props.canAttach === false) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  if (props.canAttach === false) return;
                  e.preventDefault();
                  attach(e.dataTransfer.files);
                }}
              >
                <MentionMenu
                  matches={matches}
                  active={active}
                  zh={zh}
                  onPick={pick}
                  onHover={setActive}
                />

                {/* Pressing B inserts `**`, which a textarea can only show as
                    two asterisks. This is what it will actually look like. */}
                <FormattedPreview text={draft} zh={zh} />
                <textarea
                  ref={box}
                  className="dc-composer"
                  value={draft}
                  onChange={onChange}
                  onKeyDown={onKeyDown}
                  onBlur={() => setMention(null)}
                  onPaste={(e) => {
                    if (props.canAttach === false || !e.clipboardData.files.length) return;
                    e.preventDefault();
                    attach(e.clipboardData.files);
                  }}
                  rows={1}
                  aria-label={composerLabel}
                  placeholder={composerPlaceholder}
                  style={{
                    display: "block",
                    width: "100%",
                    border: "none",
                    outline: "none",
                    resize: "none",
                    background: "transparent",
                    fontFamily: "inherit",
                    fontWeight: "inherit",
                    letterSpacing: "inherit",
                    lineHeight: 1.6,
                    padding: "12px 14px 6px",
                    fontSize: "13.5px",
                    color: "#171717",
                  }}
                />

                {/* What is going up, and how far it has got. */}
                {attached.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 11px 0" }}>
                    {attached.map((a) => (
                      <span
                        key={a.key}
                        className="chip"
                        style={{
                          height: 26,
                          fontSize: 11.5,
                          gap: 7,
                          borderColor: a.error ? "#fdc2c2" : "#ededed",
                          background: a.error ? "#fff7f7" : "#fff",
                          color: a.error ? "#b52a2a" : "#4a5763",
                        }}
                      >
                        <span
                          style={{
                            maxWidth: 180,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {a.name}
                        </span>
                        <span style={{ color: a.error ? "#b52a2a" : "#999999" }}>
                          {a.error
                            ? a.error
                            : a.fileId
                              ? bytes(a.size)
                              : `${Math.round(a.progress * 100)}%`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttached((rest) => rest.filter((x) => x.key !== a.key))}
                          aria-label={zh ? `移除 ${a.name}` : `Remove ${a.name}`}
                          style={{
                            border: 0,
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            font: "inherit",
                            color: "inherit",
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* One row under the text: what to add (a file, a tag), how to
                    format it, and send. The formatting buttons used to sit in
                    a bar of their own above the box, which made an empty
                    composer look like a document editor. */}
                <div className="bar">
                  {/* The artboard drew an attach glyph with nothing behind it.
                      This is the thing behind it. */}
                  {props.canAttach === false ? null : (
                    <>
                      <input
                        ref={picker}
                        type="file"
                        multiple
                        hidden
                        onChange={(e) => {
                          attach(e.target.files);
                          // So the same file picked twice in a row still fires.
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        className="ico2"
                        onClick={() => picker.current?.click()}
                        aria-label={zh ? "添加文件" : "Attach a file"}
                        title={zh ? "添加文件" : "Attach a file"}
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M16.5 8.5 10 15a2.5 2.5 0 0 0 3.5 3.5l6.5-6.5a4.5 4.5 0 0 0-6.4-6.4L7 12.2" />
                        </svg>
                      </button>
                    </>
                  )}
                  {/* Tagging, with the button the artboard implied. */}
                  <button
                    type="button"
                    className="ico2"
                    onClick={() => {
                      const el = box.current;
                      if (!el) return;
                      const caret = el.selectionStart ?? draft.length;
                      const pad = caret > 0 && !/\s/.test(draft[caret - 1] ?? " ") ? " " : "";
                      const next = `${draft.slice(0, caret)}${pad}@${draft.slice(caret)}`;
                      setDraft(next);
                      setMention({ at: caret + pad.length, query: "" });
                      setActive(0);
                      const to = caret + pad.length + 1;
                      requestAnimationFrame(() => {
                        el.focus();
                        el.setSelectionRange(to, to);
                      });
                    }}
                    aria-label={zh ? "@ 同事或 AI 同事" : "Tag a colleague or an AI teammate"}
                    title={zh ? "@ 同事或 AI 同事" : "Tag a colleague or an AI teammate"}
                  >
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="3.6" />
                      <path d="M15.6 8.6v4.6a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7" />
                    </svg>
                  </button>
                  <span className="sep" aria-hidden />
                  <button type="button" className="ico2" onClick={() => format("bold")} aria-label="Bold" title={zh ? "加粗" : "Bold"}>
                    <svg viewBox="0 0 24 24">
                      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("italic")} aria-label="Italic" title={zh ? "斜体" : "Italic"}>
                    <svg viewBox="0 0 24 24">
                      <path d="M10 5h8M6 19h8M14.5 5 9.5 19" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("link")} aria-label="Link" title={zh ? "链接" : "Link"}>
                    <svg viewBox="0 0 24 24">
                      <path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("list")} aria-label="List" title={zh ? "列表" : "List"}>
                    <svg viewBox="0 0 24 24">
                      <path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("code")} aria-label="Code" title={zh ? "代码" : "Code"}>
                    <svg viewBox="0 0 24 24">
                      <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
                    </svg>
                  </button>
                  <span className="hint">{zh ? "回车发送，Shift + 回车换行" : "Enter to send, Shift + Enter for a new line"}</span>
                  <div style={{ flexGrow: 1 }}></div>
                  <button
                    type="button"
                    onClick={send}
                    disabled={props.sending || uploading}
                    aria-label={zh ? "发送" : "Send"}
                    title={zh ? "发送" : "Send"}
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "9px",
                      background: nothingToSend || props.sending || uploading ? "#d4d4d4" : "#171717",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      padding: 0,
                      flexShrink: 0,
                      cursor: props.sending || uploading || nothingToSend ? "default" : "pointer",
                      transition: "background .15s",
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: "15px",
                        height: "15px",
                        stroke: "#fff",
                        fill: "none",
                        strokeWidth: "2.2",
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
