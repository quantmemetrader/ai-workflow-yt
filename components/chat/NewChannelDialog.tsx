"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChannelAction } from "@/app/(app)/chat/actions";

/**
 * Starting a channel, or a private group.
 *
 * This was `globalThis.prompt("Name the channel")`, which gave a name and
 * nothing else: no purpose, no way to make it private, and nobody in it. A
 * private channel with one person in it and no way to add a second is not a
 * group, so the studio had channels and no groups at all.
 *
 * "Group" is not a separate kind of room here. It is a channel whose
 * membership is the thing that makes it private, which is what the toggle and
 * the list below actually set.
 */
export type Candidate = { id: string; name: string; avatarUrl: string | null; title: string | null };

export function NewChannelDialog({
  people,
  zh,
  onClose,
}: {
  people: Candidate[];
  zh: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const needle = filter.trim().toLowerCase();
  const shown = needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;

  function submit() {
    if (!name.trim() || busy) return;
    setError(null);
    start(async () => {
      const res = await createChannelAction(name, {
        topic,
        isPrivate,
        memberIds: picked,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
      if (res.slug) router.push(`/chat/c/${res.slug}`);
      router.refresh();
    });
  }

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        background: "rgba(23,23,23,0.18)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "新建频道" : "New channel"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        style={{
          width: "min(460px, 92vw)",
          maxHeight: "72vh",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          overflow: "hidden",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ padding: "17px 18px 0" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {isPrivate ? (zh ? "新建私密群组" : "New private group") : zh ? "新建频道" : "New channel"}
          </div>

          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={zh ? "名称，例如 制作组" : "Name it, for example production"}
            style={field}
          />
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={zh ? "用途（可留空）" : "What it is for (optional)"}
            style={{ ...field, marginTop: 8 }}
          />

          <label
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              margin: "14px 0 0",
              cursor: "pointer",
            }}
          >
            <Check on={isPrivate} onToggle={() => setPrivate((p) => !p)} />
            <span>
              <span style={{ fontSize: 12.5, fontWeight: 500, display: "block" }}>
                {zh ? "私密" : "Private"}
              </span>
              <span style={{ fontSize: 11.5, color: "#999999", display: "block", marginTop: 2, lineHeight: 1.55 }}>
                {zh
                  ? "只有被加入的成员才能看到该群组及其中的消息。"
                  : "Only the people added to it can see it, or anything said in it."}
              </span>
            </span>
          </label>
        </div>

        <div className="lbl" style={{ padding: "16px 18px 6px", margin: 0 }}>
          {zh ? `加入的人 · ${picked.length}` : `People to add · ${picked.length}`}
        </div>

        {people.length > 6 && (
          <div style={{ padding: "0 18px 8px" }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={zh ? "按名字筛选" : "Filter by name"}
              style={{ ...field, marginTop: 0, height: 30, fontSize: 12.5 }}
            />
          </div>
        )}

        <div style={{ overflowY: "auto", padding: "0 10px 6px", minHeight: 0 }}>
          {people.length === 0 ? (
            <p style={{ fontSize: 12, color: "#999999", padding: "4px 8px 10px", margin: 0, lineHeight: 1.6 }}>
              {zh
                ? "工作室里还没有其他人。先邀请同事，再把他们加进来。"
                : "Nobody else is in the studio yet. Invite a colleague first and they can be added here."}
            </p>
          ) : (
            shown.map((p) => {
              const on = picked.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPicked((cur) => (on ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    height: 40,
                    padding: "0 8px",
                    border: 0,
                    borderRadius: 9,
                    background: on ? "#f3f3f3" : "transparent",
                    cursor: "pointer",
                    font: "inherit",
                    color: "#171717",
                    textAlign: "left",
                  }}
                >
                  <Check on={on} />
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: 7, objectFit: "cover" }} />
                  ) : (
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 7,
                        background: "#e2e2e2",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        fontWeight: 600,
                        color: "#525252",
                      }}
                    >
                      {initials(p.name)}
                    </span>
                  )}
                  <span style={{ fontSize: 13 }}>{p.name}</span>
                  {p.title && (
                    <span style={{ fontSize: 11, color: "#999999", marginLeft: "auto" }}>{p.title}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "#e03636", padding: "0 18px", margin: "4px 0 0" }}>{error}</p>
        )}

        <div
          style={{
            flexShrink: 0,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "12px 18px 14px",
            borderTop: "1px solid #f3f3f3",
          }}
        >
          <button type="button" onClick={onClose} style={ghost}>
            {zh ? "取消" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || busy}
            style={{ ...solid, opacity: !name.trim() || busy ? 0.45 : 1 }}
          >
            {busy ? (zh ? "创建中…" : "Creating…") : zh ? "创建" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* 16px box, #999999 border, #171717 when checked: the studio's own checkbox. */
function Check({ on, onToggle }: { on: boolean; onToggle?: () => void }) {
  return (
    <span
      role={onToggle ? "checkbox" : undefined}
      aria-checked={onToggle ? on : undefined}
      tabIndex={onToggle ? 0 : undefined}
      onClick={onToggle}
      onKeyDown={
        onToggle
          ? (e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 4,
        border: on ? "1px solid #171717" : "1px solid #999999",
        background: on ? "#171717" : "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: onToggle ? 1 : 0,
        cursor: onToggle ? "pointer" : "inherit",
      }}
    >
      {on && (
        <svg viewBox="0 0 16 16" style={{ width: 11, height: 11, stroke: "#ffffff", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <path d="M3.6 8.3 6.5 11.2 12.4 5.1" />
        </svg>
      )}
    </span>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

const field: React.CSSProperties = {
  width: "100%",
  height: 34,
  marginTop: 12,
  padding: "0 11px",
  border: "1px solid #e2e2e2",
  borderRadius: 9,
  outline: "none",
  background: "#fff",
  fontSize: 13.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  color: "#171717",
};

const ghost: React.CSSProperties = {
  height: 32,
  padding: "0 13px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

const solid: React.CSSProperties = {
  height: 32,
  padding: "0 15px",
  borderRadius: 8,
  border: 0,
  background: "#171717",
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};
