"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { useAsk } from "@/components/ui/useAsk";
import { removeKeyAction, saveKeyAction, testCurrentKeyAction } from "@/app/(app)/admin/key-actions";
import type { KeyName, KeyStatus } from "@/lib/keys/store";

/* Each service's own icon beside its key (10 Oct: "logos of all products so it is easy to understand"). */
const LOGO: Partial<Record<KeyName, string>> = {
  OPENROUTER_API_KEY: "openrouter.ai",
  ANTHROPIC_API_KEY: "anthropic.com",
  ANTHROPIC_WORKSPACE_ID: "anthropic.com",
  OPENROUTER_API_KEY_CLAUDE: "openrouter.ai",
  DEEPSEEK_API_KEY: "deepseek.com",
  TIKHUB_TOKEN: "tikhub.io",
  ZERNIO_API_KEY: "zernio.com",
  ELEVENLABS_API_KEY: "elevenlabs.io",
  RESEND_API_KEY: "resend.com",
  YOUTUBE_API_KEY: "youtube.com",
  PEXELS_API_KEY: "pexels.com",
  FAL_KEY: "fal.ai",
  UNSPLASH_ACCESS_KEY: "unsplash.com",
};
/* The rows in the order a person thinks about them, under a heading that says what the group is for. */
const GROUPS: { zh: string; en: string; noteZh: string; noteEn: string; keys: KeyName[] }[] = [
  { zh: "AI 模型", en: "AI models", noteZh: "所有 AI 同事和助理的回答都从这里来", noteEn: "Where every AI colleague's and assistant's answers come from", keys: ["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "DEEPSEEK_API_KEY"] },
  { zh: "Claude", en: "Claude", noteZh: "Claude、GPT、Gemini 的专用通道；没有也能正常工作", noteEn: "A separate channel for Claude, GPT and Gemini; everything works without it", keys: ["ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID", "CLAUDE_GATEWAY_URL", "OPENROUTER_API_KEY_CLAUDE"] },
  { zh: "数据和发布", en: "Data and publishing", noteZh: "选题调研、账号数据、发布到各平台", noteEn: "Topic research, account numbers, publishing", keys: ["TIKHUB_TOKEN", "ZERNIO_API_KEY", "YOUTUBE_API_KEY"] },
  { zh: "配音和生成", en: "Voice and video", noteZh: "配音、克隆声音、AI 生成视频、主持人口播", noteEn: "Voice-over, cloning, AI video, the host talking", keys: ["ELEVENLABS_API_KEY", "FAL_KEY"] },
  { zh: "素材", en: "Stock media", noteZh: "剪辑时自动找的免费图片和视频", noteEn: "Free pictures and clips found while editing", keys: ["PEXELS_API_KEY", "UNSPLASH_ACCESS_KEY"] },
  { zh: "邮件", en: "Email", noteZh: "邀请和登录验证邮件", noteEn: "Invitation and sign-in emails", keys: ["RESEND_API_KEY"] },
];

function Logo({ k }: { k: KeyStatus }) {
  const file = LOGO[k.name] ?? (k.choices ? "switch" : null);
  if (file === "switch") {
    return (
      <span className="ak-logo ak-logo-sw" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M16 21h5v-5M21 21l-7-7M8 3H3v5M3 3l7 7" /></svg>
      </span>
    );
  }
  return <span className="ak-logo"><img src={`/brand/keys/${file}.png`} alt="" width={28} height={28} loading="lazy" /></span>;
}

/**
 * The studio's API keys, changed here rather than on the server (6 Oct). A
 * key is never shown back, not even in part: each row says whether one is
 * set, whether it was set here or on the server, and what the provider says
 * about it when tested. A new key is tested before it is saved.
 */
export function ApiKeys({ keys, zh }: { keys: KeyStatus[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const ask = useAsk(zh);
  const [open, setOpen] = React.useState<string | null>(null);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, { ok: boolean; note: string }>>({});
  const errorOf = (r: unknown) => (r as { error?: string }).error;

  const save = async (name: string) => {
    setBusy(name);
    try {
      const r = (await saveKeyAction(name, value)) as { error?: string; note?: string };
      if (errorOf(r)) {
        setNotes((n) => ({ ...n, [name]: { ok: false, note: r.error! } }));
        return;
      }
      setNotes((n) => ({ ...n, [name]: { ok: true, note: r.note ?? t("已保存", "Saved") } }));
      notify(t("已保存，30 秒内所有功能都会用上新密钥", "Saved; every part of the site uses it within 30 seconds"), "ok");
      setOpen(null);
      setValue("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const test = async (name: string) => {
    setBusy(name);
    try {
      const r = (await testCurrentKeyAction(name)) as { error?: string; ok?: boolean; note?: string };
      setNotes((n) => ({ ...n, [name]: errorOf(r) ? { ok: false, note: r.error! } : { ok: Boolean(r.ok), note: r.note ?? "" } }));
    } finally {
      setBusy(null);
    }
  };

  const reset = async (k: KeyStatus) => {
    const yes = await ask.confirm({
      title: t(`不再用网页里设置的 ${k.zh} 密钥？`, `Stop using the ${k.en} key set here?`),
      body: t("之后改用服务器配置文件里的密钥；如果服务器上没有，这项功能会停用。", "The server's own key is used instead; without one, this feature stops."),
      confirm: t("恢复为服务器配置", "Use the server's key"),
      danger: true,
    });
    if (!yes) return;
    setBusy(k.name);
    try {
      const r = await removeKeyAction(k.name);
      if (errorOf(r)) notify(errorOf(r)!);
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ak">
      {ask.dialog}
      <style>{CSS}</style>
      {GROUPS.map((g) => {
        const rows = g.keys.map((name) => keys.find((k) => k.name === name)).filter((k): k is KeyStatus => Boolean(k));
        if (!rows.length) return null;
        return (
          <section key={g.zh} className="ak-group">
            <div className="ak-group-head">
              <div className="ak-group-name">{zh ? g.zh : g.en}</div>
              <div className="ak-group-note">{zh ? g.noteZh : g.noteEn}</div>
            </div>
            {rows.map((k) => renderRow(k))}
          </section>
        );
      })}
      {keys.filter((k) => !GROUPS.some((g) => g.keys.includes(k.name))).map((k) => renderRow(k))}
    </div>
  );

  function renderRow(k: KeyStatus) {
    {
        const n = notes[k.name];
        const when = k.savedAt ? new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" }).format(new Date(k.savedAt)) : null;
        return (
          <div key={k.name} className="ak-row">
            <Logo k={k} />
            <div className="ak-main">
              <div className="ak-name">
                {zh ? k.zh : k.en}
                <span className={`ak-state ak-${k.source}`}>
                  {k.source === "site" ? t("已设置 · 在这里设置的", "Set · here") : k.source === "server" ? t("已设置 · 服务器配置", "Set · on the server") : t("未设置", "Not set")}
                </span>
              </div>
              <div className="ak-uses">
                {zh ? k.usesZh : k.uses}
                {when ? t(` · ${k.savedBy ?? "某人"} 于 ${when} 更换`, ` · changed by ${k.savedBy ?? "somebody"}, ${when}`) : ""}
              </div>
              {n ? <div className={n.ok ? "ak-ok" : "ak-bad"}>{n.note}</div> : null}
              {open === k.name ? (
                <div className="ak-edit">
                  {k.choices ? (
                    <select value={value} onChange={(e) => setValue(e.target.value)} aria-label={zh ? k.zh : k.en} style={{ flex: 1, minWidth: 220, height: 32, border: "1px solid #dadce0", borderRadius: 8, padding: "0 8px", font: "inherit", fontSize: 13 }}>
                      <option value="">{t("选一家平台", "Choose a service")}</option>
                      {k.choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    hidden={Boolean(k.choices)}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={value}
                    autoFocus
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && value.trim() && void save(k.name)}
                    placeholder={t("粘贴新的密钥", "Paste the new key")}
                    aria-label={t(`${k.zh} 的新密钥`, `New ${k.en} key`)}
                  />
                  <button type="button" className="ak-solid" disabled={busy === k.name || !value.trim()} onClick={() => void save(k.name)}>
                    {busy === k.name ? t("验证中…", "Checking…") : t("验证并保存", "Check and save")}
                  </button>
                  <button type="button" className="ak-ghost" disabled={busy === k.name} onClick={() => { setOpen(null); setValue(""); }}>
                    {t("取消", "Cancel")}
                  </button>
                </div>
              ) : null}
            </div>
            {open !== k.name ? (
              <div className="ak-actions">
                {k.source !== "none" ? (
                  <button type="button" className="ak-ghost" disabled={busy === k.name} onClick={() => void test(k.name)}>
                    {busy === k.name ? t("测试中…", "Testing…") : t("测试", "Test")}
                  </button>
                ) : null}
                <button type="button" className="ak-solid" onClick={() => { setOpen(k.name); setValue(""); }}>
                  {k.source === "none" ? t("设置", "Set") : t("更换", "Replace")}
                </button>
                {k.source === "site" ? (
                  <button type="button" className="ak-link" disabled={busy === k.name} onClick={() => void reset(k)}>
                    {t("恢复为服务器配置", "Use the server's key")}
                  </button>
                ) : null}
                <a className="ak-link" href={k.link} target="_blank" rel="noopener noreferrer">
                  {t("去拿密钥", "Get a key")} ↗
                </a>
              </div>
            ) : null}
          </div>
        );
    }
  }
}

const CSS = `
.ak { display: flex; flex-direction: column; }
.ak-group { margin-top: 18px; }
.ak-group:first-child { margin-top: 0; }
.ak-group-head { padding: 0 0 6px; }
.ak-group-name { font-size: 13.5px; font-weight: 650; color: #171717; }
.ak-group-note { font-size: 12px; color: #8a8a8a; }
.ak-logo { flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px; border: 1px solid #ececea; background: #fff; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; margin-top: 2px; }
.ak-logo img { width: 28px; height: 28px; object-fit: contain; display: block; }
.ak-logo-sw { color: #6b6b6b; background: #f5f5f3; }
.ak-row { display: flex; gap: 14px; align-items: flex-start; border-top: 1px solid #f0f0f0; padding: 12px 0; }
.ak-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ak-name { font-size: 13px; font-weight: 500; color: #171717; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ak-state { font-size: 11px; font-weight: 500; padding: 1px 8px; border-radius: 999px; }
.ak-site { background: #e6f4ea; color: #137333; }
.ak-server { background: #f1f3f4; color: #3c4043; }
.ak-none { background: #fce8e6; color: #a50e0e; }
.ak-uses { font-size: 11.5px; color: #8a8a8a; line-height: 1.5; }
.ak-ok { font-size: 12px; color: #137333; }
.ak-bad { font-size: 12px; color: #c5221f; }
.ak-edit { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.ak-edit input { flex: 1; min-width: 220px; height: 32px; border: 1px solid #dadce0; border-radius: 8px; padding: 0 10px; font: inherit; font-size: 13px; }
.ak-edit input:focus { outline: none; border-color: #1a73e8; }
.ak-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; max-width: 46%; }
.ak-solid, .ak-ghost { height: 30px; padding: 0 12px; border-radius: 8px; font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.ak-solid { border: 0; background: #171717; color: #fff; }
.ak-ghost { border: 1px solid #e2e2e2; background: #fff; color: #171717; }
.ak-solid:disabled, .ak-ghost:disabled { opacity: .5; cursor: default; }
.ak-link { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; color: #1a73e8; cursor: pointer; text-decoration: none; white-space: nowrap; }
`;
