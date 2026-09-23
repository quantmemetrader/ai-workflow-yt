"use client";

/**
 * "Are you sure?", without the browser's own box.
 *
 * `window.confirm` blocks the whole page, prints the origin above the
 * question, and looks identical whether it is about deleting a script or
 * about leaving a form. A destructive action deserves to say what it will
 * destroy and what can be undone.
 */
export function ConfirmDialog({
  title,
  body,
  confirm,
  cancel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body?: string;
  confirm: string;
  cancel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 215,
        background: "rgba(23,23,23,0.18)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "17vh",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          // Enter confirms from anywhere in the box except on a button, which
          // already acts on Enter by itself: Enter on Cancel used to cancel
          // *and* confirm, and the thing was deleted after all.
          if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            onConfirm();
            onClose();
          }
        }}
        tabIndex={-1}
        style={{
          width: "min(400px, 92vw)",
          padding: "17px 18px 14px",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        {body && (
          <p style={{ fontSize: 12.5, color: "#7c7c7c", lineHeight: 1.6, margin: "8px 0 0" }}>{body}</p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={onClose} style={ghost}>
            {cancel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{ ...solid, background: danger ? "#e03636" : "#171717" }}
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
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};
