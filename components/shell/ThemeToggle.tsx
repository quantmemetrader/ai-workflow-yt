"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

/**
 * 浅色 / 深色 / 跟随系统, one press each, in the rail above 收起 (the owner,
 * 4 Oct: "add a dark mode"). The choice lives in a cookie so the server draws
 * the next page in it before paint (no white flash); switching here changes
 * the page at once, without a reload.
 */
const LABEL: Record<Theme, { zh: string; en: string }> = {
  light: { zh: "浅色", en: "Light" },
  dark: { zh: "深色", en: "Dark" },
  system: { zh: "跟随系统", en: "System" },
};

export function ThemeToggle({ zh, wide, initial }: { zh: boolean; wide: boolean; initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const now = document.documentElement.dataset.theme as Theme | undefined;
    if (now && THEMES.includes(now)) setTheme(now);
  }, []);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const choose = () => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${365 * 24 * 3600}; samesite=lax${secure}`;
  };
  const label = zh ? LABEL[theme].zh : LABEL[theme].en;
  const title = zh ? `外观：${LABEL[theme].zh}（点一下换成${LABEL[next].zh}）` : `Appearance: ${LABEL[theme].en} (press for ${LABEL[next].en})`;
  return (
    <button
      type="button"
      onClick={choose}
      title={title}
      aria-label={title}
      className={`r${wide ? " wide" : ""}`}
      style={{ border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit", letterSpacing: "inherit" }}
    >
      <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {theme === "dark" ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        ) : theme === "light" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
          </>
        ) : (
          <>
            <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
            <path d="M9 20h6M12 16.5V20" />
          </>
        )}
      </svg>
      {wide ? <span>{zh ? `外观 · ${label}` : `Theme · ${label}`}</span> : null}
    </button>
  );
}
