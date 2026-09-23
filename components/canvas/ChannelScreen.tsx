"use client";

import * as React from "react";
import { formatTextarea, type Format } from "./composer-format";
import { FormattedPreview, HAS_MARKUP } from "@/components/ui/FormattedPreview";
import { Markdown } from "@/components/ui/Markdown";
import { JUMP_EVENT } from "@/components/shell/CommandPalette";

/**
 * Transcription of design/canvas/Chat-Channel.dc.html — the main column only
 * (56px channel header, message list, composer). The rail and the sidebar are
 * rendered by their own components. Markup, classes and pixel values are the
 * artboard's; keep this file in step with the artboard when the canvas changes.
 */

export type ChannelMessage = {
  id: string;
  authorName: string;
  authorAvatar: string | null;
  body: string;
  createdAt: string;
  isAgent?: boolean;
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
 * @mentions carry the artboard's .ment pill.
 *
 * A message with formatting in it — the composer's own B, I, link and list
 * buttons write Markdown — is drawn as formatted, not as the asterisks. Plain
 * lines keep the cheaper path with the mention pills.
 */
function renderBody(body: string): React.ReactNode {
  if (HAS_MARKUP.test(body)) return <Markdown text={body} />;
  return body.split(/(@[A-Za-z0-9_\u4e00-\u9fff-]+)/g).map((part, i) =>
    part.startsWith("@") && part.length > 1 ? (
      <span className="ment" key={i}>
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

export function ChannelScreen(props: {
  name: string;
  topic: string | null;
  memberCount: number;
  members: ChannelMember[];
  /** Opens the members sheet. The artboard drew this pill as a label; a list
   * of faces with no way to see or change who is in the room is a label. */
  onOpenMembers?: () => void;
  messages: ChannelMessage[];
  sending: boolean;
  onSend: (body: string) => void;
  locale: string;
  /** False on an announcements channel for anyone but an administrator. */
  canPost?: boolean;
  /** Shown where the composer would be, when there is no composer. */
  readOnlyNote?: string;
  /** A message the server would not take, with what it said. Shown above the
   * composer with the words still in hand. */
  failed?: { body: string; error: string } | null;
  onDismissFailure?: () => void;
}): React.JSX.Element {
  const loc = props.locale === "en" ? "en-GB" : props.locale;
  const time = new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" });
  const zh = props.locale.startsWith("zh");
  const [draft, setDraft] = React.useState("");
  const box = React.useRef<HTMLTextAreaElement>(null);
  const format = (f: Format) => formatTextarea(box.current, f, setDraft);

  function send() {
    const body = draft.trim();
    if (!body || props.sending) return;
    props.onSend(body);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

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
        <span className="ico2" role="note" tabIndex={0} aria-label={props.topic ?? `#${props.name}`} title={props.topic ?? `#${props.name}`}>
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
                    ? "写下第一条消息，它会对这个频道里的所有人可见。"
                    : "Write the first message; everyone in this channel will see it."}
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
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "10px",
                      background: "#171717",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: "18px",
                        height: "18px",
                        stroke: "#fff",
                        fill: "none",
                        strokeWidth: "1.7",
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
                      <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
                    </svg>
                  </div>
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
                        <div style={{ display: "flex", alignItems: "baseline" }}>
                          <span className="who">{m.authorName}</span>
                          {m.isAgent === true ? <span className="app">APP</span> : null}
                          <span className="when">{time.format(new Date(m.createdAt))}</span>
                        </div>
                      )}
                      <div className="txt">{renderBody(m.body)}</div>
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
          <div style={{ flexShrink: 0, padding: "8px 22px 18px" }}>
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
                  {zh ? "没有发送出去：" : "Not sent: "}
                  {props.failed.error}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(props.failed?.body ?? "");
                    props.onDismissFailure?.();
                    box.current?.focus();
                  }}
                  style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", font: "inherit", color: "#b52a2a", textDecoration: "underline" }}
                >
                  {zh ? "取回文字" : "Put it back in the box"}
                </button>
              </div>
            ) : null}
            <div
              style={{
                border: "1px solid #d9d9d9",
                borderRadius: "12px",
                background: "#fff",
                boxShadow: "0 1px 1px rgba(5,5,6,.04)",
              }}
            >
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
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                aria-label={zh ? `在 #${props.name} 中发消息` : `Message #${props.name}`}
                placeholder={zh ? `在 #${props.name} 中发消息` : `Message #${props.name}`}
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
              {/* The artboard drew attach, emoji and mention glyphs here. None
                  of the three has anything behind it, and an icon that looks
                  like a button and is not one is worse than no icon, so only
                  the "who this goes to" label and Send are drawn. */}
              <div style={{ display: "flex", alignItems: "center", gap: "2px", padding: "6px 8px 8px" }}>
                <div className="ico2" style={{ gap: "6px", width: "auto", padding: "0 8px" }}>
                  <div
                    style={{
                      width: "18px",
                      height: "18px",
                      borderRadius: "5px",
                      background: "#171717",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: "9px",
                        height: "9px",
                        stroke: "#fff",
                        fill: "none",
                        strokeWidth: "1.7",
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
                      <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
                    </svg>
                  </div>
                  <span style={{ fontSize: "12px", color: "#525252" }}>
                    {zh ? "询问助理" : "Ask agent"}
                  </span>
                </div>
                <div style={{ flexGrow: 1 }}></div>
                <button
                  type="button"
                  onClick={send}
                  disabled={props.sending}
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
                    cursor: props.sending ? "default" : "pointer",
                    opacity: props.sending ? 0.6 : 1,
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
