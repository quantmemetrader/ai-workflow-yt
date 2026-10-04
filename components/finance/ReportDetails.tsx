"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { generateReportAction } from "@/app/(app)/finance/actions";
import { forkReportAction, shareReportDocAction } from "@/app/(app)/docs/record-actions";

/** The report page's side panel: where it stands, and sharing, rewriting or starting a new draft from it. */
export function ReportDetails({
  id,
  period,
  state,
  sharedAt,
  body,
  bodyHtml,
  zh,
  english,
}: {
  id: string;
  period: string;
  state: string;
  sharedAt: string | null;
  body: string;
  bodyHtml: string | null;
  zh: boolean;
  english: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState<"share" | "rewrite" | "fork" | null>(null);
  const shared = state === "shared";

  const go = async (kind: "share" | "rewrite" | "fork") => {
    setBusy(kind);
    try {
      if (kind === "share") {
        const r = await shareReportDocAction(id);
        if (errorOf(r)) return notify(errorOf(r)!);
        notify(t("已分享，财务模块的人都能看到", "Shared with everyone in Finance"), "ok");
        router.refresh();
      } else if (kind === "rewrite") {
        const r = await generateReportAction(period);
        if (errorOf(r)) return notify(errorOf(r)!);
        notify(t("已按今天的数据重写", "Rewritten from today's figures"), "ok");
        if ("id" in r && r.id && r.id !== id) router.push(`/finance/reports/${r.id}`);
        else router.refresh();
      } else {
        const r = await forkReportAction(id, bodyHtml, body);
        if (errorOf(r)) return notify(errorOf(r)!);
        if ("id" in r && r.id) router.push(`/finance/reports/${r.id}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const on = sharedAt ? new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "Asia/Hong_Kong", dateStyle: "medium" }).format(new Date(sharedAt)) : null;

  return (
    <div className="rd">
      <style>{CSS}</style>
      <div className="rd-facts">
        <div>
          <span>{t("期间", "Period")}</span>
          {period}
        </div>
        <div>
          <span>{t("状态", "State")}</span>
          {shared ? `${t("已分享", "Shared")}${on ? ` · ${on}` : ""}` : t("草稿 · 未分享", "Draft · not shared")}
        </div>
      </div>
      <p className="rd-note">{t("这里的每个数字都是撰写当时的数字，之后不会随仪表盘变化，这正是它作为记录的意义。", "Every figure here is the figure that was true when this was written. It does not follow the dashboard afterwards — that is what makes it a record.")}</p>
      {english ? <p className="rd-warn">{t("这份草稿是之前用英文写的，点「重新生成」会按今天的数据改写成中文。", "This draft was written in English; Regenerate rewrites it in Chinese.")}</p> : null}
      {shared ? (
        <>
          <p className="rd-note">{t("已分享的报告不能再改，免得别人看过的内容被悄悄改掉。要修改，就另存为一份新草稿。", "A shared report is not changed in place. To edit it, save it as a new draft.")}</p>
          <button type="button" className="rd-solid" disabled={busy !== null} onClick={() => void go("fork")}>
            {busy === "fork" ? t("另存中…", "Saving…") : t("另存为新草稿", "Save as a new draft")}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="rd-solid" disabled={busy !== null} onClick={() => void go("share")}>
            {busy === "share" ? t("分享中…", "Sharing…") : t("分享给财务的同事", "Share with Finance")}
          </button>
          <button type="button" className="rd-ghost" disabled={busy !== null} onClick={() => void go("rewrite")} title={t("按今天的数据重写这一期的草稿，现在的改动会被替换", "Rewrites this draft from today's figures, replacing your edits")}>
            {busy === "rewrite" ? t("重写中，约一分钟…", "Rewriting, about a minute…") : t("按今天的数据重新生成", "Regenerate from today's figures")}
          </button>
        </>
      )}
    </div>
  );
}

const errorOf = (r: unknown) => (r as { error?: string }).error;

const CSS = `
.rd { display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: #1f1f1f; }
.rd-facts { display: flex; flex-direction: column; gap: 8px; }
.rd-facts div { display: flex; flex-direction: column; gap: 2px; }
.rd-facts span { font-size: 11.5px; color: #5f6368; }
.rd-note { margin: 0; font-size: 12px; line-height: 1.6; color: #5f6368; }
.rd-warn { margin: 0; padding: 8px 10px; border-radius: 8px; background: #fef7e0; color: #5c4400; font-size: 12px; line-height: 1.5; }
.rd-solid, .rd-ghost { height: 36px; border-radius: 999px; font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; }
.rd-solid { border: 0; background: #0b57d0; color: #fff; }
.rd-ghost { border: 1px solid #c7c7c7; background: #fff; color: #1f1f1f; }
.rd-solid:disabled, .rd-ghost:disabled { opacity: .55; cursor: default; }
`;
