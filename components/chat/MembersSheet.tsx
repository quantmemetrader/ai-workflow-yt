"use client";

import { Icon } from "@/components/ui/Icon";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addChannelMembersAction,
  channelMembersAction,
  removeChannelMemberAction,
} from "@/app/(app)/chat/actions";

/**
 * Who is in this channel, and changing it.
 *
 * A private channel is a group: the membership is what makes it private. Until
 * now it could only be created, with one person in it, and never read or
 * changed, so a private channel was a room with a door that opened once.
 *
 * Membership is loaded when the sheet opens rather than rendered with the
 * page: it is a list nobody looks at most of the time, and a channel with
 * forty people in it should not be four hundred bytes on every message poll.
 */
type Member = { id: string; name: string; avatarUrl: string | null; title: string | null };
type Candidate = { id: string; name: string; avatarUrl: string | null };

export function MembersSheet({
  slug,
  channelName,
  isPrivate,
  studioPeople,
  zh,
  onClose,
}: {
  slug: string;
  channelName: string;
  isPrivate: boolean;
  studioPeople: Candidate[];
  zh: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [state, setState] = useState<{
    channelId: string;
    canManage: boolean;
    members: Member[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    void channelMembersAction(slug).then((res) => {
      if (!live) return;
      if ("error" in res) setError(res.error ?? "Channel not found");
      else setState(res);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  const inChannel = new Set(state?.members.map((m) => m.id) ?? []);
  const outside = studioPeople.filter((p) => !inChannel.has(p.id));

  function add(userId: string) {
    if (!state) return;
    start(async () => {
      const res = await addChannelMembersAction(state.channelId, [userId]);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      const fresh = await channelMembersAction(slug);
      if (!("error" in fresh)) setState(fresh);
      router.refresh();
    });
  }

  function remove(userId: string) {
    if (!state) return;
    start(async () => {
      const res = await removeChannelMemberAction(state.channelId, userId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setState((cur) => (cur ? { ...cur, members: cur.members.filter((m) => m.id !== userId) } : cur));
      router.refresh();
    });
  }

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 205,
        background: "rgba(23,23,23,0.18)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "13vh",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "成员" : "Members"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        style={{
          width: "min(420px, 92vw)",
          maxHeight: "68vh",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          overflow: "hidden",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #f3f3f3" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>
            {isPrivate ? <><Icon name="lock" size={12} />{" "}</> : "# "}
            {channelName}
          </div>
          <div style={{ fontSize: 11.5, color: "#999999", marginTop: 3 }}>
            {state
              ? zh
                ? `${state.members.length} 位成员`
                : `${state.members.length} ${state.members.length === 1 ? "member" : "members"}`
              : zh
                ? "加载中…"
                : "loading…"}
            {isPrivate
              ? zh
                ? " · 只有成员能看到这里的消息"
                : " · only members can see anything said here"
              : ""}
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 10px", minHeight: 0 }}>
          {(state?.members ?? []).map((m) => (
            <div key={m.id} style={row}>
              <Avatar id={m.id} name={m.name} url={m.avatarUrl} />
              <span style={{ fontSize: 13 }}>{m.name}</span>
              {m.title && <span style={{ fontSize: 11, color: "#999999" }}>{m.title}</span>}
              {state?.canManage && (
                <button type="button" onClick={() => remove(m.id)} disabled={busy} style={quiet}>
                  {zh ? "移出" : "remove"}
                </button>
              )}
            </div>
          ))}

          {adding && (
            <>
              <div className="lbl" style={{ padding: "12px 8px 4px" }}>
                {zh ? "加入" : "Add"}
              </div>
              {outside.length === 0 ? (
                <p style={{ fontSize: 12, color: "#999999", padding: "2px 8px 8px", margin: 0 }}>
                  {zh ? "工作室里的每个人都已在此频道。" : "Everyone in the studio is already here."}
                </p>
              ) : (
                outside.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => add(p.id)}
                    disabled={busy}
                    style={{ ...row, width: "100%", border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}
                  >
                    <Avatar id={p.id} name={p.name} url={p.avatarUrl} />
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#007be0" }}>
                      {zh ? "加入" : "add"}
                    </span>
                  </button>
                ))
              )}
            </>
          )}
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "#e03636", padding: "0 18px", margin: "6px 0 0" }}>{error}</p>
        )}

        <div
          style={{
            flexShrink: 0,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "11px 18px 13px",
            borderTop: "1px solid #f3f3f3",
          }}
        >
          <button type="button" onClick={onClose} style={ghost}>
            {zh ? "关闭" : "Close"}
          </button>
          <button type="button" onClick={() => setAdding((a) => !a)} style={ghost}>
            {adding ? (zh ? "完成" : "Done") : zh ? "添加成员" : "Add people"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* A member's picture, or the default their id picks; an AI employee in the
   channel carries its pixel face in `avatarUrl`. */
function Avatar({ id, name, url }: { id: string; name: string; url: string | null }) {
  return <PersonAvatar id={id} url={url} name={name} size={24} radius={7} />;
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  height: 40,
  padding: "0 8px",
  borderRadius: 9,
  color: "#171717",
};

const quiet: React.CSSProperties = {
  marginLeft: "auto",
  border: 0,
  background: "transparent",
  color: "#999999",
  fontSize: 11.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
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
