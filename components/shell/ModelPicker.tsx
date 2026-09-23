"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chooseModelAction, modelOptionsAction, type ModelOption } from "@/app/(app)/settings/model-actions";

/**
 * Which model answers, chosen where the questions are asked.
 *
 * This line used to be a caption — the model's name, printed under the
 * composer, unchangeable. Changing it meant editing environment variables on
 * a box and redeploying. It is a business decision with a price per turn, so
 * it belongs to the studio, one click from the box they type into.
 *
 * Everybody sees which model is answering; only an owner or an administrator
 * can change it, because it is one setting for the whole studio. The list is
 * loaded when opened, not on every render of every screen with an assistant
 * on it.
 */
export function ModelPicker({ current, zh }: { current: string; zh: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ModelOption[] | null>(null);
  const [canChoose, setCanChoose] = useState(false);
  const [busy, act] = useTransition();
  const [shown, setShown] = useState(current);
  /* Which way the list opens. It always opened upward, which is right under a
     composer at the foot of the screen and wrong in the agent header at the
     top — there the whole list went off the top edge and could not be read. */
  const [at, setAt] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const box = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const PANEL_HEIGHT = 340;

  function toggle() {
    const next = !open;
    if (next) {
      /*
       * Placed against the window, not against the button's own box.
       *
       * The picker sits in an editor rail that scrolls and clips its
       * children, so an absolutely positioned panel was cut off at the rail's
       * edge — the model names were sliced in half. Fixed coordinates taken
       * from the button's rectangle escape every clipping ancestor, and the
       * direction is chosen by whichever side has room.
       */
      const rect = box.current?.getBoundingClientRect();
      if (rect) {
        const above = rect.top;
        const below = window.innerHeight - rect.bottom;
        const right = Math.max(8, window.innerWidth - rect.right);
        setAt(
          above < PANEL_HEIGHT && below > above
            ? { right, top: rect.bottom + 8 }
            : { right, bottom: window.innerHeight - rect.top + 8 },
        );
      }
    }
    setOpen(next);
    if (next && options === null) {
      act(async () => {
        const res = await modelOptionsAction();
        setOptions(res.options ?? []);
        setCanChoose(Boolean(res.canChoose));
        if (res.answering) setShown(res.answering);
      });
    }
  }

  function choose(id: string) {
    act(async () => {
      const res = await chooseModelAction(id);
      if (res.model) setShown(res.model);
      setOpen(false);
      setOptions(null);
      router.refresh();
    });
  }

  const price = (m: ModelOption) =>
    m.tier === "free" ? (zh ? "免费" : "free") : `$${m.inPerM}/$${m.outPerM} ${zh ? "每百万" : "per M"}`;

  return (
    <span ref={box} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={toggle}
        title={zh ? "选择模型" : "Choose the model"}
        style={{
          border: 0,
          background: "transparent",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          fontSize: 10.5,
          color: "#999999",
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        {shown.replace(/^[^/]+\//, "")}
        <svg
          viewBox="0 0 24 24"
          style={{ width: 9, height: 9, fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round" }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          style={{
            position: "fixed",
            right: at?.right ?? 8,
            ...(at?.top !== undefined ? { top: at.top } : { bottom: at?.bottom ?? 8 }),
            zIndex: 220,
            width: 268,
            maxHeight: PANEL_HEIGHT,
            overflowY: "auto",
            background: "#ffffff",
            border: "1px solid #ededed",
            borderRadius: 11,
            boxShadow: "0 12px 34px rgba(0,0,0,0.14)",
            padding: 6,
          }}
        >
          {options === null ? (
            <p style={{ fontSize: 11.5, color: "#999999", margin: 0, padding: 8 }}>
              {zh ? "加载中…" : "Reading…"}
            </p>
          ) : (
            <>
              {options.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!canChoose || busy}
                  onClick={() => choose(m.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: 0,
                    borderRadius: 8,
                    padding: "7px 9px",
                    background: m.current ? "#f3f3f3" : "transparent",
                    cursor: canChoose && !busy ? "pointer" : "default",
                    font: "inherit",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <b style={{ fontSize: 12, fontWeight: m.current ? 600 : 500, color: "#171717" }}>{m.label}</b>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#999999", flexShrink: 0 }}>
                      {price(m)}
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 10.5, color: "#7c7c7c", lineHeight: 1.45, marginTop: 2 }}>
                    {m.use}
                  </span>
                </button>
              ))}

              <p style={{ fontSize: 10.5, color: "#999999", lineHeight: 1.5, margin: 0, padding: "6px 9px 2px" }}>
                {canChoose
                  ? zh
                    ? "整个工作室共用一个模型。改动几秒内生效。"
                    : "One model for the whole studio. A change reaches every screen within a few seconds."
                  : zh
                    ? "仅所有者或管理员可以更改。"
                    : "Only an owner or an administrator can change this."}
              </p>
            </>
          )}
        </div>
      ) : null}
    </span>
  );
}
