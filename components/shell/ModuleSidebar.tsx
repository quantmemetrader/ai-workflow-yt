"use client";

import { useResizable } from "@/components/ui/Resizer";

/**
 * The module's own column of screens.
 *
 * Every desktop artboard in the design draws this — Accounting, Admin,
 * Finance, HR, Legal, Publish and Research all have the same 212px column with
 * the module's name at the top and a "Screens" list under it. Only Research
 * was built that way; the other six grew a strip of tabs across the top
 * instead, which is a different product wearing the same palette.
 *
 * This is that column, for the modules whose screens are *tabs of one page*
 * rather than separate routes. Research keeps its own because its screens are
 * real routes with their own data, and it carries the connected-sources
 * summary that nothing else has.
 *
 * The width is draggable and remembered per module, for the same reason every
 * other column here is: a person working in a table wants it narrow and a
 * person reading labels wants it wide, and neither should have to keep asking.
 */
export type ScreenItem<T extends string> = {
  key: T;
  label: string;
  labelZh: string;
  /** A quiet count. Zero and undefined both draw nothing. */
  badge?: number;
  /** A count that means somebody is waiting: drawn as a red pill. */
  alert?: number;
};

export function ModuleSidebar<T extends string>({
  title,
  titleZh,
  screens,
  active,
  onChange,
  zh,
  storageKey,
  footer,
}: {
  title: string;
  titleZh: string;
  screens: ScreenItem<T>[];
  active: T;
  onChange: (key: T) => void;
  zh: boolean;
  /** Where this module's remembered width lives. */
  storageKey: string;
  /** The bottom of the column: the artboards put a usage line here. */
  footer?: React.ReactNode;
}) {
  const { width, handle } = useResizable(storageKey, { min: 170, max: 380, initial: 212, edge: "right" });

  return (
    <div
      data-module-sidebar=""
      style={{
        width,
        flexShrink: 0,
        position: "relative",
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        padding: "10px 8px",
        minHeight: 0,
      }}
    >
      {handle}

      <div style={{ padding: "4px 9px 12px", fontSize: 14, fontWeight: 500 }}>{zh ? titleZh : title}</div>

      <div
        style={{
          fontSize: 10.5,
          fontWeight: 500,
          color: "#999999",
          padding: "0 9px",
          marginBottom: 5,
        }}
      >
        {zh ? "页面" : "Screens"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1, overflowY: "auto", minHeight: 0 }}>
        {screens.map((s) => {
          const on = s.key === active;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key)}
              aria-current={on ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 29,
                padding: "0 9px",
                borderRadius: 7,
                border: 0,
                cursor: "pointer",
                textAlign: "left",
                background: on ? "#ffffff" : "transparent",
                boxShadow: on ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                color: on ? "#171717" : "#525252",
                fontWeight: on ? 500 : 400,
                fontSize: 12.5,
                fontFamily: "inherit",
                letterSpacing: "inherit",
              }}
            >
              <span
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {zh ? s.labelZh : s.label}
              </span>

              {s.alert ? (
                <i
                  style={{
                    fontStyle: "normal",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#ffffff",
                    background: "#e03636",
                    borderRadius: 9,
                    padding: "1px 6px",
                  }}
                >
                  {s.alert}
                </i>
              ) : s.badge ? (
                <b style={{ fontSize: 10.5, fontWeight: 500, color: "#999999" }}>{s.badge}</b>
              ) : null}
            </button>
          );
        })}
      </div>

      {footer ? <div style={{ marginTop: "auto", paddingTop: 14 }}>{footer}</div> : null}
    </div>
  );
}

