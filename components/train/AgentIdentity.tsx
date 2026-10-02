"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setAgentNameAction } from "@/app/(app)/train/model-actions";
import { notify } from "@/lib/client/notify";

/**
 * What the studio calls this AI employee, and the one line on what it does
 * (Ryan, 2 Oct: "can we rename our AI employees ourselves?"). Admins edit it
 * here; the new name shows on every screen, in @mentions and in the
 * employee's own prompt. Empty fields fall back to the built-in name.
 */
export function AgentIdentity({
  agent,
  zh,
  current,
  defaults,
  canEdit,
}: {
  agent: string;
  zh: boolean;
  current: { zh?: string; en?: string; hint?: string; hintEn?: string };
  defaults: { zh: string; en: string; hint: string; hintEn: string };
  canEdit: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [zhName, setZhName] = React.useState(current.zh ?? "");
  const [enName, setEnName] = React.useState(current.en ?? "");
  const [hint, setHint] = React.useState(current.hint ?? "");
  const [hintEn, setHintEn] = React.useState(current.hintEn ?? "");
  const [pending, start] = React.useTransition();
  const changed = (zhName || "") !== (current.zh ?? "") || (enName || "") !== (current.en ?? "") || (hint || "") !== (current.hint ?? "") || (hintEn || "") !== (current.hintEn ?? "");
  const input: React.CSSProperties = { height: 34, border: "1px solid #d6d4ce", borderRadius: 8, padding: "0 10px", font: "inherit", fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" };
  const label: React.CSSProperties = { fontSize: 12, color: "#6b6b6b", marginBottom: 4 };
  const btn = (primary = false): React.CSSProperties => ({ height: 32, padding: "0 13px", borderRadius: 8, border: `1px solid ${primary ? "#171717" : "#dcdbd6"}`, background: primary ? "#171717" : "#fff", color: primary ? "#fff" : "#262626", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" });
  const save = (reset = false) =>
    start(async () => {
      const r = await setAgentNameAction(agent, reset ? null : { zh: zhName, en: enName, hint, hintEn });
      if (r.error) return notify(r.error);
      if (reset) {
        setZhName("");
        setEnName("");
        setHint("");
        setHintEn("");
      }
      notify(reset ? t("已恢复默认名字", "Back to the built-in name") : t("已改好，所有页面都会用新名字", "Saved; every screen uses the new name"), "ok");
      setOpen(false);
      router.refresh();
    });

  return (
    <section style={{ border: "1px solid #ecebe7", borderRadius: 14, background: "#fff", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 650, color: "#171717" }}>{t("名字和职责", "Name and role")}</div>
          <div style={{ fontSize: 12.5, color: "#6b6b6b", marginTop: 2 }}>
            {t(`现在叫「${current.zh || defaults.zh}」（${current.en || defaults.en}）：${current.hint || defaults.hint}`, `Now called ${current.en || defaults.en} (${current.zh || defaults.zh}): ${current.hintEn || defaults.hintEn}`)}
          </div>
        </div>
        {canEdit ? (
          <button type="button" style={btn()} onClick={() => setOpen((v) => !v)}>
            {open ? t("收起", "Close") : t("改名字 / 职责", "Rename or change the role")}
          </button>
        ) : null}
      </div>
      {open && canEdit ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={label}>{t("中文名", "Chinese name")}</div>
            <input value={zhName} onChange={(e) => setZhName(e.target.value)} placeholder={defaults.zh} maxLength={12} style={input} />
          </div>
          <div>
            <div style={label}>{t("英文名", "English name")}</div>
            <input value={enName} onChange={(e) => setEnName(e.target.value)} placeholder={defaults.en} maxLength={24} style={input} />
          </div>
          <div>
            <div style={label}>{t("一句话职责（中文）", "One-line role (Chinese)")}</div>
            <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder={defaults.hint} maxLength={80} style={input} />
          </div>
          <div>
            <div style={label}>{t("一句话职责（英文）", "One-line role (English)")}</div>
            <input value={hintEn} onChange={(e) => setHintEn(e.target.value)} placeholder={defaults.hintEn} maxLength={120} style={input} />
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={btn(true)} disabled={pending || !changed} onClick={() => save(false)}>
              {pending ? t("保存中…", "Saving…") : t("保存", "Save")}
            </button>
            <button type="button" style={btn()} disabled={pending} onClick={() => save(true)}>
              {t("恢复默认", "Use the built-in name")}
            </button>
            <span style={{ fontSize: 12, color: "#8a8a8a" }}>{t("改完后，@ 新名字就能叫到它；旧名字也还认得。", "After saving, @ the new name reaches it; the old name still works.")}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
