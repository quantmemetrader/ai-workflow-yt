"use client";

import * as React from "react";
import { GI } from "./icons";

/**
 * The Docs chrome pieces: the menu bar (文件 编辑 查看 …, with sub-menus that
 * open on hover the way Docs' do), a toolbar button, a toolbar drop-down, and
 * a small popover. Plain React, no library.
 */

export type MenuItem =
  | { divider: true }
  | {
      label: string;
      icon?: string;
      shortcut?: string;
      onClick?: () => void;
      href?: string;
      download?: boolean;
      disabled?: boolean;
      checked?: boolean;
      submenu?: MenuItem[];
    };

export type Menu = { key: string; label: string; items: MenuItem[] };

function useAway(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, ref, close]);
}

function Items({ items, close }: { items: MenuItem[]; close: () => void }) {
  const [sub, setSub] = React.useState<number | null>(null);
  return (
    <>
      {items.map((it, i) => {
        if ("divider" in it) return <div key={i} className="gd-menu-div" />;
        const body = (
          <>
            <span className="gd-menu-check">{it.checked ? <GI name="check" size={16} /> : it.icon ? <GI name={it.icon} size={17} /> : null}</span>
            <span className="gd-menu-label">{it.label}</span>
            {it.shortcut ? <span className="gd-menu-key">{it.shortcut}</span> : null}
            {it.submenu ? <GI name="chevronRight" size={16} style={{ color: "#5f6368" }} /> : null}
          </>
        );
        return (
          <div key={i} className="gd-menu-row" onMouseEnter={() => setSub(it.submenu ? i : null)}>
            {it.href ? (
              <a className="gd-menu-item" href={it.href} download={it.download} data-off={it.disabled ? "1" : undefined} onClick={() => close()}>
                {body}
              </a>
            ) : (
              <button
                type="button"
                className="gd-menu-item"
                disabled={it.disabled}
                onClick={() => {
                  if (it.submenu) return setSub(sub === i ? null : i);
                  close();
                  it.onClick?.();
                }}
              >
                {body}
              </button>
            )}
            {it.submenu && sub === i ? (
              <div className="gd-menu gd-sub">
                <Items items={it.submenu} close={close} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const close = React.useCallback(() => setOpen(null), []);
  useAway(open !== null, ref, close);
  return (
    <div ref={ref} className="gd-menubar" role="menubar">
      {menus.map((m) => (
        <div key={m.key} style={{ position: "relative" }}>
          <button
            type="button"
            role="menuitem"
            className="gd-menubtn"
            data-on={open === m.key ? "1" : undefined}
            onClick={() => setOpen(open === m.key ? null : m.key)}
            onMouseEnter={() => open && setOpen(m.key)}
          >
            {m.label}
          </button>
          {open === m.key ? (
            <div className="gd-menu" role="menu">
              <Items items={m.items} close={close} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function TB({ icon, label, on, disabled, onClick, children, wide }: { icon?: string; label: string; on?: boolean; disabled?: boolean; onClick?: () => void; children?: React.ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      className="gd-tb"
      data-on={on ? "1" : undefined}
      data-wide={wide ? "1" : undefined}
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon ? <GI name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

/** A toolbar button with a panel under it (style list, colours, alignment …). */
export function Drop({ label, button, children, width, disabled, align = "left" }: { label: string; button: React.ReactNode; children: (close: () => void) => React.ReactNode; width?: number; disabled?: boolean; align?: "left" | "right" }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useAway(open, ref, close);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className="gd-tb" data-wide="1" data-on={open ? "1" : undefined} title={label} aria-label={label} aria-expanded={open} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)}>
        {button}
        <GI name="chevron" size={15} style={{ color: "#5f6368", marginLeft: -2 }} />
      </button>
      {open ? (
        <div className="gd-menu" style={{ minWidth: width ?? 180, [align === "right" ? "right" : "left"]: 0 }} onMouseDown={(e) => e.preventDefault()}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="gd-veil" onMouseDown={onClose}>
      <div className="gd-modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: "#1f1f1f", flexGrow: 1 }}>{title}</div>
          <button type="button" className="gd-icon" onClick={onClose} aria-label="close">
            <GI name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
