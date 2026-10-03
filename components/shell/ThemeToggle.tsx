"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/app/(app)/settings/actions";
import type { Locale } from "@/lib/i18n";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

/**
 * 浅色 / 深色, one press, in the rail above 收起 (the owner,
 * 4 Oct: "add a dark mode"). The choice lives in a cookie so the server draws
 * the next page in it before paint (no white flash); switching here changes
 * the page at once, without a reload.
 */
const LABEL: Record<Theme, { zh: string; en: string }> = {
  light: { zh: "浅色", en: "Light" },
  dark: { zh: "深色", en: "Dark" },
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
          <path fill="none" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" fill="none" />
            <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
          </>
        )}
      </svg>
      {wide ? <span>{zh ? `外观 · ${label}` : `Theme · ${label}`}</span> : null}
    </button>
  );
}

/**
 * 中 / EN beside it (the owner, 4 Oct): the whole studio's language for this
 * person, the same choice as 设置 › 语言, one press from any page.
 */
export function LangToggle({ zh, wide }: { zh: boolean; wide: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next: Locale = zh ? "en" : "zh-CN";
  const title = zh ? "切换到英文 (English)" : "切换到中文 (Switch to Chinese)";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await setLocaleAction(next); router.refresh(); })}
      title={title}
      aria-label={title}
      className={`r${wide ? " wide" : ""}`}
      style={{ border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit", letterSpacing: "inherit", opacity: pending ? 0.5 : 1 }}
    >
      <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" fill="none" />
        <path fill="none" d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z" />
      </svg>
      {wide ? <span>{zh ? "语言 · 中文" : "Language · English"}</span> : null}
    </button>
  );
}
