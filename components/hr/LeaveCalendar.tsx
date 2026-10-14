"use client";

import * as React from "react";
import { PersonAvatar } from "@/components/ui/PersonAvatar";

type Row = { id: string; userId: string; personName: string | null; kind: string; startOn: string; endOn: string; days: number; reason: string | null; state: string };
type Person = { userId: string; name: string };

/**
 * Who is away, and when (13–15 Oct: "a calendar so the team can look at the dates directly — where each
 * employee is on leave", "make it really pretty and intuitive").
 *
 * Two views of the same leave: 团队 (one row per person, the month across, each leave a bar), and 月历 (the
 * month as a wall calendar, each leave a band in the person's colour). Above both: who is off today, how many
 * leave days fall this month, and how many requests are waiting. Approved leave is solid; requested leave is
 * a dashed outline until somebody decides. Press any leave for its details.
 */
const KIND: Record<string, [string, string]> = { annual: ["年假", "Annual"], sick: ["病假", "Sick"], unpaid: ["无薪假", "Unpaid"], other: ["其他", "Other"] };
const PALETTE = [
  ["#2f6fdb", "#e8f0fd"],
  ["#1f8a5b", "#e5f5ed"],
  ["#c2620c", "#fdf0e3"],
  ["#8a3fd1", "#f3eafc"],
  ["#c23a6a", "#fbe8ef"],
  ["#0f8b9b", "#e2f5f7"],
  ["#7a6a12", "#f7f3dc"],
  ["#4b5563", "#eef0f2"],
] as const;
const colorOf = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (s: string) => s.slice(0, 10);

/* Drawn in the browser only: "today" is the viewer's day, which the server cannot know. */
export function LeaveCalendar(props: { leave: Row[]; zh: boolean; people?: Person[] }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  return ready ? <Calendar {...props} /> : <div style={{ minHeight: 440, border: "1px solid #ebeae6", borderRadius: 16, background: "#fafaf8", marginBottom: 18 }} />;
}

function Calendar({ leave, zh, people = [] }: { leave: Row[]; zh: boolean; people?: Person[] }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const today = new Date();
  const todayIso = isoOf(today);
  const [ym, setYm] = React.useState({ y: today.getFullYear(), m: today.getMonth() });
  const [view, setView] = React.useState<"team" | "month">("team");
  const [picked, setPicked] = React.useState<Row | null>(null);
  React.useEffect(() => {
    try {
      const v = localStorage.getItem("aura:leave-view");
      if (v === "team" || v === "month") setView(v);
    } catch {
      /* not remembered */
    }
  }, []);
  const pickView = (v: "team" | "month") => {
    setView(v);
    try {
      localStorage.setItem("aura:leave-view", v);
    } catch {
      /* not remembered */
    }
  };

  const rows = leave.filter((l) => l.state === "approved" || l.state === "requested");
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const first = new Date(ym.y, ym.m, 1);
  const monthStart = isoOf(first);
  const monthEnd = isoOf(new Date(ym.y, ym.m, days));
  const inMonth = rows.filter((l) => day(l.startOn) <= monthEnd && day(l.endOn) >= monthStart);
  const offToday = rows.filter((l) => l.state === "approved" && day(l.startOn) <= todayIso && day(l.endOn) >= todayIso);
  const waiting = leave.filter((l) => l.state === "requested").length;
  const monthDays = inMonth.reduce((n, l) => {
    const a = day(l.startOn) < monthStart ? monthStart : day(l.startOn);
    const b = day(l.endOn) > monthEnd ? monthEnd : day(l.endOn);
    let c = 0;
    for (let d = new Date(a); isoOf(d) <= b; d.setDate(d.getDate() + 1)) if (d.getDay() % 6 !== 0) c++;
    return n + c;
  }, 0);
  const nameOf = (l: Row) => l.personName ?? people.find((p) => p.userId === l.userId)?.name ?? "?";
  const upcoming = rows.filter((l) => day(l.endOn) >= todayIso).sort((a, b) => day(a.startOn).localeCompare(day(b.startOn))).slice(0, 6);

  const monthLabel = zh ? `${ym.y} 年 ${ym.m + 1} 月` : first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const step = (n: number) => setYm(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const dayIso = (d: number) => `${ym.y}-${pad(ym.m + 1)}-${pad(d)}`;
  const weekday = (d: number) => new Date(ym.y, ym.m, d).getDay();
  const WD = zh ? ["日", "一", "二", "三", "四", "五", "六"] : ["S", "M", "T", "W", "T", "F", "S"];

  /* The team view's rows: everybody on file, then anyone with leave who is not. */
  const team: Person[] = [...people];
  for (const l of inMonth) if (!team.some((p) => p.userId === l.userId)) team.push({ userId: l.userId, name: nameOf(l) });
  team.sort((a, b) => Number(inMonth.some((l) => l.userId === b.userId)) - Number(inMonth.some((l) => l.userId === a.userId)) || a.name.localeCompare(b.name));

  return (
    <div className="lc">
      <style>{CSS}</style>
      <div className="lc-stats">
        <div className="lc-stat">
          <div className="lc-stat-k">{t("今天休假", "Off today")}</div>
          <div className="lc-stat-v">
            {offToday.length ? (
              <span className="lc-faces">
                {offToday.slice(0, 5).map((l) => (
                  <span key={l.id} title={nameOf(l)}>
                    <PersonAvatar id={l.userId} url={null} name={nameOf(l)} size={24} radius={12} />
                  </span>
                ))}
                <b>{offToday.length}</b>
                <i>{offToday.map(nameOf).slice(0, 3).join("、")}</i>
              </span>
            ) : (
              <span className="lc-all-in">{t("全员在岗", "Everyone is in")}</span>
            )}
          </div>
        </div>
        <div className="lc-stat">
          <div className="lc-stat-k">{t(`${ym.m + 1} 月请假`, "Leave this month")}</div>
          <div className="lc-stat-v"><b>{monthDays}</b> <i>{t(`个工作日 · ${new Set(inMonth.map((l) => l.userId)).size} 人`, `working days · ${new Set(inMonth.map((l) => l.userId)).size} people`)}</i></div>
        </div>
        <div className="lc-stat">
          <div className="lc-stat-k">{t("待审批", "Waiting")}</div>
          <div className="lc-stat-v"><b className={waiting ? "warn" : ""}>{waiting}</b> <i>{waiting ? t("个申请等你决定", "to decide") : t("没有待办", "nothing waiting")}</i></div>
        </div>
      </div>

      <div className="lc-bar">
        <div className="lc-nav">
          <button type="button" onClick={() => step(-1)} aria-label={t("上个月", "Previous month")}>
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="lc-title">{monthLabel}</div>
          <button type="button" onClick={() => step(1)} aria-label={t("下个月", "Next month")}>
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" className="lc-today" onClick={() => setYm({ y: today.getFullYear(), m: today.getMonth() })}>{t("今天", "Today")}</button>
        </div>
        <div className="lc-legend">
          <span><i className="sw ok" />{t("已批准", "Approved")}</span>
          <span><i className="sw ask" />{t("待审批", "Requested")}</span>
        </div>
        <div className="lc-seg" role="tablist">
          <button type="button" role="tab" aria-selected={view === "team"} className={view === "team" ? "on" : ""} onClick={() => pickView("team")}>{t("团队", "Team")}</button>
          <button type="button" role="tab" aria-selected={view === "month"} className={view === "month" ? "on" : ""} onClick={() => pickView("month")}>{t("月历", "Month")}</button>
        </div>
      </div>

      {view === "team" ? (
        <div className="lc-tl-wrap">
          <div className="lc-tl" style={{ gridTemplateColumns: `minmax(120px, 160px) repeat(${days}, minmax(22px, 1fr))` }}>
            <div className="lc-tl-corner">{t("同事", "Person")}</div>
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1;
              const we = weekday(d) % 6 === 0;
              return (
                <div key={d} className={`lc-tl-day${we ? " we" : ""}${dayIso(d) === todayIso ? " now" : ""}`}>
                  <span>{WD[weekday(d)]}</span>
                  <b>{d}</b>
                </div>
              );
            })}
            {team.length === 0 ? <div className="lc-tl-empty" style={{ gridColumn: `1 / span ${days + 1}` }}>{t("这个月没有人请假。", "Nobody is off this month.")}</div> : null}
            {team.map((p, r) => {
              const mine = inMonth.filter((l) => l.userId === p.userId);
              const [ink, soft] = colorOf(p.userId);
              return (
                <React.Fragment key={p.userId}>
                  <div className="lc-tl-name" style={{ gridRow: r + 2 }}>
                    <PersonAvatar id={p.userId} url={null} name={p.name} size={22} radius={11} />
                    <span>{p.name}</span>
                  </div>
                  {Array.from({ length: days }, (_, i) => (
                    <div key={i} className={`lc-tl-cell${weekday(i + 1) % 6 === 0 ? " we" : ""}${dayIso(i + 1) === todayIso ? " now" : ""}`} style={{ gridRow: r + 2, gridColumn: i + 2 }} />
                  ))}
                  {mine.map((l) => {
                    const a = Math.max(1, day(l.startOn) < monthStart ? 1 : Number(day(l.startOn).slice(8)));
                    const b = Math.min(days, day(l.endOn) > monthEnd ? days : Number(day(l.endOn).slice(8)));
                    const k = KIND[l.kind] ?? [l.kind, l.kind];
                    return (
                      <button
                        key={l.id}
                        type="button"
                        className={`lc-tl-bar ${l.state === "approved" ? "ok" : "ask"}${day(l.startOn) < monthStart ? " cut-l" : ""}${day(l.endOn) > monthEnd ? " cut-r" : ""}`}
                        style={{ gridRow: r + 2, gridColumn: `${a + 1} / ${b + 2}`, ["--ink" as string]: ink, ["--soft" as string]: soft }}
                        onClick={() => setPicked(l)}
                        title={`${p.name} · ${zh ? k[0] : k[1]} · ${day(l.startOn)} → ${day(l.endOn)}`}
                      >
                        <span>{zh ? k[0] : k[1]}{b - a >= 2 ? ` · ${l.days} ${t("天", "d")}` : ""}</span>
                      </button>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="lc-grid">
          {(zh ? ["一", "二", "三", "四", "五", "六", "日"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]).map((w) => (
            <div key={w} className="lc-wd">{w}</div>
          ))}
          {Array.from({ length: (first.getDay() + 6) % 7 }, (_, i) => <div key={`p${i}`} className="lc-cell pad" />)}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const iso = dayIso(d);
            const who = rows.filter((l) => day(l.startOn) <= iso && day(l.endOn) >= iso);
            const col = (weekday(d) + 6) % 7;
            return (
              <div key={iso} className={`lc-cell${weekday(d) % 6 === 0 ? " we" : ""}${iso === todayIso ? " now" : ""}`}>
                <div className="lc-d">{d}</div>
                {who.slice(0, 3).map((l) => {
                  const [ink, soft] = colorOf(l.userId);
                  const start = day(l.startOn) === iso || col === 0 || d === 1;
                  const end = day(l.endOn) === iso || col === 6 || d === days;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className={`lc-band ${l.state === "approved" ? "ok" : "ask"}${start ? " s" : ""}${end ? " e" : ""}`}
                      style={{ ["--ink" as string]: ink, ["--soft" as string]: soft }}
                      onClick={() => setPicked(l)}
                      title={`${nameOf(l)} · ${day(l.startOn)} → ${day(l.endOn)}`}
                    >
                      {start ? nameOf(l) : " "}
                    </button>
                  );
                })}
                {who.length > 3 ? <div className="lc-more">+{who.length - 3}</div> : null}
              </div>
            );
          })}
        </div>
      )}

      {upcoming.length ? (
        <div className="lc-up">
          <div className="lc-up-h">{t("接下来", "Coming up")}</div>
          <div className="lc-up-list">
            {upcoming.map((l) => {
              const [ink, soft] = colorOf(l.userId);
              const k = KIND[l.kind] ?? [l.kind, l.kind];
              const now = day(l.startOn) <= todayIso;
              return (
                <button key={l.id} type="button" className="lc-up-row" onClick={() => setPicked(l)} style={{ ["--ink" as string]: ink, ["--soft" as string]: soft }}>
                  <PersonAvatar id={l.userId} url={null} name={nameOf(l)} size={24} radius={12} />
                  <span className="lc-up-n">{nameOf(l)}</span>
                  <span className="lc-up-k">{zh ? k[0] : k[1]}</span>
                  <span className="lc-up-d">{day(l.startOn).slice(5).replace("-", "/")}{day(l.endOn) !== day(l.startOn) ? ` – ${day(l.endOn).slice(5).replace("-", "/")}` : ""} · {l.days} {t("天", "d")}</span>
                  <span className={`lc-up-s ${l.state === "approved" ? (now ? "now" : "ok") : "ask"}`}>{l.state === "approved" ? (now ? t("休假中", "Away now") : t("已批准", "Approved")) : t("待审批", "Requested")}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {picked ? (
        <div className="lc-pop-veil" onClick={() => setPicked(null)}>
          <div className="lc-pop" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="lc-pop-h" style={{ ["--ink" as string]: colorOf(picked.userId)[0] }}>
              <PersonAvatar id={picked.userId} url={null} name={nameOf(picked)} size={36} radius={18} />
              <div>
                <div className="lc-pop-n">{nameOf(picked)}</div>
                <div className="lc-pop-k">{(KIND[picked.kind] ?? [picked.kind, picked.kind])[zh ? 0 : 1]} · {picked.days} {t("天", "days")}</div>
              </div>
              <button type="button" onClick={() => setPicked(null)} aria-label={t("关闭", "Close")}>×</button>
            </div>
            <div className="lc-pop-row"><span>{t("日期", "Dates")}</span><b>{day(picked.startOn)}{day(picked.endOn) !== day(picked.startOn) ? ` → ${day(picked.endOn)}` : ""}</b></div>
            <div className="lc-pop-row"><span>{t("状态", "Status")}</span><b className={picked.state === "approved" ? "ok" : "ask"}>{picked.state === "approved" ? t("已批准", "Approved") : t("待审批（在下面的列表里批准或拒绝）", "Requested (decide in the list below)")}</b></div>
            {picked.reason ? <div className="lc-pop-row"><span>{t("事由", "Reason")}</span><b>{picked.reason}</b></div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const CSS = `
.lc { border: 1px solid #ebeae6; border-radius: 16px; background: #fff; padding: 16px; margin-bottom: 18px; box-shadow: 0 1px 2px rgba(0,0,0,.03); }
.lc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.lc-stat { border: 1px solid #f0efeb; border-radius: 12px; padding: 10px 12px; background: linear-gradient(180deg, #fff, #fafaf8); min-width: 0; }
.lc-stat-k { font-size: 11.5px; color: #8a8a8a; margin-bottom: 4px; }
.lc-stat-v { display: flex; align-items: center; gap: 6px; min-height: 26px; font-size: 12px; color: #6b6b6b; min-width: 0; }
.lc-stat-v b { font-size: 20px; font-weight: 650; color: #171717; font-variant-numeric: tabular-nums; }
.lc-stat-v b.warn { color: #b26a00; }
.lc-stat-v i { font-style: normal; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-faces { display: inline-flex; align-items: center; gap: 0; min-width: 0; }
.lc-faces > span { margin-right: -6px; border: 2px solid #fff; border-radius: 50%; display: inline-flex; }
.lc-faces b { margin-left: 12px; font-size: 16px !important; }
.lc-faces i { margin-left: 6px; }
.lc-all-in { font-size: 13px; color: #1f8a5b; font-weight: 600; }
.lc-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.lc-nav { display: flex; align-items: center; gap: 6px; }
.lc-nav > button { height: 30px; min-width: 30px; border: 1px solid #e3e2dd; background: #fff; border-radius: 8px; font: inherit; font-size: 12.5px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: #3d3d3d; }
.lc-nav > button:hover { border-color: #171717; }
.lc-today { padding: 0 12px; }
.lc-title { font-size: 15px; font-weight: 650; color: #171717; min-width: 108px; text-align: center; }
.lc-legend { display: flex; gap: 12px; font-size: 12px; color: #6b6b6b; margin-left: auto; }
.lc-legend span { display: inline-flex; align-items: center; gap: 5px; }
.lc-legend .sw { width: 14px; height: 10px; border-radius: 3px; display: inline-block; }
.lc-legend .sw.ok { background: #6b7280; }
.lc-legend .sw.ask { border: 1.5px dashed #6b7280; background: #fff; }
.lc-seg { display: inline-flex; background: #f2f1ed; border-radius: 9px; padding: 3px; }
.lc-seg button { border: 0; background: transparent; height: 26px; padding: 0 14px; border-radius: 7px; font: inherit; font-size: 12.5px; color: #6b6b6b; cursor: pointer; }
.lc-seg button.on { background: #fff; color: #171717; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.lc-tl-wrap { overflow-x: auto; border: 1px solid #f0efeb; border-radius: 12px; }
.lc-tl { display: grid; min-width: 760px; grid-auto-rows: 38px; position: relative; }
.lc-tl-corner { grid-row: 1; grid-column: 1; position: sticky; left: 0; z-index: 3; background: #fafaf8; font-size: 11.5px; color: #8a8a8a; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #f0efeb; height: 44px; }
.lc-tl-day { grid-row: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 10.5px; color: #a3a3a3; border-bottom: 1px solid #f0efeb; background: #fafaf8; height: 44px; }
.lc-tl-day b { font-size: 12px; color: #525252; font-weight: 600; }
.lc-tl-day.we { color: #c4c3be; } .lc-tl-day.we b { color: #a3a3a3; }
.lc-tl-day.now b { background: #171717; color: #fff; border-radius: 999px; padding: 0 6px; }
.lc-tl-name { grid-column: 1; position: sticky; left: 0; z-index: 2; background: #fff; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-size: 12.5px; color: #262626; border-bottom: 1px solid #f6f5f2; min-width: 0; }
.lc-tl-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-tl-cell { border-bottom: 1px solid #f6f5f2; border-left: 1px solid #f6f5f2; }
.lc-tl-cell.we { background: #fbfbf9; }
.lc-tl-cell.now { background: #f4f7ff; box-shadow: inset 1px 0 0 #c9d6f6, inset -1px 0 0 #c9d6f6; }
.lc-tl-bar { position: relative; z-index: 1; align-self: center; height: 24px; margin: 0 2px; border-radius: 7px; border: 0; padding: 0 8px; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; overflow: hidden; white-space: nowrap; transition: transform .12s, box-shadow .12s; }
.lc-tl-bar span { overflow: hidden; text-overflow: ellipsis; }
.lc-tl-bar.ok { background: var(--ink); color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.lc-tl-bar.ask { background: var(--soft); color: var(--ink); border: 1.5px dashed var(--ink); }
.lc-tl-bar:hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0,0,0,.14); }
.lc-tl-bar.cut-l { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: 0; }
.lc-tl-bar.cut-r { border-top-right-radius: 0; border-bottom-right-radius: 0; margin-right: 0; }
.lc-tl-empty { grid-row: 2; display: flex; align-items: center; justify-content: center; color: #a3a3a3; font-size: 12.5px; height: 64px; }
.lc-grid { display: grid; grid-template-columns: repeat(7, 1fr); border: 1px solid #f0efeb; border-radius: 12px; overflow: hidden; }
.lc-wd { font-size: 11.5px; color: #8a8a8a; text-align: center; padding: 8px 0; background: #fafaf8; border-bottom: 1px solid #f0efeb; }
.lc-cell { min-height: 92px; border-right: 1px solid #f4f3ef; border-bottom: 1px solid #f4f3ef; padding: 5px 0 6px; display: flex; flex-direction: column; gap: 3px; }
.lc-cell:nth-child(7n) { border-right: 0; }
.lc-cell.pad { background: #fcfcfb; }
.lc-cell.we { background: #fbfbf9; }
.lc-d { font-size: 12px; color: #525252; padding: 0 8px; font-variant-numeric: tabular-nums; }
.lc-cell.now .lc-d { align-self: flex-start; margin-left: 5px; padding: 0 7px; background: #171717; color: #fff; border-radius: 999px; font-weight: 700; }
.lc-band { height: 20px; border: 0; font: inherit; font-size: 11px; font-weight: 600; text-align: left; padding: 0 7px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0; }
.lc-band.ok { background: var(--ink); color: #fff; }
.lc-band.ask { background: var(--soft); color: var(--ink); border-top: 1.5px dashed var(--ink); border-bottom: 1.5px dashed var(--ink); }
.lc-band.s { margin-left: 5px; border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.lc-band.ask.s { border-left: 1.5px dashed var(--ink); }
.lc-band.e { margin-right: 5px; border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
.lc-band.ask.e { border-right: 1.5px dashed var(--ink); }
.lc-band:hover { filter: brightness(1.06); }
.lc-more { font-size: 11px; color: #8a8a8a; padding: 0 8px; }
.lc-up { margin-top: 14px; }
.lc-up-h { font-size: 12px; font-weight: 600; color: #525252; margin-bottom: 6px; }
.lc-up-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 6px; }
.lc-up-row { display: flex; align-items: center; gap: 8px; border: 1px solid #f0efeb; border-left: 3px solid var(--ink); border-radius: 10px; background: #fff; padding: 7px 10px; font: inherit; font-size: 12.5px; cursor: pointer; text-align: left; min-width: 0; }
.lc-up-row:hover { border-color: #dcdbd6; border-left-color: var(--ink); }
.lc-up-n { font-weight: 600; color: #171717; white-space: nowrap; }
.lc-up-k { color: var(--ink); font-size: 11.5px; }
.lc-up-d { color: #6b6b6b; font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.lc-up-s { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.lc-up-s.ok { background: #e8f3ec; color: #1f6b43; }
.lc-up-s.now { background: #171717; color: #fff; }
.lc-up-s.ask { background: #fff4df; color: #8a5a00; }
.lc-pop-veil { position: fixed; inset: 0; z-index: 950; background: rgba(17,17,17,.18); display: flex; align-items: center; justify-content: center; padding: 16px; animation: lc-fade .12s ease-out; }
@keyframes lc-fade { from { opacity: 0; } to { opacity: 1; } }
.lc-pop { width: 340px; max-width: 100%; background: #fff; border-radius: 16px; box-shadow: 0 24px 60px -18px rgba(17,17,17,.35); overflow: hidden; }
.lc-pop-h { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-top: 4px solid var(--ink); border-bottom: 1px solid #f0efeb; }
.lc-pop-h > div { flex: 1; min-width: 0; }
.lc-pop-h button { border: 0; background: transparent; font-size: 20px; color: #8a8a8a; cursor: pointer; }
.lc-pop-n { font-size: 15px; font-weight: 650; color: #171717; }
.lc-pop-k { font-size: 12px; color: #6b6b6b; margin-top: 1px; }
.lc-pop-row { display: flex; gap: 12px; padding: 9px 16px; font-size: 12.5px; border-bottom: 1px solid #f6f5f2; }
.lc-pop-row:last-child { border-bottom: 0; }
.lc-pop-row span { color: #8a8a8a; width: 40px; flex-shrink: 0; }
.lc-pop-row b { font-weight: 500; color: #262626; }
.lc-pop-row b.ok { color: #1f6b43; } .lc-pop-row b.ask { color: #8a5a00; }
@media (max-width: 760px) {
  .lc { padding: 12px; border-radius: 14px; }
  .lc-stats { grid-template-columns: 1fr; }
  .lc-legend { margin-left: 0; order: 3; }
  .lc-cell { min-height: 64px; }
  .lc-band { font-size: 10px; padding: 0 4px; }
}
`;
