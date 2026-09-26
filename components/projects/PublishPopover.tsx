"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { markPublishedAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import { PUBLISH_PLATFORMS, cleanLink, guessPlatform, publishPlatformName, type PublishPlatform } from "@/lib/projects/publication";
import { PUBLISHED_TONE, PublishedCheck, PublishedMark } from "@/components/projects/Published";

/**
 * 「已发布 · 标记完成」's popover: where it went, the links, a note.
 *
 * Small on purpose — the owner has just uploaded the cut somewhere and wants
 * the project off the in-progress lists; nothing here is required. Pick the
 * platforms (several at once), paste a link beside each if there is one, add
 * a note, confirm. With no platform picked there is one link box, and a
 * pasted link picks its platform from the address (youtu.be → YouTube).
 *
 * Opens under the button that opened it (`align` says which edge to keep),
 * closes on Esc, on a press outside, or on 取消. The server cleans everything
 * again (`markPublished`); the checks here are only there to say what is
 * wrong before the press.
 */
export function PublishPopover({
  projectId,
  zh,
  rendered,
  align = "right",
  onClose,
  onDone,
}: {
  projectId: string;
  zh: boolean;
  /** Whether a finished cut exists; without one the popover says it is being marked done anyway. */
  rendered: boolean;
  align?: "left" | "right";
  onClose: () => void;
  onDone: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [picked, setPicked] = React.useState<PublishPlatform[]>([]);
  const [links, setLinks] = React.useState<Partial<Record<PublishPlatform, string>>>({});
  const [oneLink, setOneLink] = React.useState("");
  const [note, setNote] = React.useState("");
  const [pending, start] = React.useTransition();
  const root = React.useRef<HTMLDivElement | null>(null);
  const first = React.useRef<HTMLButtonElement | null>(null);
  /* The latest `onClose`, so the listeners below are set up once: the page
     re-renders while an employee works (its pulse), and re-running them on
     every render would pull the focus back to the first chip mid-typing. */
  const close = React.useRef(onClose);
  React.useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    /* A press outside closes it — but not a press on a button that opens it
       (`data-pub-opener`): that button toggles, and closing here first made
       its click open the popover straight back up. */
    const away = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.("[data-pub-opener]")) return;
      if (root.current && !root.current.contains(target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    const id = window.setTimeout(() => first.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
      window.clearTimeout(id);
    };
  }, []);

  const toggle = (k: PublishPlatform) => setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  /* A link that is not a web address, by platform ("one" for the lone box). */
  const bad = new Set<string>();
  for (const k of picked) if (cleanLink(links[k] ?? "") === undefined) bad.add(k);
  if (!picked.length && cleanLink(oneLink) === undefined) bad.add("one");

  /* Enter confirms — but not the Enter that ends a Chinese IME composition. */
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) confirm();
  };

  function confirm() {
    if (bad.size || pending) return;
    let platforms: { key: string; url: string }[] = picked.map((k) => ({ key: k, url: links[k] ?? "" }));
    /* One link and no platform picked: the address says where it went. */
    const lone = cleanLink(oneLink);
    if (!picked.length && lone) platforms = [{ key: guessPlatform(lone) ?? "other", url: lone }];
    start(async () => {
      const res = await markPublishedAction(projectId, { platforms, note });
      if (res && "error" in res && res.error) {
        notify(res.error);
        return;
      }
      notify(t("已标记为已发布", "Marked as published"), "ok");
      onDone();
    });
  }

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={t("标记为已发布", "Mark as published")}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        ...(align === "right" ? { right: 0 } : { left: 0 }),
        zIndex: 60,
        width: 400,
        maxWidth: "calc(100vw - 32px)",
        background: "#fff",
        color: "#171717",
        border: "1px solid #e6e6e3",
        borderRadius: 14,
        boxShadow: "0 16px 40px rgba(20,24,40,.14), 0 2px 6px rgba(20,24,40,.06)",
        textAlign: "left",
        fontWeight: 400,
        cursor: "default",
        whiteSpace: "normal",
      }}
      className="pub-pop"
    >
      <style dangerouslySetInnerHTML={{ __html: POPOVER_CSS }} />
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 16px 0" }}>
        <PublishedCheck size={20} />
        <span style={{ fontSize: 14.5, fontWeight: 600, flexGrow: 1 }}>
          <Tr zh="标记为已发布" en="Mark as published" inZh={zh} />
        </span>
        <button type="button" onClick={onClose} aria-label={t("关闭", "Close")} className="pub-x">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
          </svg>
        </button>
      </div>
      <p style={{ margin: "6px 16px 0 45px", fontSize: 12, color: "#7c7c7c", lineHeight: 1.55 }}>
        {rendered
          ? t("记下发到了哪里，项目就算完成，不再出现在进行中。", "Note where it went; the project is done and leaves the in-progress lists.")
          : t("还没有成片也可以标记完成——比如在别处剪好、发好了。", "No cut here yet — it can still be marked done, say if it was made and posted elsewhere.")}
      </p>

      <div style={{ padding: "14px 16px 0" }}>
        <div className="pub-label">
          <Tr zh="发到了哪里" en="Where it went" inZh={zh} />
          <span className="pub-hint">{t("可多选", "pick any")}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PUBLISH_PLATFORMS.map((p, i) => {
            const on = picked.includes(p.key);
            return (
              <button key={p.key} ref={i === 0 ? first : undefined} type="button" aria-pressed={on} onClick={() => toggle(p.key)} className="pub-chip" data-on={on ? "" : undefined}>
                <PublishedMark platform={p.key} size={14} zh={zh} />
                {/* Names the translation would garble (抖音 → "Tik Tok", B站
                    → "Station B") keep the studio's English. */}
                <Tr zh={p.zh} en={p.en} inZh={zh} />
                {on ? <Icon name="check" size={12} strokeWidth={2.6} color={PUBLISHED_TONE.ink} /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "14px 16px 0" }}>
        <div className="pub-label">
          <Tr zh="链接" en="Links" inZh={zh} />
          <span className="pub-hint">{t("可选", "optional")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {picked.length ? (
            picked.map((k) => (
              <label key={k} className="pub-field" data-bad={bad.has(k) ? "" : undefined}>
                <PublishedMark platform={k} size={15} zh={zh} />
                <input
                  value={links[k] ?? ""}
                  onChange={(e) => setLinks((m) => ({ ...m, [k]: e.target.value }))}
                  onKeyDown={enter}
                  placeholder={t(`${publishPlatformName(k, true)} 的链接`, `${publishPlatformName(k, false)} link`)}
                  aria-label={t(`${publishPlatformName(k, true)} 的链接`, `${publishPlatformName(k, false)} link`)}
                  inputMode="url"
                />
              </label>
            ))
          ) : (
            <label className="pub-field" data-bad={bad.has("one") ? "" : undefined}>
              <Icon name="link" size={15} color="#8a8a8a" />
              <input value={oneLink} onChange={(e) => setOneLink(e.target.value)} onKeyDown={enter} placeholder={t("粘贴发布后的链接", "Paste the post's link")} aria-label={t("发布链接", "Post link")} inputMode="url" />
            </label>
          )}
          {bad.size ? <span style={{ fontSize: 11.5, color: "#b42318" }}>{t("链接要以 http:// 或 https:// 开头", "Links start with http:// or https://")}</span> : null}
        </div>
      </div>

      <div style={{ padding: "14px 16px 0" }}>
        <div className="pub-label">
          <Tr zh="备注" en="Note" inZh={zh} />
          <span className="pub-hint">{t("可选", "optional")}</span>
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder={t("例如：用的 9:16 版，标题改过", "e.g. the 9:16 cut, retitled")} className="pub-note" />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "14px 16px 14px", marginTop: 14, borderTop: "1px solid #f1f1ef" }}>
        <button type="button" onClick={onClose} className="pub-btn">
          {t("取消", "Cancel")}
        </button>
        <button type="button" onClick={confirm} disabled={pending || bad.size > 0} className="pub-btn pub-primary">
          <Icon name="check" size={13} strokeWidth={2.4} />
          {pending ? t("保存中…", "Saving…") : <Tr zh="确认已发布" en="Mark published" inZh={zh} />}
        </button>
      </div>
    </div>
  );
}

const POPOVER_CSS = `
@keyframes pubIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.pub-pop { animation: pubIn .14s ease-out; }
@media (prefers-reduced-motion: reduce) { .pub-pop { animation: none; } }
.pub-label { display: flex; align-items: baseline; gap: 6px; font-size: 12px; font-weight: 600; color: #3f3f3f; margin-bottom: 7px; }
.pub-hint { font-size: 11px; font-weight: 400; color: #a3a3a3; }
.pub-chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 8px; border-radius: 999px; border: 1px solid #e2e2e2; background: #fff; color: #333; font-family: inherit; font-size: 12.5px; letter-spacing: inherit; cursor: pointer; transition: border-color .12s ease, background-color .12s ease; }
.pub-chip:hover { border-color: #cfcfcc; }
.pub-chip[data-on] { background: ${PUBLISHED_TONE.bg}; border-color: ${PUBLISHED_TONE.dot}; color: ${PUBLISHED_TONE.ink}; font-weight: 500; }
.pub-chip:focus-visible, .pub-btn:focus-visible, .pub-x:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
.pub-field { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border: 1px solid #e2e2e2; border-radius: 9px; background: #fcfcfc; transition: border-color .12s ease, box-shadow .12s ease; }
.pub-field:focus-within { border-color: #cfcfcf; box-shadow: 0 0 0 3px rgba(23,23,23,.05); background: #fff; }
.pub-field[data-bad] { border-color: #f1b8b0; background: #fff8f7; }
.pub-field input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-family: inherit; font-size: 12.5px; color: #171717; }
.pub-note { width: 100%; box-sizing: border-box; border: 1px solid #e2e2e2; border-radius: 9px; padding: 8px 10px; font-family: inherit; font-size: 12.5px; line-height: 1.5; resize: vertical; outline: none; background: #fcfcfc; }
.pub-note:focus { border-color: #cfcfcf; background: #fff; }
.pub-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 13px; border-radius: 9px; border: 1px solid #e2e2e2; background: #fff; color: #171717; font-family: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.pub-btn:hover:not(:disabled) { border-color: #cfcfcc; }
.pub-primary { background: #171717; border-color: #171717; color: #fff; font-weight: 500; }
.pub-primary:hover:not(:disabled) { background: #2b2b2b; border-color: #2b2b2b; }
.pub-btn:disabled { opacity: .5; cursor: default; }
.pub-x { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: #9a9a9a; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.pub-x:hover { background: rgba(0,0,0,.05); color: #171717; }
`;
