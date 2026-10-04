"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { decideSpendAction, markPaidAction } from "@/app/(app)/finance/actions";
import { usd } from "@/components/finance/usd";

const STATE: Record<string, [string, string, string]> = {
  draft: ["草稿", "Draft", "#5f6368"],
  awaiting_approval: ["待审批", "Awaiting approval", "#b06000"],
  approved: ["已批准", "Approved", "#188038"],
  rejected: ["已拒绝", "Rejected", "#c5221f"],
  paid: ["已付款", "Paid", "#188038"],
  cancelled: ["已取消", "Cancelled", "#5f6368"],
};

/** The spend request page's side panel: the amount, who has decided, and approving, rejecting or marking it paid. */
export function SpendDetails({
  id,
  zh,
  amountMicros,
  centreName,
  state,
  approvalsNeeded,
  requestedByName,
  mine,
  createdAt,
  decisions,
  period,
}: {
  id: string;
  zh: boolean;
  amountMicros: number;
  centreName: string | null;
  state: string;
  approvalsNeeded: number;
  requestedByName: string | null;
  mine: boolean;
  createdAt: string;
  decisions: { deciderName: string | null; decision: string; note: string | null; at: string }[];
  period: string;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const approvals = decisions.filter((d) => d.decision === "approve").length;
  const label = STATE[state] ?? [state, state, "#5f6368"];
  const day = (iso: string) => new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "Asia/Hong_Kong", dateStyle: "medium" }).format(new Date(iso));

  const act = async (run: () => Promise<{ error?: string } | Record<string, unknown>>, done: string) => {
    setBusy(true);
    try {
      const r = (await run()) as { error?: string };
      if (r.error) return notify(r.error);
      notify(done, "ok");
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sd">
      <style>{CSS}</style>
      <div className="sd-amount">{usd(amountMicros)}</div>
      <div className="sd-state" style={{ color: label[2] }}>
        {t(label[0], label[1])} · {zh ? `已批准 ${approvals}/${approvalsNeeded}` : `${approvals}/${approvalsNeeded} approvals`}
      </div>
      <div className="sd-facts">
        <div>
          <span>{t("提交人", "Raised by")}</span>
          {requestedByName ?? t("未知", "unknown")}
        </div>
        <div>
          <span>{t("归类", "Filed under")}</span>
          {centreName ?? t("未归类", "Not filed")}
        </div>
        <div>
          <span>{t("提交时间", "Raised on")}</span>
          {day(createdAt)}
        </div>
      </div>
      {decisions.length ? (
        <div className="sd-log">
          <span>{t("审批记录", "Decisions")}</span>
          {decisions.map((d, i) => (
            <div key={i}>
              <b style={{ color: d.decision === "approve" ? "#188038" : "#c5221f" }}>{d.decision === "approve" ? t("批准", "Approved") : t("拒绝", "Rejected")}</b>
              {" · "}
              {d.deciderName ?? t("某人", "Somebody")} · {day(d.at)}
              {d.note ? <p>{d.note}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {state === "awaiting_approval" && !mine ? (
        <div className="sd-decide">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("备注，会记录在案（可不填）", "A note, on the record (optional)")} rows={2} />
          <div>
            <button type="button" className="sd-ghost" disabled={busy} onClick={() => void act(() => decideSpendAction(id, "reject", note), t("已拒绝", "Rejected"))}>
              {t("拒绝", "Reject")}
            </button>
            <button type="button" className="sd-solid" disabled={busy} onClick={() => void act(() => decideSpendAction(id, "approve", note), t("已批准", "Approved"))}>
              {t("批准", "Approve")}
            </button>
          </div>
        </div>
      ) : null}
      {state === "awaiting_approval" && mine ? <p className="sd-note">{t("这是你提交的，需由他人决定。审批人会看左边这一页，写清楚用途和报价更容易通过。", "You raised this, so somebody else decides. Approvers read the page on the left.")}</p> : null}
      {state === "approved" ? (
        <button type="button" className="sd-solid" disabled={busy} onClick={() => void act(() => markPaidAction(id, period), t("已标记为已付", "Marked paid"))}>
          {t(`标记为已付，计入 ${period}`, `Mark paid, into ${period}`)}
        </button>
      ) : null}
    </div>
  );
}

const CSS = `
.sd { display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: #1f1f1f; }
.sd-amount { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.sd-state { font-size: 13px; font-weight: 500; margin-top: -6px; }
.sd-facts, .sd-log { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; }
.sd-facts div { display: flex; flex-direction: column; gap: 2px; }
.sd-facts span, .sd-log > span { font-size: 11.5px; color: #5f6368; }
.sd-log div { font-size: 12.5px; line-height: 1.5; }
.sd-log p { margin: 2px 0 0; color: #5f6368; }
.sd-decide { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; }
.sd-decide textarea { border: 1px solid #dadce0; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; resize: vertical; }
.sd-decide textarea:focus { outline: none; border-color: #1a73e8; }
.sd-decide > div { display: flex; gap: 8px; }
.sd-decide > div button { flex: 1; }
.sd-solid, .sd-ghost { height: 36px; border-radius: 999px; font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; padding: 0 16px; }
.sd-solid { border: 0; background: #0b57d0; color: #fff; }
.sd-ghost { border: 1px solid #c7c7c7; background: #fff; color: #1f1f1f; }
.sd-solid:disabled, .sd-ghost:disabled { opacity: .55; cursor: default; }
.sd-note { margin: 0; font-size: 12px; line-height: 1.6; color: #5f6368; }
`;
