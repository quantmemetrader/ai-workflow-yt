"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { useAsk } from "@/components/ui/useAsk";
import { removeKeyAction, saveKeyAction, testCurrentKeyAction } from "@/app/(app)/admin/key-actions";
import type { KeyName, KeyStatus } from "@/lib/keys/store";

/**
 * The studio's API keys, changed here rather than on the server (6 Oct). A
 * key is never shown back, not even in part: each row says whether one is
 * set, whether it was set here or on the server, and what the provider says
 * about it when tested. A new key is tested before it is saved.
 *
 * One row per thing a person actually holds (10 Oct: "we are making it too
 * hard"). Which service a key belongs to is a small dropdown inside its row,
 * not a row of its own; the Anthropic workspace ID is a field that appears
 * only when a pasted key starts with sk-ant-usr-, the kind that needs one.
 */
type Row = { key: KeyName; picker?: KeyName; workspace?: KeyName };

const GROUPS: { zh: string; en: string; noteZh: string; noteEn: string; rows: Row[] }[] = [
  { zh: "AI 模型", en: "AI models", noteZh: "所有 AI 同事和助理的回答都从这里来", noteEn: "Where every AI colleague's and assistant's answers come from", rows: [{ key: "OPENROUTER_API_KEY", picker: "OPENROUTER_BASE_URL" }, { key: "DEEPSEEK_API_KEY" }] },
  { zh: "Claude", en: "Claude", noteZh: "二选一即可；都没有时其他模型照常工作", noteEn: "Either one is enough; without both, the other models carry on", rows: [{ key: "ANTHROPIC_API_KEY", workspace: "ANTHROPIC_WORKSPACE_ID" }, { key: "OPENROUTER_API_KEY_CLAUDE", picker: "CLAUDE_GATEWAY_URL" }] },
  { zh: "数据和发布", en: "Data and publishing", noteZh: "选题调研、账号数据、发布到各平台", noteEn: "Topic research, account numbers, publishing", rows: [{ key: "TIKHUB_TOKEN" }, { key: "ZERNIO_API_KEY" }, { key: "YOUTUBE_API_KEY" }] },
  { zh: "配音和生成", en: "Voice and video", noteZh: "配音、克隆声音、AI 生成视频、主持人口播", noteEn: "Voice-over, cloning, AI video, the host talking", rows: [{ key: "ELEVENLABS_API_KEY" }, { key: "FAL_KEY" }] },
  { zh: "素材", en: "Stock media", noteZh: "剪辑时自动找的免费图片和视频", noteEn: "Free pictures and clips found while editing", rows: [{ key: "PEXELS_API_KEY" }, { key: "PIXABAY_API_KEY" }, { key: "UNSPLASH_ACCESS_KEY" }, { key: "POLLINATIONS_TOKEN" }] },
  { zh: "邮件", en: "Email", noteZh: "邀请和登录验证邮件", noteEn: "Invitation and sign-in emails", rows: [{ key: "RESEND_API_KEY" }] },
];

/* Shorter words than the store's, for the screen only. */
const LABEL: Partial<Record<KeyName, { zh: string; en: string; usesZh: string; uses: string }>> = {
  OPENROUTER_API_KEY: { zh: "AI 模型密钥", en: "AI models key", usesZh: "所有 AI 同事和助理都用它", uses: "Every AI colleague and the assistant use it" },
  DEEPSEEK_API_KEY: { zh: "DeepSeek（备用）", en: "DeepSeek (backup)", usesZh: "主密钥用不了时顶上", uses: "Steps in when the main key cannot answer" },
  ANTHROPIC_API_KEY: { zh: "Anthropic 密钥", en: "Anthropic key", usesZh: "Claude 直接走 Anthropic，不经过任何平台", uses: "Claude straight from Anthropic, no service in between" },
  OPENROUTER_API_KEY_CLAUDE: { zh: "Claude 密钥（经其他平台）", en: "Claude key (via a service)", usesZh: "Claude、GPT、Gemini 走这把密钥所属平台的账号", uses: "Claude, GPT and Gemini through the account this key belongs to" },
  FAL_KEY: { zh: "fal.ai（AI 视频、主持人口播）", en: "fal.ai (AI video, host talking)", usesZh: "AI 生成视频和主持人口播都用它", uses: "AI video and the host-talking video" },
  ELEVENLABS_API_KEY: { zh: "ElevenLabs（配音）", en: "ElevenLabs (voice)", usesZh: "配音、克隆声音", uses: "Voice-over and cloning" },
};

/* Each service's own icon beside its key (10 Oct: "logos of all products so it is easy to understand"). */
const LOGO: Partial<Record<KeyName, string>> = {
  OPENROUTER_API_KEY: "openrouter.ai",
  ANTHROPIC_API_KEY: "anthropic.com",
  OPENROUTER_API_KEY_CLAUDE: "openrouter.ai",
  DEEPSEEK_API_KEY: "deepseek.com",
  TIKHUB_TOKEN: "tikhub.io",
  ZERNIO_API_KEY: "zernio.com",
  ELEVENLABS_API_KEY: "elevenlabs.io",
  RESEND_API_KEY: "resend.com",
  YOUTUBE_API_KEY: "youtube.com",
  PEXELS_API_KEY: "pexels.com",
  PIXABAY_API_KEY: "pixabay.com",
  POLLINATIONS_TOKEN: "pollinations.ai",
  FAL_KEY: "fal.ai",
  UNSPLASH_ACCESS_KEY: "unsplash.com",
};
/* A row with a service dropdown shows the chosen service's icon. */
const SERVICE_LOGO: [RegExp, string][] = [
  [/orbio\.so/, "orbio.so"],
  [/\bb\.ai/, "b.ai"],
  [/openrouter\.ai/, "openrouter.ai"],
];

function logoFor(row: Row, picker: KeyStatus | undefined): string | null {
  if (picker?.choice) {
    const hit = SERVICE_LOGO.find(([re]) => re.test(picker.choice ?? ""));
    if (hit) return hit[1];
    return null;
  }
  return LOGO[row.key] ?? null;
}

export function ApiKeys({ keys, zh }: { keys: KeyStatus[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const ask = useAsk(zh);
  const [open, setOpen] = React.useState<string | null>(null);
  const [value, setValue] = React.useState("");
  const [ws, setWs] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, { ok: boolean; note: string }>>({});
  const errorOf = (r: unknown) => (r as { error?: string }).error;
  const byName = (n: KeyName | undefined) => (n ? keys.find((k) => k.name === n) : undefined);

  const save = async (row: Row) => {
    const name = row.key;
    setBusy(name);
    try {
      const key = value.trim();
      const workspace = ws.trim();
      /* A user-level Anthropic key brings its workspace along; the workspace alone can also be changed. */
      if (row.workspace && workspace) {
        const w = (await saveKeyAction(row.workspace, workspace)) as { error?: string };
        if (errorOf(w)) {
          setNotes((n) => ({ ...n, [name]: { ok: false, note: w.error! } }));
          return;
        }
      }
      if (!key) {
        if (row.workspace && workspace) {
          setNotes((n) => ({ ...n, [name]: { ok: true, note: t("工作区 ID 已保存", "Workspace ID saved") } }));
          setOpen(null);
          setWs("");
          router.refresh();
        }
        return;
      }
      const r = (await saveKeyAction(name, key)) as { error?: string; note?: string };
      if (errorOf(r)) {
        setNotes((n) => ({ ...n, [name]: { ok: false, note: r.error! } }));
        return;
      }
      setNotes((n) => ({ ...n, [name]: { ok: true, note: r.note ?? t("已保存", "Saved") } }));
      notify(t("已保存，30 秒内所有功能都会用上新密钥", "Saved; every part of the site uses it within 30 seconds"), "ok");
      setOpen(null);
      setValue("");
      setWs("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const test = async (name: KeyName) => {
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

  const pick = async (picker: KeyStatus, choice: string) => {
    setBusy(picker.name);
    try {
      const r = (await saveKeyAction(picker.name, choice)) as { error?: string };
      if (errorOf(r)) notify(errorOf(r)!);
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const renderRow = (row: Row) => {
    const k = byName(row.key);
    if (!k) return null;
    const picker = byName(row.picker);
    const workspace = byName(row.workspace);
    const label = LABEL[k.name];
    const name = label ? (zh ? label.zh : label.en) : zh ? k.zh : k.en;
    const uses = label ? (zh ? label.usesZh : label.uses) : zh ? k.usesZh : k.uses;
    const n = notes[k.name];
    const when = k.savedAt ? new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" }).format(new Date(k.savedAt)) : null;
    const logo = logoFor(row, picker);
    const editing = open === k.name;
    const needsWs = Boolean(row.workspace) && /^sk-ant-usr-/.test(value.trim());
    return (
      <div key={k.name} className="ak-row">
        <span className={`ak-logo${logo ? "" : " ak-logo-sw"}`} aria-hidden>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/brand/keys/${logo}.png`} alt="" width={28} height={28} loading="lazy" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7" /></svg>
          )}
        </span>
        <div className="ak-main">
          <div className="ak-name">
            {name}
            <span className={`ak-state ak-${k.source}`}>
              {k.source === "site" ? t("已设置", "Set") : k.source === "server" ? t("已设置", "Set") : t("未设置", "Not set")}
            </span>
            {picker?.choices ? (
              <label className="ak-pick">
                <span>{t("平台", "Service")}</span>
                <select value={picker.choice ?? picker.choices[0].value} disabled={busy === picker.name} aria-label={zh ? picker.zh : picker.en} onChange={(e) => void pick(picker, e.target.value)}>
                  {picker.choices.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="ak-uses">
            {uses}
            {workspace && workspace.source !== "none" ? t(" · 工作区 ID 已设置", " · workspace ID set") : ""}
            {when ? t(` · ${when} 更换`, ` · changed ${when}`) : ""}
          </div>
          {n ? <div className={n.ok ? "ak-ok" : "ak-bad"}>{n.note}</div> : null}
          {editing ? (
            <div className="ak-edit">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={value}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (value.trim() || ws.trim()) && !needsWs && void save(row)}
                placeholder={t("粘贴新的密钥", "Paste the new key")}
                aria-label={t(`${name} 的新密钥`, `New ${name}`)}
              />
              {row.workspace && (needsWs || (!value.trim() && workspace?.source !== "none")) ? (
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={ws}
                  onChange={(e) => setWs(e.target.value)}
                  placeholder={t("工作区 ID（wrkspc_ 开头）", "Workspace ID (wrkspc_…)")}
                  aria-label={t("Anthropic 工作区 ID", "Anthropic workspace ID")}
                />
              ) : null}
              <button type="button" className="ak-solid" disabled={busy === k.name || (!value.trim() && !ws.trim()) || (needsWs && !ws.trim())} onClick={() => void save(row)}>
                {busy === k.name ? t("验证中…", "Checking…") : t("验证并保存", "Check and save")}
              </button>
              <button type="button" className="ak-ghost" disabled={busy === k.name} onClick={() => { setOpen(null); setValue(""); setWs(""); }}>
                {t("取消", "Cancel")}
              </button>
              {needsWs ? <div className="ak-hint">{t("这是用户级密钥，Anthropic 要求指明工作区：在 Anthropic 控制台「设置 › 工作区」里复制 wrkspc_ 开头的 ID。", "A user-level key: Anthropic needs the workspace it should use. Copy the wrkspc_… ID from the Console under Settings › Workspaces.")}</div> : null}
            </div>
          ) : null}
        </div>
        {!editing ? (
          <div className="ak-actions">
            {k.source !== "none" ? (
              <button type="button" className="ak-ghost" disabled={busy === k.name} onClick={() => void test(k.name)}>
                {busy === k.name ? t("测试中…", "Testing…") : t("测试", "Test")}
              </button>
            ) : null}
            <button type="button" className="ak-solid" onClick={() => { setOpen(k.name); setValue(""); setWs(""); }}>
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
  };

  return (
    <div className="ak">
      {ask.dialog}
      <style>{CSS}</style>
      {GROUPS.map((g) => (
        <section key={g.zh} className="ak-group">
          <div className="ak-group-head">
            <div className="ak-group-name">{zh ? g.zh : g.en}</div>
            <div className="ak-group-note">{zh ? g.noteZh : g.noteEn}</div>
          </div>
          {g.rows.map(renderRow)}
        </section>
      ))}
    </div>
  );
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
.ak-site, .ak-server { background: #e6f4ea; color: #137333; }
.ak-none { background: #fce8e6; color: #a50e0e; }
.ak-pick { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: #6b6b6b; }
.ak-pick select { height: 24px; border: 1px solid #dadce0; border-radius: 6px; padding: 0 6px; font: inherit; font-size: 12px; background: #fff; color: #171717; }
.ak-uses { font-size: 11.5px; color: #8a8a8a; line-height: 1.5; }
.ak-ok { font-size: 12px; color: #137333; }
.ak-bad { font-size: 12px; color: #c5221f; }
.ak-hint { flex-basis: 100%; font-size: 11.5px; color: #6b6b6b; line-height: 1.5; }
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
