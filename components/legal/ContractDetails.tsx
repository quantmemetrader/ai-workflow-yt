"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { updateContractDetailsAction } from "@/app/(app)/docs/record-actions";

const STATES: [string, string, string][] = [
  ["draft", "草稿", "Draft"],
  ["in_review", "审阅中", "In review"],
  ["sent", "已发出", "Sent"],
  ["signed", "已签署", "Signed"],
  ["expired", "已到期", "Expired"],
  ["terminated", "已终止", "Terminated"],
];

/** The contract page's side panel: who it is with, where it stands, its dates, and what it was drafted with. */
export function ContractDetails({
  id,
  zh,
  counterparty,
  state,
  signedOn,
  expiresOn,
  templateName,
  ownerName,
  values,
  fieldLabels,
  updatedAt,
  canEdit,
}: {
  id: string;
  zh: boolean;
  counterparty: string;
  state: string;
  signedOn: string;
  expiresOn: string;
  templateName: string | null;
  ownerName: string | null;
  values: [string, string][];
  fieldLabels: Record<string, string>;
  updatedAt: string;
  canEdit: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [who, setWho] = React.useState(counterparty);

  const save = async (input: { counterparty?: string; state?: string; signedOn?: string; expiresOn?: string }, reload = false) => {
    setBusy(true);
    try {
      const r = await updateContractDetailsAction(id, input);
      if (errorOf(r)) notify(errorOf(r)!);
      else {
        notify(t("已保存", "Saved"), "ok");
        /* Signing makes the text read-only, reopening makes it editable: the page follows. */
        if (reload) router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const day = new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "short", day: "numeric" }).format(new Date(updatedAt));

  return (
    <div className="cd">
      <style>{CSS}</style>
      <label className="cd-row">
        <span>{t("对方", "With")}</span>
        <input value={who} disabled={!canEdit || busy} onChange={(e) => setWho(e.target.value)} onBlur={() => who !== counterparty && void save({ counterparty: who })} placeholder={t("对方名称", "Other party")} />
      </label>
      <label className="cd-row">
        <span>{t("状态", "State")}</span>
        <select value={state} disabled={!canEdit || busy} onChange={(e) => void save({ state: e.target.value }, true)}>
          {STATES.map(([v, a, b]) => (
            <option key={v} value={v}>
              {t(a, b)}
            </option>
          ))}
        </select>
      </label>
      <label className="cd-row">
        <span>{t("签署日", "Signed")}</span>
        <input type="date" defaultValue={signedOn} disabled={!canEdit || busy} onBlur={(e) => e.target.value !== signedOn && void save({ signedOn: e.target.value })} />
      </label>
      <label className="cd-row">
        <span>{t("到期日", "Expires")}</span>
        <input type="date" defaultValue={expiresOn} disabled={!canEdit || busy} onBlur={(e) => e.target.value !== expiresOn && void save({ expiresOn: e.target.value })} />
      </label>
      {state === "signed" || state === "expired" || state === "terminated" ? (
        <p className="cd-note">{t("已签署、已到期或已终止的合同只能查看和下载。要修改正文，先把状态改回草稿或审阅中。", "Signed, expired and terminated contracts are read-only. To change the text, set the state back to draft or in review.")}</p>
      ) : null}
      <div className="cd-facts">
        <div>
          <span>{t("模板", "Template")}</span>
          {templateName ?? t("无", "none")}
        </div>
        <div>
          <span>{t("负责人", "Owner")}</span>
          {ownerName ?? "—"}
        </div>
        <div>
          <span>{t("最近修改", "Last changed")}</span>
          {day}
        </div>
      </div>
      {values.length ? (
        <details className="cd-values">
          <summary>{t("起草时填写的内容", "Filled in when drafted")}</summary>
          {values.map(([k, v]) => (
            <div key={k}>
              <span>{fieldLabels[k] ?? k.replace(/_/g, " ")}</span>
              {v}
            </div>
          ))}
        </details>
      ) : null}
      <Link href="/legal?tab=review" className="cd-link">
        {t("与模板比对、看差异 →", "Compare with the template →")}
      </Link>
    </div>
  );
}

const errorOf = (r: unknown) => (r as { error?: string }).error;

const CSS = `
.cd { display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: #1f1f1f; }
.cd-row { display: flex; flex-direction: column; gap: 4px; }
.cd-row > span, .cd-facts span, .cd-values span { font-size: 11.5px; color: #5f6368; }
.cd-row input, .cd-row select { height: 34px; border: 1px solid #dadce0; border-radius: 8px; padding: 0 10px; font: inherit; font-size: 13px; background: #fff; color: #1f1f1f; }
.cd-row input:focus, .cd-row select:focus { outline: none; border-color: #1a73e8; }
.cd-note { margin: 0; padding: 8px 10px; border-radius: 8px; background: #fef7e0; color: #5c4400; font-size: 12px; line-height: 1.5; }
.cd-facts { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; }
.cd-facts div, .cd-values div { display: flex; flex-direction: column; gap: 2px; }
.cd-values { border-top: 1px solid #eee; padding-top: 10px; }
.cd-values summary { cursor: pointer; font-size: 12.5px; color: #3c4043; margin-bottom: 8px; }
.cd-values div { margin-bottom: 8px; word-break: break-word; }
.cd-link { font-size: 13px; color: #1a73e8; text-decoration: none; padding-top: 4px; }
.cd-link:hover { text-decoration: underline; }
`;
