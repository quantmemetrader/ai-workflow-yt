"use client";

import { useState } from "react";
import type { ActualRow, BudgetCell, CentreRow, SpendRow, Thresholds } from "@/lib/finance/service";
import {
  addActualAction,
  archiveCentreAction,
  createCentreAction,
  decideSpendAction,
  markPaidAction,
  raiseSpendAction,
  removeActualAction,
  setBudgetLineAction,
  setThresholdsAction,
  generateReportAction,
  saveReportAction,
  shareReportAction,
} from "@/app/(app)/finance/actions";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import {
  Badge,
  Empty,
  Label,
  ModuleHeader,
  Row,
  chip,
  clip,
  field,
  ghost,
  money,
  solid,
  useAction,
  useAmount,
} from "@/components/ui/kit";
import { ModuleSidebar, type ScreenItem } from "@/components/shell/ModuleSidebar";
import { Reports } from "@/components/finance/Reports";
import type { ReportRow } from "@/lib/finance/reports";

/**
 * Finance (spec §4.9), transcribed from the five `Fin-*` artboards.
 *
 * Built on the client's own defaults rather than on a wait for their chart of
 * accounts: departments and projects are rows made here, periods are months,
 * and the thresholds that decide who signs a spend request start at
 * "under 500 goes through, 500 to 1,000 needs one approver, above that needs
 * two" and are edited on the Spend tab.
 *
 * The Cost tab is the one screen that needed no new data at all: `ai_usage`
 * has been the token ledger since the first week and nothing in Finance ever
 * looked at it.
 */
type Tab = "budget" | "cash" | "cost" | "spend" | "reports";

export function FinanceScreen({
  period,
  reports,
  centres,
  budget,
  actuals,
  spend,
  cash,
  thresholds,
  viewerId,
  locale,
  model,
}: {
  period: string;
  /** The monthly management reports, newest period first. */
  reports: ReportRow[];
  centres: CentreRow[];
  budget: { cells: BudgetCell[]; unfiledMicros: number; modelSpendMicros: number };
  actuals: ActualRow[];
  spend: SpendRow[];
  cash: { period: string; netMicros: number }[];
  thresholds: Thresholds;
  viewerId: string;
  locale: string;
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { busy, run } = useAction();
  /* Writing a report is a model call and takes a few seconds, so the button
     says so rather than looking dead. */
  const [generating, setGenerating] = useState(false);
  const agent = useInlineAgent({ module: "finance" });
  const [tab, setTab] = useState<Tab>("budget");

  const waiting = spend.filter((s) => s.state === "awaiting_approval");
  const budgeted = budget.cells.reduce((n, c) => n + c.budgetMicros, 0);
  const spent = budget.cells.reduce((n, c) => n + c.actualMicros, 0) + budget.unfiledMicros;

  /* The design draws these down a 212px column, the way every other
     desktop artboard in the set does — not across the top. */
  const SCREENS: ScreenItem<Tab>[] = [
    { key: "budget", label: "Budget", labelZh: "预算" },
    { key: "cash", label: "Cash", labelZh: "现金" },
    { key: "cost", label: "Cost", labelZh: "成本" },
    { key: "spend", label: "Spend requests", labelZh: "用款申请", badge: waiting.length },
    { key: "reports", label: "Report drafts", labelZh: "报告草稿", badge: reports.filter((r) => r.state === "draft").length },
  ];

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
    <ModuleSidebar
      title="Finance"
      titleZh="财务"
      screens={SCREENS}
      active={tab}
      onChange={setTab}
      zh={zh}
      storageKey="finance-sidebar"
    />
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ModuleHeader
        title={t("Finance", "财务")}
        note={t(`budget against actuals · ${period}`, `预算与实际对比 · ${period}`)}
      />

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
          {tab === "budget" && (
            <Budget
              period={period}
              centres={centres}
              cells={budget.cells}
              unfiled={budget.unfiledMicros}
              zh={zh}
              busy={busy}
              onSet={(centreId, amount) => run(() => setBudgetLineAction(centreId, period, amount))}
              onAddCentre={(kind, name, code) => run(() => createCentreAction(kind, name, code))}
              onArchive={(centreId) => run(() => archiveCentreAction(centreId))}
            />
          )}

          {tab === "cash" && (
            <Cash
              period={period}
              cash={cash}
              actuals={actuals}
              centres={centres}
              zh={zh}
              busy={busy}
              onAdd={(input) => run(() => addActualAction({ ...input, period }))}
              onRemove={(id) => run(() => removeActualAction(id))}
            />
          )}

          {tab === "cost" && (
            <Cost modelSpendMicros={budget.modelSpendMicros} budgeted={budgeted} spent={spent} zh={zh} />
          )}

          {tab === "spend" && (
            <Spend
              spend={spend}
              centres={centres}
              thresholds={thresholds}
              period={period}
              viewerId={viewerId}
              zh={zh}
              busy={busy}
              onRaise={(input) => run(() => raiseSpendAction(input))}
              onDecide={(id, decision, note) => run(() => decideSpendAction(id, decision, note))}
              onPaid={(id) => run(() => markPaidAction(id, period))}
              onThresholds={(a, b) => run(() => setThresholdsAction(a, b))}
            />
          )}

          {tab === "reports" && (
            <Reports
              reports={reports}
              period={period}
              zh={zh}
              busy={busy}
              generating={generating}
              onGenerate={(p) => {
                setGenerating(true);
                run(
                  () => generateReportAction(p),
                  () => setGenerating(false),
                );
              }}
              onSave={(id, body) => run(() => saveReportAction(id, body))}
              onShare={(id) => run(() => shareReportAction(id))}
            />
          )}
        </div>

        <ResearchAgentPanel
          accent="#007be0"
          zh={zh}
          scope={t("Finance", "财务")}
          note={t(
            `${money(budgeted)} budgeted, ${money(spent)} spent this period. ${waiting.length} spend request${waiting.length === 1 ? "" : "s"} waiting.`,
            `本期预算 ${money(budgeted)}，已花 ${money(spent)}。${waiting.length} 条用款申请待批。`,
          )}
          placeholder={t("Ask about these numbers…", "询问这些数字…")}
          model={model}
          onAsk={(prompt) => void agent.send(prompt)}
          thread={
            <InlineAgentThread
              messages={agent.messages}
              notice={agent.notice}
              conversationId={agent.conversationId}
              zh={zh}
            />
          }
        />
      </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- budget */

function Budget({
  period,
  centres,
  cells,
  unfiled,
  zh,
  busy,
  onSet,
  onAddCentre,
  onArchive,
}: {
  period: string;
  centres: CentreRow[];
  cells: BudgetCell[];
  unfiled: number;
  zh: boolean;
  busy: boolean;
  onSet: (centreId: string, amount: number) => void;
  onAddCentre: (kind: string, name: string, code: string) => void;
  onArchive: (centreId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [kind, setKind] = useState("department");
  const [name, setName] = useState("");

  if (!centres.length) {
    return (
      <>
        <Empty
          title={t("No departments or projects yet", "还没有部门或项目")}
          body={t(
            "A budget is a number against something. Add the departments and projects the studio actually runs, and the lines follow.",
            "预算总要对应某个对象。先添加工作室实际在跑的部门和项目，预算行随之出现。",
          )}
        />
        <AddCentre kind={kind} setKind={setKind} name={name} setName={setName} busy={busy} zh={zh} onAdd={onAddCentre} />
      </>
    );
  }

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 14px" }}>
        {t(
          `Budget and actuals for ${period}. Type over a budget to change it.`,
          `${period} 的预算与实际。直接修改预算数字即可。`,
        )}
      </p>

      <Row head>
        <span style={{ flexGrow: 1 }}>{t("Department or project", "部门 / 项目")}</span>
        <span style={{ width: 130, textAlign: "right" }}>{t("Budget", "预算")}</span>
        <span style={{ width: 110, textAlign: "right" }}>{t("Actual", "实际")}</span>
        <span style={{ width: 110, textAlign: "right" }}>{t("Left", "剩余")}</span>
        <span style={{ width: 60 }} />
      </Row>

      {cells.map((c) => {
        const left = c.budgetMicros - c.actualMicros;
        return (
          <Row key={c.centreId} style={{ alignItems: "center" }}>
            <span style={{ flexGrow: 1, ...clip }} title={c.centreName}>
              {c.centreName}
              <span style={{ color: "#c7c7c7", fontSize: 10.5, marginLeft: 7 }}>{c.kind}</span>
            </span>
            <span style={{ width: 130, textAlign: "right" }}>
              <input
                key={`${c.centreId}-${period}`}
                defaultValue={c.budgetMicros ? String(c.budgetMicros / 1_000_000) : ""}
                onBlur={(e) => {
                  const n = Number(e.target.value.replace(/[^\d.-]/g, ""));
                  if (!Number.isFinite(n)) return;
                  if (Math.round(n * 1_000_000) === c.budgetMicros) return;
                  onSet(c.centreId, n);
                }}
                placeholder="0"
                style={{ ...field, height: 28, width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              />
            </span>
            <span style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#7c7c7c" }}>
              {money(c.actualMicros)}
            </span>
            <span
              style={{
                width: 110,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
                color: left < 0 ? "#e03636" : "#278f5e",
              }}
            >
              {money(left)}
            </span>
            <span style={{ width: 60, textAlign: "right" }}>
              <button type="button" disabled={busy} onClick={() => onArchive(c.centreId)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                {t("hide", "隐藏")}
              </button>
            </span>
          </Row>
        );
      })}

      {unfiled !== 0 && (
        <p style={{ fontSize: 11.5, color: "#a35f00", margin: "10px 0 0" }}>
          {t(
            `${money(unfiled)} of spending is not filed under anything.`,
            `有 ${money(unfiled)} 的支出未归入任何部门或项目。`,
          )}
        </p>
      )}

      <Label>{t("Add a department or project", "添加部门或项目")}</Label>
      <AddCentre kind={kind} setKind={setKind} name={name} setName={setName} busy={busy} zh={zh} onAdd={onAddCentre} />
    </>
  );
}

function AddCentre({
  kind,
  setKind,
  name,
  setName,
  busy,
  zh,
  onAdd,
}: {
  kind: string;
  setKind: (k: string) => void;
  name: string;
  setName: (n: string) => void;
  busy: boolean;
  zh: boolean;
  onAdd: (kind: string, name: string, code: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
      <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...field, width: 140, height: 32 }}>
        <option value="department">{t("department", "部门")}</option>
        <option value="project">{t("project", "项目")}</option>
      </select>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("What is it called?", "名称")}
        style={{ ...field, width: 220, height: 32 }}
      />
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={() => {
          onAdd(kind, name.trim(), "");
          setName("");
        }}
        style={{ ...solid, opacity: busy || !name.trim() ? 0.45 : 1 }}
      >
        {t("Add", "关注")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ cash */

function Cash({
  period,
  cash,
  actuals,
  centres,
  zh,
  busy,
  onAdd,
  onRemove,
}: {
  period: string;
  cash: { period: string; netMicros: number }[];
  actuals: ActualRow[];
  centres: CentreRow[];
  zh: boolean;
  busy: boolean;
  onAdd: (input: { centreId: string | null; amount: number; description: string }) => void;
  onRemove: (id: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const amount = useAmount();
  const [description, setDescription] = useState("");
  const [centreId, setCentreId] = useState("");
  const peak = Math.max(1, ...cash.map((c) => Math.abs(c.netMicros)));

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 14px" }}>
        {t(
          "Money out is positive, money in is negative. One column, because what everybody asks for is the month's net.",
          "支出为正，收入为负。只用一列，因为大家真正关心的是当月净额。",
        )}
      </p>

      {cash.length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 70, marginBottom: 22 }}>
          {cash.map((c) => (
            <div key={c.period} style={{ flexGrow: 1, textAlign: "center" }} title={`${c.period} · ${money(c.netMicros)}`}>
              <div
                style={{
                  height: `${Math.max(3, Math.round((Math.abs(c.netMicros) / peak) * 56))}px`,
                  background: c.netMicros < 0 ? "#278f5e" : "#383838",
                  borderRadius: 2,
                }}
              />
              <span style={{ fontSize: 9, color: "#c7c7c7" }}>{c.period.slice(5)}</span>
            </div>
          ))}
        </div>
      )}

      <Label style={{ margin: "0 0 8px" }}>{t(`Entries for ${period}`, `${period} 的记录`)}</Label>

      {actuals.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#999999", margin: "0 0 14px" }}>
          {t("Nothing recorded for this period yet.", "本期还没有记录。")}
        </p>
      ) : (
        actuals.map((a) => (
          <Row key={a.id} style={{ alignItems: "center" }}>
            <span style={{ flexGrow: 1, ...clip }} title={a.description}>
              {a.description || t("(no description)", "（无说明）")}
              {a.source !== "manual" && (
                <span style={{ marginLeft: 7 }}>
                  <Badge tone="info">{a.source}</Badge>
                </span>
              )}
            </span>
            <span style={{ width: 150, color: "#7c7c7c" }}>{a.centreName ?? t("unfiled", "未归类")}</span>
            <span style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {money(a.amountMicros)}
            </span>
            <span style={{ width: 50, textAlign: "right" }}>
              {a.source === "manual" && (
                <button type="button" disabled={busy} onClick={() => onRemove(a.id)} style={{ ...ghost, height: 22, fontSize: 10.5 }}>
                  {t("remove", "删除")}
                </button>
              )}
            </span>
          </Row>
        ))
      )}

      <Label>{t("Record something", "新增记录")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("What was it for?", "用途")}
          style={{ ...field, width: 260, height: 32 }}
        />
        <select value={centreId} onChange={(e) => setCentreId(e.target.value)} style={{ ...field, width: 180, height: 32 }}>
          <option value="">{t("Not filed", "未归类")}</option>
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={amount.value}
          onChange={(e) => amount.set(e.target.value)}
          placeholder={t("Amount", "金额")}
          inputMode="decimal"
          style={{ ...field, width: 130, height: 32, textAlign: "right" }}
        />
        <button
          type="button"
          disabled={busy || !amount.valid}
          onClick={() => {
            onAdd({ centreId: centreId || null, amount: amount.number, description });
            amount.set("");
            setDescription("");
          }}
          style={{ ...solid, opacity: busy || !amount.valid ? 0.45 : 1 }}
        >
          {t("Record", "记录")}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ cost */

function Cost({
  modelSpendMicros,
  budgeted,
  spent,
  zh,
}: {
  modelSpendMicros: number;
  budgeted: number;
  spent: number;
  zh: boolean;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  return (
    <>
      <div style={{ display: "flex", gap: 34, flexWrap: "wrap", marginBottom: 20 }}>
        <Stat label={t("Budgeted this period", "本期预算")} value={money(budgeted)} />
        <Stat label={t("Spent this period", "本期支出")} value={money(spent)} />
        <Stat
          label={t("Of which models", "其中模型花费")}
          value={money(modelSpendMicros)}
          note={t("from the token ledger, not typed in", "来自 token 账本，非手工录入")}
        />
      </div>

      <p style={{ fontSize: 12, color: "#999999", lineHeight: 1.65, maxWidth: 560, margin: 0 }}>
        {t(
          "Model spend is recorded by the ledger as each call returns, so it is the one figure here nobody has to enter. Everything else on this tab is what somebody typed on the Cash tab, or what a paid spend request wrote.",
          "模型花费由账本在每次调用返回时记录，是这里唯一无需手工录入的数字。其余数据来自“现金”页的手工录入，或已付款的用款申请。",
        )}
      </p>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 500, color: "#999999" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginTop: 3 }}>{value}</div>
      {note && <div style={{ fontSize: 10.5, color: "#c7c7c7", marginTop: 2 }}>{note}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- spend */

function Spend({
  spend,
  centres,
  thresholds,
  period,
  viewerId,
  zh,
  busy,
  onRaise,
  onDecide,
  onPaid,
  onThresholds,
}: {
  spend: SpendRow[];
  centres: CentreRow[];
  thresholds: Thresholds;
  period: string;
  viewerId: string;
  zh: boolean;
  busy: boolean;
  onRaise: (input: { title: string; description: string; amount: number; centreId: string | null; neededBy: string | null }) => void;
  onDecide: (id: string, decision: string, note: string) => void;
  onPaid: (id: string) => void;
  onThresholds: (autoBelow: number, oneApproverBelow: number) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const amount = useAmount();
  const [title, setTitle] = useState("");
  const [centreId, setCentreId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [a, setA] = useState(String(thresholds.autoBelow));
  const [b, setB] = useState(String(thresholds.oneApproverBelow));

  return (
    <>
      <div
        style={{
          border: "1px solid #ededed",
          borderRadius: 11,
          padding: "12px 14px",
          marginBottom: 18,
          background: "#fcfcfc",
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>{t("Who has to sign", "谁需要审批")}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          <span>{t("Under", "低于")}</span>
          <input value={a} onChange={(e) => setA(e.target.value.replace(/[^\d.]/g, ""))} style={{ ...field, width: 90, height: 28, textAlign: "right" }} />
          <span>{t("goes through on its own. Under", "自动通过。低于")}</span>
          <input value={b} onChange={(e) => setB(e.target.value.replace(/[^\d.]/g, ""))} style={{ ...field, width: 90, height: 28, textAlign: "right" }} />
          <span>{t("needs one approver, above that two.", "需一位审批人，超过则需两位。")}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onThresholds(Number(a), Number(b))}
            style={{ ...ghost, marginLeft: "auto" }}
          >
            {t("Save", "保存")}
          </button>
        </div>
      </div>

      <Label style={{ margin: "0 0 8px" }}>{t("Raise a request", "提交申请")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("What is it for?", "用途")} style={{ ...field, width: 250, height: 32 }} />
        <select value={centreId} onChange={(e) => setCentreId(e.target.value)} style={{ ...field, width: 170, height: 32 }}>
          <option value="">{t("Not filed", "未归类")}</option>
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={amount.value}
          onChange={(e) => amount.set(e.target.value)}
          placeholder={t("Amount", "金额")}
          inputMode="decimal"
          style={{ ...field, width: 120, height: 32, textAlign: "right" }}
        />
        <button
          type="button"
          disabled={busy || !title.trim() || !amount.valid || amount.number <= 0}
          onClick={() => {
            onRaise({ title, description: "", amount: amount.number, centreId: centreId || null, neededBy: null });
            setTitle("");
            amount.set("");
          }}
          style={{ ...solid, opacity: busy || !title.trim() || !amount.valid ? 0.45 : 1 }}
        >
          {t("Raise", "提交")}
        </button>
        {amount.valid && amount.number > 0 && (
          <span style={{ fontSize: 11.5, color: "#999999" }}>
            {amount.number < thresholds.autoBelow
              ? t("goes through on its own", "将自动通过")
              : amount.number < thresholds.oneApproverBelow
                ? t("needs one approver", "需一位审批人")
                : t("needs two approvers", "需两位审批人")}
          </span>
        )}
      </div>

      {spend.length === 0 ? (
        <Empty title={t("No requests yet", "还没有申请")} />
      ) : (
        spend.map((s) => {
          const approvals = s.decisions.filter((d) => d.decision === "approve").length;
          const mine = s.requestedById === viewerId;
          return (
            <div key={s.id} style={{ border: "1px solid #ededed", borderRadius: 11, padding: 13, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.title}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{money(s.amountMicros)}</span>
                {s.centreName && <span style={{ fontSize: 11, color: "#999999" }}>{s.centreName}</span>}
                <Badge
                  tone={
                    s.state === "approved" || s.state === "paid"
                      ? "good"
                      : s.state === "rejected"
                        ? "bad"
                        : s.state === "awaiting_approval"
                          ? "warn"
                          : "quiet"
                  }
                >
                  {s.state.replace("_", " ")}
                </Badge>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#999999" }}>
                  {t("by", "提交人")} {s.requestedByName ?? "—"} · {approvals}/{s.approvalsNeeded}{" "}
                  {t("approvals", "人已批准")}
                </span>
              </div>

              {s.decisions.length > 0 && (
                <p style={{ fontSize: 11, color: "#7c7c7c", margin: "7px 0 0", lineHeight: 1.5 }}>
                  {s.decisions.map((d) => `${d.deciderName ?? "—"}: ${d.decision}${d.note ? ` (${d.note})` : ""}`).join(" · ")}
                </p>
              )}

              {s.state === "awaiting_approval" && !mine && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 11 }}>
                  <input
                    value={notes[s.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                    placeholder={t("A note, on the record", "备注，会记录在案")}
                    style={{ ...field, flexGrow: 1, height: 30 }}
                  />
                  <button type="button" disabled={busy} onClick={() => onDecide(s.id, "reject", notes[s.id] ?? "")} style={ghost}>
                    {t("Reject", "拒绝")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecide(s.id, "approve", notes[s.id] ?? "")} style={solid}>
                    {t("Approve", "批准")}
                  </button>
                </div>
              )}

              {s.state === "awaiting_approval" && mine && (
                <p style={{ fontSize: 11.5, color: "#999999", margin: "9px 0 0" }}>
                  {t("You raised this, so somebody else has to decide.", "这是你提交的，需由他人决定。")}
                </p>
              )}

              {s.state === "approved" && (
                <div style={{ marginTop: 11 }}>
                  <button type="button" disabled={busy} onClick={() => onPaid(s.id)} style={{ ...chip, cursor: "pointer" }}>
                    {t(`Mark paid, into ${period}`, `标记为已付，计入 ${period}`)}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
