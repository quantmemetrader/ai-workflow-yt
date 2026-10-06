"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { archiveConversationAction, renameConversationAction } from "@/app/(app)/chat/actions";

/**
 * A small 「⋯」 menu for a row or a header (QA, 2 Oct: AI chats could not be
 * renamed or deleted, channels not left or archived, messages not edited or
 * taken back). An item that destroys something asks once more in place
 * (`confirm`): the first press arms it, the second does it.
 */
/**
 * Where a popup opened from `anchor` goes: fixed on the page, below the
 * button, its right edge on the button's, and kept inside the window. (Catherine,
 * 6 Oct: the rename box opened leftward inside the narrow chat list and slid
 * under the main menu; a popup drawn in place is also cut off by any list
 * that scrolls.) Drawn into <body>, so no column can cover or clip it.
 */
function useFloat(anchor: React.RefObject<HTMLElement | null>, open: boolean, width: number) {
  const [pos, setPos] = React.useState<React.CSSProperties | null>(null);
  React.useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      const below = r.bottom + 4;
      const top = below + 180 > window.innerHeight ? Math.max(8, r.top - 4 - 180) : below;
      setPos({ position: "fixed", top, left, right: "auto", zIndex: 1000 });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, open, width]);
  return pos;
}

export type RowMenuItem = { key: string; label: string; danger?: boolean; confirm?: string; onSelect: () => void };

export function RowMenu({
  items,
  label,
  size = 26,
  className,
  style,
}: {
  items: RowMenuItem[];
  /** What a screen reader hears for the button. */
  label: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = React.useState(false);
  const [armed, setArmed] = React.useState<string | null>(null);
  const box = React.useRef<HTMLSpanElement | null>(null);
  const pop = React.useRef<HTMLDivElement | null>(null);
  const at = useFloat(box, open, 148);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <span ref={box} className={className} style={{ position: "relative", display: "inline-flex", flexShrink: 0, ...style }}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setArmed(null);
          setOpen((v) => !v);
        }}
        className="rm-btn"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="currentColor">
          <circle cx="6" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="18" cy="12" r="1.6" />
        </svg>
      </button>
      {open && at ? createPortal(
        <div ref={pop} role="menu" className="rm-pop" style={{ ...at, minWidth: 148 }} onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className="rm-item"
              data-danger={it.danger || undefined}
              data-armed={armed === it.key || undefined}
              onClick={(e) => {
                e.preventDefault();
                if (it.confirm && armed !== it.key) return setArmed(it.key);
                setOpen(false);
                setArmed(null);
                it.onSelect();
              }}
            >
              {armed === it.key && it.confirm ? it.confirm : it.label}
            </button>
          ))}
          <style>{RM_CSS}</style>
        </div>,
        document.body,
      ) : null}
      <style>{RM_CSS}</style>
    </span>
  );
}

const RM_CSS = `
.rm-btn { display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 7px; background: transparent; color: #8a8a8a; cursor: pointer; padding: 0; }
.rm-btn:hover, .rm-btn[aria-expanded="true"] { background: #efefed; color: #171717; }
.rm-pop { position: absolute; top: calc(100% + 4px); right: 0; z-index: 60; min-width: 132px; padding: 4px; background: #fff; border: 1px solid #e6e5e0; border-radius: 10px; box-shadow: 0 12px 32px -6px rgba(17,17,17,.18); display: flex; flex-direction: column; }
.rm-item { display: block; width: 100%; text-align: left; border: 0; background: transparent; border-radius: 7px; padding: 7px 10px; font: inherit; font-size: 12.5px; color: #262626; cursor: pointer; white-space: nowrap; }
.rm-item:hover { background: #f4f4f2; }
.rm-item[data-danger] { color: #b42318; }
.rm-item[data-armed] { background: #fdecea; color: #b42318; font-weight: 600; }
`;

/**
 * 重命名 / 删除 for one of a person's own AI chats. Deleting archives it
 * (`archiveConversationAction`): it leaves every list; the open thread, if
 * it was this one, gives way to the newest remaining.
 */
export function ConversationMenu({
  id,
  title,
  zh,
  current = false,
  size = 26,
  className,
  style,
}: {
  id: string;
  title: string;
  zh: boolean;
  /** This chat is the one on screen. */
  current?: boolean;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(title);
  const [busy, setBusy] = React.useState(false);
  const anchor = React.useRef<HTMLSpanElement | null>(null);
  const at = useFloat(anchor, renaming, 260);
  const save = async () => {
    const next = name.trim();
    if (!next || busy) return;
    if (next === title) return setRenaming(false);
    setBusy(true);
    const r = await renameConversationAction(id, next).catch(() => ({ error: t("没改成，再试一次", "Not renamed; try again") }));
    setBusy(false);
    if (r?.error) return notify(r.error);
    setRenaming(false);
    router.refresh();
  };
  const remove = async () => {
    const r = await archiveConversationAction(id).catch(() => ({ error: t("没删掉，再试一次", "Not deleted; try again") }));
    if (r?.error) return notify(r.error);
    notify(t("对话已删除", "Chat deleted"), "ok");
    if (current) router.push("/chat");
    router.refresh();
  };
  return (
    <span ref={anchor} style={{ position: "relative", display: "inline-flex", flexShrink: 0, ...style }} className={className}>
      <RowMenu
        size={size}
        label={t("对话操作", "Chat actions")}
        items={[
          { key: "rename", label: t("重命名", "Rename"), onSelect: () => (setName(title), setRenaming(true)) },
          { key: "delete", label: t("删除", "Delete"), danger: true, confirm: t("确认删除", "Really delete"), onSelect: () => void remove() },
        ]}
      />
      {renaming && at ? createPortal(
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ ...at, width: 260, padding: 10, background: "#fff", border: "1px solid #e6e5e0", borderRadius: 10, boxShadow: "0 12px 32px -6px rgba(17,17,17,.18)", display: "flex", flexDirection: "column", gap: 8 }}
        >
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
            aria-label={t("对话名称", "Chat name")}
            style={{ height: 30, border: "1px solid #dcdbd6", borderRadius: 8, padding: "0 9px", fontFamily: "inherit", fontSize: 12.5, outline: "none" }}
          />
          <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setRenaming(false)} style={{ height: 28, padding: "0 10px", border: "1px solid #e5e5e5", borderRadius: 7, background: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>
              {t("取消", "Cancel")}
            </button>
            <button type="submit" disabled={busy || !name.trim()} style={{ height: 28, padding: "0 12px", border: 0, borderRadius: 7, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer", opacity: busy || !name.trim() ? 0.5 : 1 }}>
              {busy ? t("保存中…", "Saving…") : t("保存", "Save")}
            </button>
          </span>
        </form>,
        document.body,
      ) : null}
    </span>
  );
}
