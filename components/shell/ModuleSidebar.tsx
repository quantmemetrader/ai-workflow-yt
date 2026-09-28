"use client";

/**
 * A module's screens, as a row of tabs under its header.
 *
 * It was a 212px column down the left (the design's artboards drew one for
 * Accounting, Admin, Finance, HR, Legal and Publish). Beside the app's own
 * rail and the AI panel on the right, that made four columns on one screen;
 * the owner (28 Sep): "make it for non-technical people … less info per
 * page". The same screens as tabs across the top give the page its width
 * back and read like every other page with tabs in the product.
 *
 * The name is kept so the screens that import it did not all change;
 * `storageKey` and `footer` are accepted and ignored (there is no width to
 * remember, and the footer was a spend figure).
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
  screens,
  active,
  onChange,
  zh,
}: {
  title: string;
  titleZh: string;
  screens: ScreenItem<T>[];
  active: T;
  onChange: (key: T) => void;
  zh: boolean;
  storageKey: string;
  footer?: React.ReactNode;
}) {
  if (screens.length < 2) return null;
  return (
    <nav
      data-module-tabs=""
      aria-label={zh ? "页面" : "Screens"}
      style={{ flexShrink: 0, display: "flex", gap: 4, padding: "0 18px", borderBottom: "1px solid #ededed", overflowX: "auto", background: "#fff" }}
    >
      <style>{`[data-module-tabs] button{transition:color .15s ease,border-color .15s ease}[data-module-tabs] button:hover{color:#171717}`}</style>
      {screens.map((s) => {
        const on = s.key === active;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(s.key)}
            aria-current={on ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 44,
              padding: "0 12px",
              border: 0,
              borderBottom: `2px solid ${on ? "#171717" : "transparent"}`,
              background: "transparent",
              cursor: "pointer",
              color: on ? "#171717" : "#6b6b6b",
              fontWeight: on ? 600 : 400,
              fontSize: 14,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {zh ? s.labelZh : s.label}
            {s.alert ? (
              <i style={{ fontStyle: "normal", fontSize: 11, fontWeight: 600, color: "#fff", background: "#e03636", borderRadius: 9, padding: "0 6px", lineHeight: "17px" }}>{s.alert}</i>
            ) : s.badge ? (
              <b style={{ fontSize: 11, fontWeight: 600, color: "#6b6b6b", background: "#f0f0ee", borderRadius: 9, padding: "0 6px", lineHeight: "17px" }}>{s.badge}</b>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
