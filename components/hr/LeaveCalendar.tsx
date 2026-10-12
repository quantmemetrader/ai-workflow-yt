"use client";

import * as React from "react";

type Row = { id: string; personName: string | null; kind: string; startOn: string; endOn: string; state: string };

/**
 * Who is away when, as a month on the wall (13 Oct: "a calendar so the team
 * can see the dates directly"). Approved leave is solid, requested leave is
 * outlined; a day with more people than fit says "+N".
 */
export function LeaveCalendar({ leave, zh }: { leave: Row[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const today = new Date();
  const [ym, setYm] = React.useState({ y: today.getFullYear(), m: today.getMonth() });
  const first = new Date(ym.y, ym.m, 1);
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday first
  const iso = (d: number) => `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const rows = leave.filter((l) => l.state === "approved" || l.state === "requested");
  const on = (d: string) => rows.filter((l) => l.startOn.slice(0, 10) <= d && l.endOn.slice(0, 10) >= d);
  const KIND: Record<string, [string, string]> = { annual: ["年假", "Annual"], sick: ["病假", "Sick"], unpaid: ["无薪假", "Unpaid"], other: ["其他", "Other"] };
  const monthLabel = zh ? `${ym.y} 年 ${ym.m + 1} 月` : first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const weekdays = zh ? ["一", "二", "三", "四", "五", "六", "日"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="lc">
      <style>{CSS}</style>
      <div className="lc-head">
        <button type="button" onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} aria-label={t("上个月", "Previous month")}>‹</button>
        <div className="lc-title">{monthLabel}</div>
        <button type="button" onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} aria-label={t("下个月", "Next month")}>›</button>
        <button type="button" className="lc-today" onClick={() => setYm({ y: today.getFullYear(), m: today.getMonth() })}>{t("今天", "Today")}</button>
        <span className="lc-legend"><i className="lc-ok" /> {t("已批准", "Approved")} <i className="lc-ask" /> {t("待审批", "Requested")}</span>
      </div>
      <div className="lc-grid">
        {weekdays.map((w) => <div key={w} className="lc-wd">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} className="lc-cell lc-pad" />)}
        {Array.from({ length: days }, (_, i) => {
          const d = iso(i + 1);
          const who = on(d);
          const weekend = (lead + i) % 7 >= 5;
          return (
            <div key={d} className={`lc-cell${weekend ? " lc-we" : ""}${d === todayIso ? " lc-now" : ""}`}>
              <div className="lc-d">{i + 1}</div>
              {who.slice(0, 3).map((l) => (
                <div key={l.id} className={`lc-chip ${l.state === "approved" ? "lc-ok" : "lc-ask"}`} title={`${l.personName ?? ""} · ${(KIND[l.kind] ?? [l.kind, l.kind])[zh ? 0 : 1]} · ${l.startOn.slice(0, 10)} → ${l.endOn.slice(0, 10)}`}>
                  {l.personName ?? "?"}
                </div>
              ))}
              {who.length > 3 ? <div className="lc-more">+{who.length - 3}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CSS = `
.lc { border: 1px solid #ebeae6; border-radius: 12px; background: #fff; padding: 12px 14px; margin-bottom: 16px; }
.lc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.lc-head > button { height: 28px; min-width: 28px; border: 1px solid #dcdbd6; background: #fff; border-radius: 7px; font: inherit; cursor: pointer; }
.lc-title { font-size: 14px; font-weight: 600; color: #171717; min-width: 120px; text-align: center; }
.lc-today { padding: 0 10px; font-size: 12.5px; }
.lc-legend { margin-left: auto; font-size: 12px; color: #6b6b6b; display: inline-flex; align-items: center; gap: 6px; }
.lc-legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
.lc-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.lc-wd { font-size: 11.5px; color: #8a8a8a; text-align: center; padding: 2px 0 4px; }
.lc-cell { min-height: 72px; border: 1px solid #f0efeb; border-radius: 8px; padding: 4px 5px; display: flex; flex-direction: column; gap: 2px; }
.lc-pad { border: 0; }
.lc-we { background: #fafaf8; }
.lc-now { border-color: #171717; }
.lc-d { font-size: 12px; color: #525252; margin-bottom: 2px; }
.lc-now .lc-d { font-weight: 700; color: #171717; }
.lc-chip { font-size: 11px; line-height: 1.5; padding: 0 5px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lc-chip.lc-ok, .lc-legend .lc-ok { background: #e3f2e7; color: #1f5a37; }
.lc-chip.lc-ask, .lc-legend .lc-ask { background: #fff; color: #7a4d06; border: 1px dashed #d9b36a; }
.lc-more { font-size: 11px; color: #8a8a8a; }
@media (max-width: 720px) { .lc-cell { min-height: 56px; } .lc-chip { font-size: 10px; } }
`;
