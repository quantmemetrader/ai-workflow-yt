"use client";

import * as React from "react";
import Link from "next/link";
import { formatTextarea, type Format } from "@/components/canvas/composer-format";
import { FormattedPreview, HAS_MARKUP } from "@/components/ui/FormattedPreview";
import { Markdown } from "@/components/ui/Markdown";
import { JUMP_EVENT } from "@/components/shell/CommandPalette";
import {
  AGENT_LABELS,
  isTagStart,
  parseAgentMentions,
  splitMentions,
  type AgentKey,
} from "@/lib/agents/catalog";
import {
  AgentMark,
  MentionMenu,
  filterTargets,
  mentionTargets,
  type MentionPerson,
  type MentionTarget,
} from "./MentionMenu";
import { bytes, uploadToStudio, type Attaching } from "./upload";

/**
 * The channel's main column: header, messages, composer.
 *
 * Grown from `components/canvas/ChannelScreen.tsx` — the artboard transcription
 * — and kept to its markup, classes and pixel values, so the two can be read
 * side by side and folded back together. It exists separately because the
 * three things the studio asked for all land in this one column and none of
 * them are in the artboard:
 *
 *   1. **Roles you can see.** An AI employee's message carries the dark cube
 *      and its job — "AI 员工 · 视频" — not a grey APP pill that could be any
 *      integration. "so i think just make each role clearer in the chat".
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
  /** The agent's job, straight off its user row: "AI 员工 · 视频". */
  roleLabel?: string | null;
  attachments?: ChannelAttachment[];
  /** On screen but not yet acknowledged by the server. Drawn a shade back, so
   * "sent" and "sending" are not the same picture. */
  pending?: boolean;
};

export type ChannelMember = { name: string; avatar: string | null };

/** "Vincent Chow" -> "VC", for the artboard's grey initials tile. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** The artboard's day pill: "Today" / "Yesterday", the date for anything older. */
function dayLabel(iso: string, loc: string): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (days === 0 || days === -1) {
    const rel = new Intl.RelativeTimeFormat(loc, { numeric: "auto" }).format(days, "day");
    return rel.charAt(0).toUpperCase() + rel.slice(1);
  }
  return new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short" }).format(d);
}

/**
 * @mentions carry the artboard's .ment pill — and an agent's tag carries a
 * darker one, because "I asked a colleague" and "I asked the video agent" are
 * different events and used to look identical.
 *
 * A message with formatting in it — the composer's own B, I, link and list
 * buttons write Markdown — is drawn as formatted. The tags in it are still
 * named underneath, by `Tagged`, so a hand-off reads as a hand-off either way.
 */
function renderBody(body: string): React.ReactNode {
  if (HAS_MARKUP.test(body)) return <Markdown text={body} />;
  return splitMentions(body).map((part, i) =>
    part.isTag ? (
      <span
        className="ment"
        key={i}
        style={part.agent ? { color: "#fff", background: "#171717", fontWeight: 600 } : undefined}
      >
        {part.text}
      </span>
    ) : (
      <React.Fragment key={i}>{part.text}</React.Fragment>
    ),
  );
}

/** "→ 视频助理" under a message that hands work on. The one line that makes a
 * channel of agents readable at a glance. */
function Tagged({ keys, zh }: { keys: AgentKey[]; zh: boolean }) {
  if (!keys.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "#999999" }}>{zh ? "交给" : "Over to"}</span>
      {keys.map((key) => (
        <span
          key={key}
          className="chip"
          style={{ height: 22, fontSize: 11, gap: 5, borderColor: "#d9d9d9", color: "#171717" }}
        >
          <AgentMark size={12} radius={4} />
          {zh ? AGENT_LABELS[key].nameLocal : AGENT_LABELS[key].name}
        </span>
      ))}
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
  /** Shown where the composer would be, when there is no composer. */
  readOnlyNote?: string;
  /** A message the server would not take, with what it said. */
  failed?: { body: string; error: string } | null;
  onDismissFailure?: () => void;
}): React.JSX.Element {
  const loc = props.locale === "en" ? "en-GB" : props.locale;
  const time = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" });
  const zh = props.locale.startsWith("zh");
  const [draft, setDraft] = React.useState("");
  const [attached, setAttached] = React.useState<Attaching[]>([]);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);
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

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const composerLabel = zh ? `在 #${props.name} 中发消息` : `Message #${props.name}`;

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {/* the artboard's placeholder colour; ::placeholder cannot be set inline */}
      <style>{".dc-composer::placeholder { color: #999999; }"}</style>

      <div
        style={{
          height: "56px",
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: "11px",
          padding: "0 18px 0 22px",
        }}
      >
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "9px",
            background: "#f3f3f3",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "17px",
            color: "#525252",
          }}
        >
          #
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 600, display: "flex", alignItems: "center", gap: "7px" }}>
            {props.name}
          </div>
          {props.topic === null ? null : (
            <div
              style={{
                fontSize: "11.5px",
                color: "#999999",
                marginTop: "1px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {props.topic}
            </div>
          )}
        </div>
        <div style={{ flexGrow: 1 }}></div>
        <button
          type="button"
          onClick={props.onOpenMembers}
          aria-label={zh ? `${props.memberCount} 位成员` : `${props.memberCount} members`}
          style={{
            display: "flex",
            alignItems: "center",
            height: "30px",
            padding: "0 4px 0 3px",
            border: "1px solid #ededed",
            borderRadius: "9px",
            gap: "7px",
            background: "#fff",
            cursor: props.onOpenMembers ? "pointer" : "default",
            fontFamily: "inherit",
            letterSpacing: "inherit",
          }}
        >
          <div style={{ display: "flex" }}>
            {props.members.slice(0, 4).map((member, i) =>
              member.avatar === null ? (
                <div
                  key={member.name + i}
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "6px",
                    border: "2px solid #fff",
                    marginLeft: i === 0 ? "0px" : "-7px",
                    background: "#e2e2e2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "7px",
                    fontWeight: 600,
                    color: "#525252",
                    flexShrink: 0,
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
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "6px",
                    objectFit: "cover",
                    border: "2px solid #fff",
                    marginLeft: i === 0 ? "0px" : "-7px",
                  }}
                />
              ),
            )}
          </div>
          <span
            style={{ fontSize: "12px", color: "#525252", paddingRight: "5px" }}
            title={zh ? `${props.memberCount} 位成员` : `${props.memberCount} members`}
          >
            {props.memberCount}
          </span>
        </button>
        {/* Search opens the palette over the channel rather than navigating to
            /search and taking the conversation off the screen. */}
        <button
          type="button"
          className="ico2"
          onClick={() => window.dispatchEvent(new Event(JUMP_EVENT))}
          aria-label={zh ? "搜索" : "Search"}
          style={{ background: "transparent", border: 0, cursor: "pointer", padding: 0 }}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.4" />
            <path d="m15.8 15.8 4 4" />
          </svg>
        </button>
        <span
          className="ico2"
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
              justifyContent: "flex-end",
              paddingBottom: "4px",
            }}
          >
            {props.messages.length === 0 ? (
              <div style={{ padding: "0 22px 18px" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {zh ? `这里还没有消息` : "No messages here yet"}
                </div>
                <p className="mut" style={{ marginTop: 4, lineHeight: 1.55, maxWidth: 460 }}>
                  {zh
                    ? "写下第一条消息，这个频道里的所有人都能看到。输入 @ 可以叫上同事或 AI 助理。"
                    : "Write the first message; everyone in this channel will see it. Type @ to bring in a colleague or an AI employee."}
                </p>
              </div>
            ) : null}
            {props.messages.map((m, i) => {
              const prev = i === 0 ? null : (props.messages[i - 1] ?? null);
              const newDay = prev === null || !sameDay(prev.createdAt, m.createdAt);
              const cont =
                prev !== null &&
                !newDay &&
                m.isAgent !== true &&
                prev.isAgent !== true &&
                prev.authorName === m.authorName;

              const avatar =
                m.isAgent === true ? (
                  <AgentMark />
                ) : m.authorAvatar === null ? (
                  <div
                    className="mav"
                    style={{
                      background: "#e2e2e2",
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

              return (
                <React.Fragment key={m.id}>
                  {newDay ? (
                    <div className="day">
                      <span>{dayLabel(m.createdAt, loc)}</span>
                    </div>
                  ) : null}
                  {/* A message on screen before the server has it is drawn a
                      shade back, so "sending" and "sent" are not one picture. */}
                  <div className={cont ? "msg cont" : "msg"} style={m.pending ? { opacity: 0.55 } : undefined}>
                    {avatar}
                    <div style={{ minWidth: 0, flexGrow: 1 }}>
                      {cont ? null : (
                        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap" }}>
                          <span className="who">{m.authorName}</span>
                          {/* The role, not "APP". A colleague and an AI
                              employee used to be told apart by a grey pill
                              that said neither. */}
                          {m.isAgent === true ? (
                            <span
                              className="app"
                              style={{ background: "#171717", color: "#fff", letterSpacing: 0 }}
                            >
                              {m.roleLabel || (zh ? "AI 员工" : "AI STAFF")}
                            </span>
                          ) : null}
                          <span className="when">{time.format(new Date(m.createdAt))}</span>
                        </div>
                      )}
                      <div className="txt">{renderBody(m.body)}</div>
                      <Attachments items={m.attachments ?? []} />
                      <Tagged keys={tags} zh={zh} />
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          {/* A channel somebody may not post in gets a line saying so rather
              than a composer that refuses on submit. The rule is enforced in
              `postMessage` either way; this is how it reads. */}
          {props.canPost === false ? (
            <div style={{ flexShrink: 0, padding: "8px 22px 18px" }}>
              <div
                style={{
                  border: "1px solid #ededed",
                  borderRadius: 12,
                  background: "#fafafa",
                  padding: "13px 15px",
                  fontSize: 12,
                  color: "#7c7c7c",
                  lineHeight: 1.6,
                }}
              >
                {props.readOnlyNote}
              </div>
            </div>
          ) : (
            <div style={{ flexShrink: 0, padding: "8px 22px 18px", position: "relative" }}>
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
                    fontSize: 12,
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
                style={{
                  position: "relative",
                  border: "1px solid #d9d9d9",
                  borderRadius: "12px",
                  background: "#fff",
                  boxShadow: "0 1px 1px rgba(5,5,6,.04)",
                }}
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

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "2px",
                    padding: "6px 8px",
                    borderBottom: "1px solid #f3f3f3",
                  }}
                >
                  <button type="button" className="ico2" onClick={() => format("bold")} aria-label="Bold">
                    <svg viewBox="0 0 24 24">
                      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("italic")} aria-label="Italic">
                    <svg viewBox="0 0 24 24">
                      <path d="M10 5h8M6 19h8M14.5 5 9.5 19" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("link")} aria-label="Link">
                    <svg viewBox="0 0 24 24">
                      <path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("list")} aria-label="List">
                    <svg viewBox="0 0 24 24">
                      <path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
                    </svg>
                  </button>
                  <button type="button" className="ico2" onClick={() => format("code")} aria-label="Code">
                    <svg viewBox="0 0 24 24">
                      <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
                    </svg>
                  </button>
                </div>
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
                  placeholder={composerLabel}
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
                    lineHeight: 1.55,
                    padding: "11px 13px 4px",
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

                <div style={{ display: "flex", alignItems: "center", gap: "2px", padding: "6px 8px 8px" }}>
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
                        style={{ background: "transparent", border: 0, cursor: "pointer", padding: 0 }}
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
                    aria-label={zh ? "@ 某人或某个助理" : "Tag a person or an agent"}
                    title={zh ? "@ 同事或 AI 助理" : "Tag a colleague or an AI employee"}
                    style={{
                      background: "transparent",
                      border: 0,
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 15,
                      color: "#525252",
                      fontFamily: "inherit",
                    }}
                  >
                    @
                  </button>
                  <span style={{ fontSize: "12px", color: "#999999", paddingLeft: 4 }}>
                    {zh ? "@ 可以叫上 AI 助理" : "@ brings in an AI employee"}
                  </span>
                  <div style={{ flexGrow: 1 }}></div>
                  <button
                    type="button"
                    onClick={send}
                    disabled={props.sending || uploading}
                    aria-label={zh ? "发送" : "Send"}
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "9px",
                      background: "#007be0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      padding: 0,
                      cursor: props.sending || uploading ? "default" : "pointer",
                      opacity: props.sending || uploading ? 0.6 : 1,
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
