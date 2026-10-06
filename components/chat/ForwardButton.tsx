"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { forwardMessageAction, forwardTargetsAction } from "@/app/(app)/chat/forward-actions";

type Targets = { people: { id: string; name: string; avatarUrl: string | null }[]; groups: { slug: string; name: string; isPrivate: boolean }[] };

/**
 * 转发 on an answer in a chat with the assistant (Catherine, 6 Oct). With part
 * of the answer selected, only that part goes; otherwise the whole answer.
 * Pick a colleague or a group, add a line if you like, and it is posted
 * there as a quote.
 */
export function ForwardButton({ text, zh }: { text: string; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const btn = React.useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [targets, setTargets] = React.useState<Targets | null>(null);
  const [part, setPart] = React.useState("");
  const [note, setNote] = React.useState("");
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const start = async () => {
    const sel = window.getSelection()?.toString().trim() ?? "";
    setPart(sel && text.includes(sel.slice(0, 40)) ? sel : text);
    setNote("");
    setQ("");
    setOpen(true);
    if (!targets) {
      const r = (await forwardTargetsAction()) as Targets & { error?: string };
      if (r.error) {
        notify(r.error);
        setOpen(false);
      } else setTargets(r);
    }
  };

  const send = async (target: { person?: string; group?: string }, name: string) => {
    setBusy(true);
    try {
      const r = (await forwardMessageAction(target, part, note)) as { error?: string; slug?: string };
      if (r.error) return notify(r.error);
      setOpen(false);
      notify(t(`已转发给 ${name}，在「消息」里能看到`, `Forwarded to ${name}; it is in Messages`), "ok");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <>
      <button ref={btn} type="button" className="fw-btn" onClick={() => void start()} title={t("转发给同事或群聊（先选中一段文字就只转发那一段）", "Forward to a colleague or group (select text to forward only that)")}>
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 5l7 7-7 7" />
          <path d="M21 12H9a6 6 0 0 0-6 6v1" />
        </svg>
        {t("转发", "Forward")}
      </button>
      {open
        ? createPortal(
            <div className="fw-veil" onMouseDown={() => !busy && setOpen(false)}>
              <div className="fw-card" role="dialog" aria-modal="true" aria-label={t("转发", "Forward")} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
                <div className="fw-title">{t("转发到…", "Forward to…")}</div>
                <blockquote className="fw-quote">{part.length > 400 ? `${part.slice(0, 400)}…` : part}</blockquote>
                <input className="fw-in" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("加一句话（可不填）", "Add a line (optional)")} />
                <input className="fw-in" value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder={t("搜索同事或群聊", "Search people or groups")} />
                <div className="fw-list">
                  {!targets ? <div className="fw-empty">{t("正在加载…", "Loading…")}</div> : null}
                  {targets?.people.filter((p) => match(p.name)).length ? <div className="fw-sec">{t("同事", "People")}</div> : null}
                  {targets?.people
                    .filter((p) => match(p.name))
                    .map((p) => (
                      <button key={p.id} type="button" className="fw-row" disabled={busy} onClick={() => void send({ person: p.id }, p.name)}>
                        {p.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.avatarUrl} alt="" width={22} height={22} style={{ borderRadius: "50%" }} />
                        ) : (
                          <span className="fw-dot">{p.name.slice(0, 1)}</span>
                        )}
                        {p.name}
                      </button>
                    ))}
                  {targets?.groups.filter((g) => match(g.name)).length ? <div className="fw-sec">{t("群聊", "Groups")}</div> : null}
                  {targets?.groups
                    .filter((g) => match(g.name))
                    .map((g) => (
                      <button key={g.slug} type="button" className="fw-row" disabled={busy} onClick={() => void send({ group: g.slug }, g.name)}>
                        <span className="fw-dot">#</span>
                        {g.name}
                      </button>
                    ))}
                </div>
                <button type="button" className="fw-cancel" disabled={busy} onClick={() => setOpen(false)}>
                  {t("取消", "Cancel")}
                </button>
              </div>
              <style>{CSS}</style>
            </div>,
            document.body,
          )
        : null}
      <style>{BTN_CSS}</style>
    </>
  );
}

const BTN_CSS = `.fw-btn { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 7px; border: 0; border-radius: 6px; background: transparent; color: #8a8a8a; font: inherit; font-size: 11.5px; cursor: pointer; }
.fw-btn:hover { background: #f1f1ef; color: #171717; }`;

const CSS = `
.fw-veil { position: fixed; inset: 0; z-index: 1000; background: rgba(23,23,23,.24); display: flex; align-items: flex-start; justify-content: center; padding: 10vh 16px 16px; }
.fw-card { width: min(440px, 100%); max-height: 78vh; display: flex; flex-direction: column; gap: 10px; background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 24px 64px rgba(23,23,23,.22); }
.fw-title { font-size: 15px; font-weight: 600; }
.fw-quote { margin: 0; padding: 8px 10px; border-left: 3px solid #d4d4d0; background: #fafaf9; color: #525252; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; max-height: 120px; overflow: auto; border-radius: 0 8px 8px 0; }
.fw-in { height: 34px; border: 1px solid #dcdbd6; border-radius: 8px; padding: 0 10px; font: inherit; font-size: 13px; outline: none; }
.fw-in:focus { border-color: #171717; }
.fw-list { overflow-y: auto; min-height: 120px; display: flex; flex-direction: column; }
.fw-sec { font-size: 11.5px; color: #8a8a8a; padding: 8px 4px 4px; }
.fw-row { display: flex; align-items: center; gap: 9px; border: 0; background: none; padding: 7px 6px; border-radius: 8px; font: inherit; font-size: 13px; color: #171717; cursor: pointer; text-align: left; }
.fw-row:hover { background: #f4f4f2; }
.fw-row:disabled { opacity: .5; }
.fw-dot { width: 22px; height: 22px; border-radius: 50%; background: #f1f1ef; color: #525252; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
.fw-empty { font-size: 12.5px; color: #8a8a8a; padding: 10px 4px; }
.fw-cancel { align-self: flex-end; height: 30px; padding: 0 12px; border: 1px solid #e5e5e5; border-radius: 8px; background: #fff; font: inherit; font-size: 12.5px; cursor: pointer; }
`;
