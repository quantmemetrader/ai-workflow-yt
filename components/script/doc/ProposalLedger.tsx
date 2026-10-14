"use client";

import * as React from "react";
import type { ProposalItem } from "@/lib/db/schema";

export type LedgerRow = { id: string; summary: string; ask: string; source: string; createdAt: string; by: string | null; items: ProposalItem[] };

/**
 * 修改记录: every set of AI edits on this script and what became of each change (15 Oct: "once accepted or
 * rejected, the amendment cannot be recalled — need to be able to recall it, even if picked").
 *
 * Kept on the server, so it is there after a reload, on another computer, for a colleague. Each change shows
 * the paragraph before and after; an accepted one can be taken back (the original text is put back as a
 * suggestion to accept), a rejected one can be used after all. Either way it comes back marked in the page,
 * so nothing changes without a press.
 */
export function ProposalLedger({ rows, zh, canEdit, busy, onRecall }: { rows: LedgerRow[]; zh: boolean; canEdit: boolean; busy: boolean; onRecall: (row: LedgerRow, itemIds: string[]) => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [open, setOpen] = React.useState<string | null>(null);
  const decided = rows.filter((r) => r.items.some((i) => i.state === "accepted" || i.state === "rejected" || i.state === "recalled"));
  if (!decided.length) return null;
  const when = (iso: string) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString(zh ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(zh ? "zh-CN" : "en-GB", { month: "short", day: "numeric" });
  };
  const KIND: Record<ProposalItem["kind"], string> = { change: t("改写", "Rewrite"), delete: t("删除", "Delete"), insert: t("新增", "Add") };
  const STATE: Record<ProposalItem["state"], string> = { open: t("待定", "Open"), accepted: t("已接受", "Accepted"), rejected: t("已拒绝", "Rejected"), recalled: t("已撤回", "Taken back") };
  return (
    <div className="pl">
      <style>{CSS}</style>
      <div className="pl-h">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden><path d="M12 7v5l3 2M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>{t("修改记录", "Edit history")}</span>
        <span className="pl-n">{decided.length}</span>
      </div>
      <div className="pl-list">
        {decided.map((r) => {
          const acc = r.items.filter((i) => i.state === "accepted");
          const rej = r.items.filter((i) => i.state === "rejected");
          const isOpen = open === r.id;
          const backable = [...acc, ...rej];
          return (
            <div key={r.id} className={`pl-card${isOpen ? " open" : ""}`}>
              <button type="button" className="pl-top" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                <span className="pl-time">{when(r.createdAt)}</span>
                <span className="pl-ask">{r.ask || r.summary || t("文案的修改建议", "The writer's edits")}</span>
                <span className="pl-tally">
                  {acc.length ? <i className="ok">{t(`接受 ${acc.length}`, `${acc.length} in`)}</i> : null}
                  {rej.length ? <i className="no">{t(`拒绝 ${rej.length}`, `${rej.length} out`)}</i> : null}
                </span>
                <svg className="pl-chev" viewBox="0 0 24 24" width="11" height="11" aria-hidden><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {isOpen ? (
                <div className="pl-items">
                  {r.items.map((it) => (
                    <div key={it.id} className={`pl-item s-${it.state}`}>
                      <div className="pl-item-h">
                        <span className="pl-kind">{KIND[it.kind]}</span>
                        <span className={`pl-state s-${it.state}`}>{STATE[it.state]}</span>
                        {it.why ? <span className="pl-why">{it.why}</span> : null}
                        {canEdit && (it.state === "accepted" || it.state === "rejected") ? (
                          <button type="button" className="pl-back" disabled={busy} onClick={() => onRecall(r, [it.id])}>
                            {it.state === "accepted" ? t("撤回", "Take back") : t("改用这条", "Use it")}
                          </button>
                        ) : null}
                      </div>
                      {it.before ? <div className="pl-before">{it.before}</div> : null}
                      {it.text ? <div className="pl-after">{it.text}</div> : null}
                    </div>
                  ))}
                  {canEdit && backable.length > 1 ? (
                    <button type="button" className="pl-all" disabled={busy} onClick={() => onRecall(r, backable.map((i) => i.id))}>
                      {t("这一次的全部撤回 / 改回", "Reverse every decision in this set")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="pl-foot">{t("撤回后，原来的文字会以修改建议标在文档里，按「接受」才会真正改回。", "A taken-back change comes back marked in the page; it changes only when you accept it.")}</div>
    </div>
  );
}

const CSS = `
.pl { border: 1px solid #ebeae6; border-radius: 12px; background: #fff; margin-bottom: 12px; overflow: hidden; }
.pl-h { display: flex; align-items: center; gap: 7px; padding: 9px 12px; font-size: 12.5px; font-weight: 600; color: #262626; border-bottom: 1px solid #f2f1ed; }
.pl-n { margin-left: auto; font-size: 11px; color: #8a8a8a; font-weight: 500; background: #f2f1ed; border-radius: 999px; padding: 1px 7px; }
.pl-list { display: flex; flex-direction: column; }
.pl-card + .pl-card { border-top: 1px solid #f4f3ef; }
.pl-top { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 0; background: transparent; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; color: #262626; }
.pl-top:hover { background: #fafaf8; }
.pl-time { color: #a3a3a3; font-size: 11.5px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.pl-ask { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-tally { display: inline-flex; gap: 4px; flex-shrink: 0; }
.pl-tally i { font-style: normal; font-size: 10.5px; padding: 1px 6px; border-radius: 999px; }
.pl-tally .ok { background: #e8f3ec; color: #2f7d4f; }
.pl-tally .no { background: #f2f1ed; color: #6b6b6b; }
.pl-chev { color: #b5b5b5; transition: transform .15s; flex-shrink: 0; }
.pl-card.open .pl-chev { transform: rotate(90deg); }
.pl-items { display: flex; flex-direction: column; gap: 8px; padding: 2px 12px 12px; }
.pl-item { border: 1px solid #f0efeb; border-radius: 10px; padding: 8px 10px; background: #fcfcfb; }
.pl-item-h { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 5px; }
.pl-kind { font-size: 11px; font-weight: 600; color: #525252; }
.pl-state { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; }
.pl-state.s-accepted { background: #e8f3ec; color: #2f7d4f; }
.pl-state.s-rejected { background: #f2f1ed; color: #6b6b6b; }
.pl-state.s-recalled { background: #eef4fb; color: #2a5d8f; }
.pl-state.s-open { background: #fff7e6; color: #8a5a00; }
.pl-why { font-size: 11.5px; color: #8a8a8a; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-back { margin-left: auto; height: 24px; padding: 0 10px; border-radius: 7px; border: 1px solid #171717; background: #171717; color: #fff; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.pl-item.s-rejected .pl-back { background: #fff; color: #171717; }
.pl-back:disabled { opacity: .5; cursor: default; }
.pl-before { font-size: 12px; line-height: 1.6; color: #a14a4a; text-decoration: line-through; text-decoration-color: rgba(161,74,74,.45); white-space: pre-wrap; }
.pl-after { font-size: 12px; line-height: 1.6; color: #1f5a37; background: #f1f8f3; border-radius: 6px; padding: 3px 6px; margin-top: 4px; white-space: pre-wrap; }
.pl-all { align-self: flex-start; height: 26px; padding: 0 10px; border-radius: 7px; border: 1px solid #dcdbd6; background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
.pl-foot { font-size: 11px; color: #a3a3a3; padding: 7px 12px 9px; border-top: 1px solid #f4f3ef; line-height: 1.5; }
`;
