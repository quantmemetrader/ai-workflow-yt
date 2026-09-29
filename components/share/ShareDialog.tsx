"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { PersonAvatar } from "@/components/ui/PersonAvatar";

export type SharePerson = { id: string; name: string; avatarUrl: string | null; title?: string | null };
export type ShareAsk = "review" | "view";

/**
 * 分享: a link to copy, and colleagues to send it to as a DM in the
 * workspace chat — "how about while sharing we don't just add their mail,
 * but select people or just generate a link, and send the DM in the
 * workspace directly with a button to the script".
 *
 * Generic: the script page uses it first; anything with a page of its own
 * (a cut, a project) can pass its own `url` and `onSend`. `allowReview`
 * adds 「审阅并批准」 next to 「仅查看」 for things that get approved.
 */
export function ShareDialog({
  zh,
  title,
  url,
  accessNote,
  linkAccess,
  onLinkAccess,
  people,
  meId,
  allowReview = true,
  defaultAsk = "review",
  onSend,
  onClose,
  onManageAccess,
}: {
  /** Opens the project's access setting (who can open the link at all). */
  onManageAccess?: () => void;
  zh: boolean;
  title: string;
  /** A path inside the app ("/projects/…/script"); drawn absolute. */
  url: string;
  /** Who can open the link, in one line. */
  accessNote?: string;
  /** 有链接的人 (Google-Docs style): nobody extra, view, or edit; `onLinkAccess` for whoever may change it. */
  linkAccess?: "view" | "edit" | null;
  onLinkAccess?: (v: "view" | "edit" | null) => Promise<void> | void;
  people: SharePerson[];
  meId?: string;
  allowReview?: boolean;
  defaultAsk?: ShareAsk;
  onSend: (userIds: string[], ask: ShareAsk, message: string) => Promise<{ ok?: boolean; error?: string } | undefined>;
  onClose: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [ask, setAsk] = React.useState<ShareAsk>(allowReview ? defaultAsk : "view");
  const [message, setMessage] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const full = `${origin}${url}`;
  const list = people.filter((p) => p.id !== meId && (!q.trim() || `${p.name} ${p.title ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      const el = document.createElement("textarea");
      el.value = full;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function send() {
    if (!picked.length || sending) return;
    setSending(true);
    setError(null);
    const r = await onSend(picked, ask, message.trim()).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    setSending(false);
    if (r && "error" in r && r.error) setError(r.error);
    else onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(20,20,20,.32)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px", overflowY: "auto" }}>
      <style>{CSS}</style>
      <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,.18)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 6px" }}>
          <Icon name="share" size={16} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("关闭", "Close")} className="sd-x">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ padding: "8px 18px 14px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#404040", marginBottom: 6 }}>{t("链接", "Link")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={full} onFocus={(e) => e.currentTarget.select()} style={{ flexGrow: 1, minWidth: 0, height: 36, border: "1px solid #dcdbd6", borderRadius: 9, padding: "0 10px", fontSize: 12.5, color: "#525252", background: "#fafaf8", fontFamily: "inherit" }} />
            <button type="button" onClick={copy} className="sd-btn" data-on={copied ? "1" : undefined}>
              <Icon name={copied ? "check" : "link"} size={13} />
              {copied ? t("已复制", "Copied") : t("复制链接", "Copy link")}
            </button>
          </div>
          {onLinkAccess || linkAccess !== undefined ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 12.5, color: "#404040", whiteSpace: "nowrap" }}>{t("有链接的人", "Anyone with the link")}</span>
              {onLinkAccess ? (
                <select
                  value={linkAccess ?? "none"}
                  onChange={(e) => void onLinkAccess(e.target.value === "none" ? null : (e.target.value as "view" | "edit"))}
                  style={{ flexGrow: 1, minWidth: 0, height: 32, border: "1px solid #dcdbd6", borderRadius: 8, padding: "0 8px", fontSize: 13, fontFamily: "inherit", background: "#fff" }}
                >
                  <option value="none">{t("仅限能看到这个项目的人", "Only people who can see the project")}</option>
                  <option value="view">{t("工作室里有链接的人：可查看", "Anyone in the studio with the link: can view")}</option>
                  <option value="edit">{t("工作室里有链接的人：可编辑", "Anyone in the studio with the link: can edit")}</option>
                </select>
              ) : (
                <span style={{ fontSize: 12.5, color: "#6b6b6b" }}>{linkAccess === "edit" ? t("可编辑", "can edit") : linkAccess === "view" ? t("可查看", "can view") : t("仅限能看到项目的人", "only people who can see the project")}</span>
              )}
            </div>
          ) : null}
          {accessNote || onManageAccess ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              {accessNote ? <span style={{ fontSize: 12, color: "#6b6b6b", flexGrow: 1 }}>{accessNote}</span> : <span style={{ flexGrow: 1 }} />}
              {onManageAccess ? (
                <button type="button" onClick={onManageAccess} className="sd-btn" style={{ height: 30, fontSize: 12.5 }}>
                  {t("更改谁能访问", "Change who has access")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ borderTop: "1px solid #efeee9", padding: "14px 18px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#404040" }}>{t("发给同事", "Send to colleagues")}</div>
          <div style={{ fontSize: 11.5, color: "#8a8a8a", margin: "2px 0 8px" }}>{t("他们会在工作区私信里收到，带一个「打开」按钮", "They get a DM in the workspace chat with an Open button")}</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索名字", "Search names")} style={{ width: "100%", height: 34, border: "1px solid #dcdbd6", borderRadius: 9, padding: "0 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
          <div style={{ maxHeight: 210, overflowY: "auto", marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {list.length ? (
              list.map((p) => {
                const on = picked.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)} className="sd-person" data-on={on ? "1" : undefined} aria-pressed={on}>
                    <PersonAvatar id={p.id} url={p.avatarUrl} name={p.name} size={28} />
                    <span style={{ flexGrow: 1, minWidth: 0, textAlign: "left" }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#171717" }}>{p.name}</span>
                      {p.title ? <span style={{ display: "block", fontSize: 11.5, color: "#8a8a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span> : null}
                    </span>
                    <span className="sd-check">{on ? <Icon name="check" size={12} /> : null}</span>
                  </button>
                );
              })
            ) : (
              <div style={{ fontSize: 12.5, color: "#8a8a8a", padding: "10px 4px" }}>{t("没有找到", "Nobody found")}</div>
            )}
          </div>

          {allowReview ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {(["review", "view"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setAsk(k)} className="sd-ask" data-on={ask === k ? "1" : undefined} aria-pressed={ask === k}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{k === "review" ? t("请他们审阅并批准", "Ask them to approve") : t("仅查看", "Just to read")}</span>
                  <span style={{ fontSize: 11.5, color: "#8a8a8a" }}>{k === "review" ? t("他们打开后可以按「批准」或「提修改意见」", "They can approve or ask for changes") : t("可以看、加批注", "They can read and comment")}</span>
                </button>
              ))}
            </div>
          ) : null}

          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={t("附一句话（可选）", "Add a message (optional)")} style={{ width: "100%", marginTop: 10, border: "1px solid #dcdbd6", borderRadius: 9, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          {error ? <div style={{ color: "#c42b2b", fontSize: 12.5, marginTop: 6 }}>{error}</div> : null}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid #efeee9", background: "#fafaf8" }}>
          <button type="button" onClick={onClose} className="sd-btn">{t("取消", "Cancel")}</button>
          <button type="button" onClick={send} disabled={!picked.length || sending} className="sd-btn sd-primary">
            <Icon name="chat" size={13} />
            {sending ? t("发送中…", "Sending…") : picked.length ? t(`发送给 ${picked.length} 人`, `Send to ${picked.length}`) : t("选人后发送", "Pick people")}
          </button>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.sd-x { width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: #6b6b6b; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.sd-x:hover { background: #f3f3f1; color: #171717; }
.sd-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid #d6d5d0; border-radius: 9px; background: #fff; color: #171717; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.sd-btn:hover:not(:disabled) { background: #f7f7f5; }
.sd-btn[data-on] { color: #1e7a4f; border-color: #bfe3cf; background: #eef8f2; }
.sd-primary { background: #171717; border-color: #171717; color: #fff; }
.sd-primary:hover:not(:disabled) { background: #333; }
.sd-primary:disabled { opacity: .45; cursor: default; }
.sd-person { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border: 0; border-radius: 9px; background: transparent; cursor: pointer; font-family: inherit; }
.sd-person:hover { background: #f6f6f4; }
.sd-person[data-on] { background: #eef4fe; }
.sd-check { width: 20px; height: 20px; border-radius: 6px; border: 1px solid #cfcfca; display: inline-flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
.sd-person[data-on] .sd-check { background: #1f6feb; border-color: #1f6feb; }
.sd-ask { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; border: 1px solid #dcdbd6; border-radius: 10px; background: #fff; cursor: pointer; font-family: inherit; text-align: left; color: #171717; }
.sd-ask[data-on] { border-color: #1f6feb; box-shadow: 0 0 0 2px rgba(31,111,235,.15); background: #f7faff; }
`;
