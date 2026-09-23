"use client";

import { useState } from "react";

/**
 * Ask for one name.
 *
 * `window.prompt` is a browser chrome box with the site's origin printed above
 * it, no styling, and no room to say what the name is for. It is also the
 * thing a person sees the moment they try to make their first folder, which is
 * a poor first impression of a product that is otherwise drawn to the pixel.
 */
export function NameDialog({
  title,
  placeholder,
  confirm,
  cancel,
  onSubmit,
  onClose,
}: {
  title: string;
  placeholder: string;
  confirm: string;
  cancel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const name = value.trim();
    if (!name) return;
    onSubmit(name);
    onClose();
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
        paddingTop: "16vh",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") submit();
        }}
        style={{
          width: "min(380px, 92vw)",
          padding: "17px 18px 14px",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%",
            height: 34,
            marginTop: 12,
            padding: "0 11px",
            border: "1px solid #e2e2e2",
            borderRadius: 9,
            outline: "none",
            fontSize: 13.5,
            fontFamily: "inherit",
            letterSpacing: "inherit",
            color: "#171717",
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={onClose} style={ghost}>
            {cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            style={{ ...solid, opacity: value.trim() ? 1 : 0.45 }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

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
