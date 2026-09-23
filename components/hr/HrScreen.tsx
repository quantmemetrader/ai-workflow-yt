"use client";

import { useState } from "react";
import type { BalanceRow, CandidateRow, EmployeeRow, LeaveRow, RequisitionRow } from "@/lib/hr/service";
import {
  addCandidateAction,
  addTaskAction,
  cancelLeaveAction,
  decideLeaveAction,
  deleteCandidateAction,
  openRequisitionAction,
  requestLeaveAction,
  saveEmployeeAction,
  seedBalancesAction,
  setEntitlementAction,
  setRequisitionStateAction,
  setStageAction,
  setTaskDoneAction,
} from "@/app/(app)/hr/actions";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Empty, Label, ModuleHeader, Row, clip, field, ghost, solid, useAction } from "@/components/ui/kit";
import { ModuleSidebar, type ScreenItem } from "@/components/shell/ModuleSidebar";

/**
 * Human Resources (spec §4.11), transcribed from the five `Hr-*` artboards.
 *
 * Manual, at the client's own direction. Leave starts at Hong Kong statutory
 * entitlement with one approver, both edited here, and candidates are entered
 * by hand.
 *
 * Two rules are on the screen because they are in the contract, not because
 * they look responsible: **no external sourcing** (Schedule A3(8)) is stated
 * where somebody would otherwise look for an import button, and a candidate's
 * consent and retention date are fields on the form rather than a policy in a
 * document.
 */
type Tab = "leave" | "roles" | "candidates" | "people";

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"] as const;

export function HrScreen({
  year,
  leave,
  balances,
  requisitions,
  candidates,
  overdue,
  employees,
  canManage,
  viewerId,
  locale,
  model,
}: {
  year: number;
  leave: LeaveRow[];
  balances: BalanceRow[];
  requisitions: RequisitionRow[];
  candidates: CandidateRow[];
  overdue: CandidateRow[];
  employees: EmployeeRow[];
  canManage: boolean;
  viewerId: string;
  locale: string;
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { busy, run } = useAction();
  const agent = useInlineAgent({ module: "hr" });
  const [tab, setTab] = useState<Tab>("leave");
  const [deleting, setDeleting] = useState<CandidateRow | null>(null);

  const waiting = leave.filter((l) => l.state === "requested");

  /* The design draws these down a 212px column, the way every other
     desktop artboard in the set does — not across the top. */
  const SCREENS: ScreenItem<Tab>[] = [
    { key: "leave", label: "Leave", labelZh: "假期", badge: waiting.length },
    { key: "roles", label: "Roles", labelZh: "岗位", badge: requisitions.filter((r) => r.state === "open").length },
    { key: "candidates", label: "Candidates", labelZh: "候选人", badge: candidates.length },
    { key: "people", label: "Employees", labelZh: "员工" },
  ];

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
    <ModuleSidebar
      title="People & HR"
      titleZh="人事"
      screens={SCREENS}
      active={tab}
      onChange={setTab}
      zh={zh}
      storageKey="hr-sidebar"
    />
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ModuleHeader
        title={t("Human Resources", "人事")}
        note={t("leave, hiring and employee records", "请假、招聘与员工档案")}
      />

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
          {tab === "leave" && (
            <Leave
              year={year}
              leave={leave}
              balances={balances}
              canManage={canManage}
              viewerId={viewerId}
              zh={zh}
              busy={busy}
              onRequest={(input) => run(() => requestLeaveAction(input))}
              onDecide={(id, decision, note) => run(() => decideLeaveAction(id, decision, note))}
              onCancel={(id) => run(() => cancelLeaveAction(id))}
              onSeed={() => run(() => seedBalancesAction(year))}
              onEntitlement={(id, days) => run(() => setEntitlementAction(id, days))}
            />
          )}

          {tab === "roles" && (
            <Roles
              requisitions={requisitions}
              canManage={canManage}
              zh={zh}
              busy={busy}
              onOpen={(input) => run(() => openRequisitionAction(input))}
              onState={(id, state) => run(() => setRequisitionStateAction(id, state))}
            />
          )}

          {tab === "candidates" && canManage && (
            <Candidates
              candidates={candidates}
              overdue={overdue}
              requisitions={requisitions}
              zh={zh}
              busy={busy}
              onAdd={(input) => run(() => addCandidateAction(input))}
              onStage={(id, stage) => run(() => setStageAction(id, stage))}
              onDelete={(c) => setDeleting(c)}
            />
          )}

          {tab === "people" && (
            <People
              employees={employees}
              canManage={canManage}
              zh={zh}
              busy={busy}
              onSave={(userId, input) => run(() => saveEmployeeAction(userId, input))}
              onAddTask={(userId, label) => run(() => addTaskAction(userId, label, ""))}
              onTick={(taskId, done) => run(() => setTaskDoneAction(taskId, done))}
            />
          )}
        </div>

        <ResearchAgentPanel
          accent="#007be0"
          zh={zh}
          scope={t("HR", "人事")}
          note={t(
            `${waiting.length} leave request${waiting.length === 1 ? "" : "s"} waiting. ${requisitions.filter((r) => r.state === "open").length} role${requisitions.filter((r) => r.state === "open").length === 1 ? "" : "s"} open.`,
            `${waiting.length} 条请假待批，${requisitions.filter((r) => r.state === "open").length} 个岗位在招。`,
          )}
          placeholder={t("Ask about leave or hiring…", "询问请假或招聘…")}
          footnote={t("No external sourcing. Schedule A3(8).", "不做任何外部招聘寻访。附表 A3(8)。")}
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

      {deleting && (
        <ConfirmDialog
          danger
          title={t(`Delete ${deleting.name}?`, `删除 ${deleting.name}？`)}
          body={t(
            "The record and its applications are removed for good. This is what the retention date is for.",
            "该候选人档案及其申请将被永久删除。保留期限正是为此而设。",
          )}
          confirm={t("Delete", "删除")}
          cancel={t("Cancel", "取消")}
          onClose={() => setDeleting(null)}
          onConfirm={() => run(() => deleteCandidateAction(deleting.id))}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- leave */

function Leave({
  year,
  leave,
  balances,
  canManage,
  viewerId,
  zh,
  busy,
  onRequest,
  onDecide,
  onCancel,
  onSeed,
  onEntitlement,
}: {
  year: number;
  leave: LeaveRow[];
  balances: BalanceRow[];
  canManage: boolean;
  viewerId: string;
  zh: boolean;
  busy: boolean;
  onRequest: (input: { kind: string; startOn: string; endOn: string; days: number; reason: string }) => void;
  onDecide: (id: string, decision: string, note: string) => void;
  onCancel: (id: string) => void;
  onSeed: () => void;
  onEntitlement: (id: string, days: number) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [form, setForm] = useState({ kind: "annual", startOn: "", endOn: "", days: "1", reason: "" });

  return (
    <>
      <Label style={{ margin: "0 0 8px" }}>{t("Ask for leave", "请假申请")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={{ ...field, width: 140, height: 32 }}>
          <option value="annual">{t("annual", "年假")}</option>
          <option value="sick">{t("sick", "病假")}</option>
          <option value="unpaid">{t("unpaid", "无薪假")}</option>
          <option value="other">{t("other", "其他")}</option>
        </select>
        <input type="date" value={form.startOn} onChange={(e) => setForm({ ...form, startOn: e.target.value })} style={{ ...field, width: 150, height: 32 }} />
        <input type="date" value={form.endOn} onChange={(e) => setForm({ ...form, endOn: e.target.value })} style={{ ...field, width: 150, height: 32 }} />
        <input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value.replace(/[^\d.]/g, "") })} placeholder={t("Days", "天数")} style={{ ...field, width: 90, height: 32, textAlign: "right" }} />
        <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t("Reason, if you want to give one", "原因（可选）")} style={{ ...field, width: 240, height: 32 }} />
        <button
          type="button"
          disabled={busy || !form.startOn || !form.endOn || !Number(form.days)}
          onClick={() => {
            onRequest({ ...form, days: Number(form.days) });
            setForm({ kind: "annual", startOn: "", endOn: "", days: "1", reason: "" });
          }}
          style={{ ...solid, opacity: busy || !form.startOn ? 0.45 : 1 }}
        >
          {t("Request", "提交")}
        </button>
      </div>

      {leave.length === 0 ? (
        <Empty title={t("No leave requested yet", "还没有请假记录")} />
      ) : (
        <>
          <Row head>
            {canManage && <span style={{ width: 140 }}>{t("Who", "成员")}</span>}
            <span style={{ width: 90 }}>{t("Kind", "类型")}</span>
            <span style={{ width: 200 }}>{t("Dates", "日期")}</span>
            <span style={{ width: 60, textAlign: "right" }}>{t("Days", "天数")}</span>
            <span style={{ flexGrow: 1 }}>{t("Reason", "原因")}</span>
            <span style={{ width: 200 }} />
          </Row>
          {leave.map((l) => (
            <Row key={l.id} style={{ alignItems: "center" }}>
              {canManage && <span style={{ width: 140, minWidth: 0 }}>{l.personName ?? "—"}</span>}
              <span style={{ width: 90, color: "#7c7c7c" }}>{l.kind}</span>
              <span style={{ width: 200, color: "#7c7c7c", fontSize: 11.5 }}>
                {l.startOn} → {l.endOn}
              </span>
              <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.days}</span>
              <span style={{ flexGrow: 1, minWidth: 0, color: "#7c7c7c", fontSize: 11.5 }}>{l.reason ?? ""}</span>
              <span style={{ width: 200, display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                <Badge
                  tone={l.state === "approved" ? "good" : l.state === "rejected" ? "bad" : l.state === "cancelled" ? "quiet" : "warn"}
                >
                  {l.state}
                </Badge>
                {l.state === "requested" && canManage && l.userId !== viewerId && (
                  <>
                    <button type="button" disabled={busy} onClick={() => onDecide(l.id, "rejected", "")} style={{ ...ghost, height: 24, fontSize: 11 }}>
                      {t("refuse", "拒绝")}
                    </button>
                    <button type="button" disabled={busy} onClick={() => onDecide(l.id, "approved", "")} style={{ ...solid, height: 24, fontSize: 11 }}>
                      {t("approve", "批准")}
                    </button>
                  </>
                )}
                {l.state === "requested" && l.userId === viewerId && (
                  <button type="button" disabled={busy} onClick={() => onCancel(l.id)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                    {t("cancel", "撤回")}
                  </button>
                )}
              </span>
            </Row>
          ))}
        </>
      )}

      <Label>{t(`Entitlements for ${year}`, `${year} 年度额度`)}</Label>
      {balances.length === 0 ? (
        <>
          <p style={{ fontSize: 12.5, color: "#999999", margin: "0 0 10px", lineHeight: 1.6 }}>
            {t(
              "Nothing set. Start everybody at Hong Kong statutory annual leave, then change any line of it.",
              "尚未设置。可以先按香港法定年假给所有人建立额度，之后逐条调整。",
            )}
          </p>
          {canManage && (
            <button type="button" disabled={busy} onClick={onSeed} style={solid}>
              {t("Set statutory entitlements", "按法定标准设置")}
            </button>
          )}
        </>
      ) : (
        <>
          <Row head>
            <span style={{ flexGrow: 1 }}>{t("Person", "成员")}</span>
            <span style={{ width: 90 }}>{t("Kind", "类型")}</span>
            <span style={{ width: 120, textAlign: "right" }}>{t("Entitled", "额度")}</span>
            <span style={{ width: 90, textAlign: "right" }}>{t("Taken", "已用")}</span>
            <span style={{ width: 90, textAlign: "right" }}>{t("Left", "剩余")}</span>
          </Row>
          {balances.map((b) => (
            <Row key={b.id} style={{ alignItems: "center" }}>
              <span style={{ flexGrow: 1, ...clip }} title={b.personName ?? ""}>{b.personName ?? "—"}</span>
              <span style={{ width: 90, color: "#7c7c7c" }}>{b.kind}</span>
              <span style={{ width: 120, textAlign: "right" }}>
                {canManage ? (
                  <input
                    key={b.id}
                    defaultValue={String(b.entitlementDays)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n !== b.entitlementDays) onEntitlement(b.id, n);
                    }}
                    style={{ ...field, height: 26, width: 78, textAlign: "right" }}
                  />
                ) : (
                  b.entitlementDays
                )}
              </span>
              <span style={{ width: 90, textAlign: "right", color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>
                {b.takenDays}
              </span>
              <span
                style={{
                  width: 90,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: b.entitlementDays + b.carriedDays - b.takenDays < 0 ? "#e03636" : "#278f5e",
                }}
              >
                {(b.entitlementDays + b.carriedDays - b.takenDays).toFixed(1)}
              </span>
            </Row>
          ))}
        </>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- roles */

function Roles({
  requisitions,
  canManage,
  zh,
  busy,
  onOpen,
  onState,
}: {
  requisitions: RequisitionRow[];
  canManage: boolean;
  zh: boolean;
  busy: boolean;
  onOpen: (input: { title: string; department: string; headcount: number; description: string }) => void;
  onState: (id: string, state: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [form, setForm] = useState({ title: "", department: "", headcount: "1", description: "" });

  return (
    <>
      {canManage && (
        <>
          <Label style={{ margin: "0 0 8px" }}>{t("Open a role", "发布岗位")}</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("Job title", "岗位名称")} style={{ ...field, width: 240, height: 32 }} />
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder={t("Department", "部门")} style={{ ...field, width: 170, height: 32 }} />
            <input value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value.replace(/\D/g, "") })} placeholder={t("How many", "人数")} style={{ ...field, width: 90, height: 32, textAlign: "right" }} />
            <button
              type="button"
              disabled={busy || !form.title.trim()}
              onClick={() => {
                onOpen({ ...form, headcount: Number(form.headcount) || 1 });
                setForm({ title: "", department: "", headcount: "1", description: "" });
              }}
              style={{ ...solid, opacity: busy || !form.title.trim() ? 0.45 : 1 }}
            >
              {t("Open", "发布中")}
            </button>
          </div>
        </>
      )}

      {requisitions.length === 0 ? (
        <Empty title={t("No roles open", "没有在招岗位")} />
      ) : (
        requisitions.map((r) => (
          <Row key={r.id} style={{ alignItems: "center" }}>
            <span style={{ flexGrow: 1, ...clip }} title={r.title}>
              {r.title}
              {r.department && <span style={{ color: "#999999", marginLeft: 8, fontSize: 11 }}>{r.department}</span>}
            </span>
            <span style={{ width: 90, color: "#7c7c7c", fontSize: 11.5 }}>
              {r.headcount} {t("wanted", "个名额")}
            </span>
            <span style={{ width: 110, color: "#7c7c7c", fontSize: 11.5 }}>
              {r.applicationCount} {t("applicants", "位申请人")}
            </span>
            <span style={{ width: 130, textAlign: "right" }}>
              {canManage ? (
                <select value={r.state} disabled={busy} onChange={(e) => onState(r.id, e.target.value)} style={{ ...field, height: 26, width: 118, fontSize: 11.5 }}>
                  {["open", "on_hold", "filled", "closed"].map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge tone={r.state === "open" ? "good" : "quiet"}>{r.state}</Badge>
              )}
            </span>
          </Row>
        ))
      )}
    </>
  );
}

/* ------------------------------------------------------------ candidates */

function Candidates({
  candidates,
  overdue,
  requisitions,
  zh,
  busy,
  onAdd,
  onStage,
  onDelete,
}: {
  candidates: CandidateRow[];
  overdue: CandidateRow[];
  requisitions: RequisitionRow[];
  zh: boolean;
  busy: boolean;
  onAdd: (input: {
    name: string;
    email: string;
    phone: string;
    source: string;
    notes: string;
    consented: boolean;
    retainMonths: number;
    requisitionId: string | null;
  }) => void;
  onStage: (applicationId: string, stage: string) => void;
  onDelete: (c: CandidateRow) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    source: "direct",
    notes: "",
    consented: false,
    retainMonths: "12",
    requisitionId: "",
  });

  return (
    <>
      <div
        style={{
          border: "1px solid #ededed",
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 16,
          background: "#fcfcfc",
          fontSize: 11.5,
          color: "#7c7c7c",
          lineHeight: 1.6,
        }}
      >
        {t(
          "Candidates are entered by hand. Nothing here searches for people, and there is no job board to import from: Schedule A3(8) forbids external sourcing.",
          "候选人由人工录入。本模块不会搜寻任何人，也没有招聘网站导入功能：附表 A3(8) 禁止外部搜寻。",
        )}
      </div>

      {overdue.length > 0 && (
        <div style={{ border: "1px solid #ffe2bd", background: "#fffaf3", borderRadius: 10, padding: "11px 13px", marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: "#5c4420", margin: 0, lineHeight: 1.6 }}>
            {t(
              `${overdue.length} candidate record${overdue.length === 1 ? "" : "s"} past the retention date: ${overdue.map((c) => c.name).join(", ")}.`,
              `${overdue.length} 份候选人档案已超过保留期限：${overdue.map((c) => c.name).join("、")}。`,
            )}
          </p>
        </div>
      )}

      <Label style={{ margin: "0 0 8px" }}>{t("Add a candidate", "新增候选人")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Name", "姓名")} style={{ ...field, width: 190, height: 32 }} />
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t("Email", "邮箱")} style={{ ...field, width: 210, height: 32 }} />
        <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder={t("How they reached us", "来源")} style={{ ...field, width: 180, height: 32 }} />
        <select value={form.requisitionId} onChange={(e) => setForm({ ...form, requisitionId: e.target.value })} style={{ ...field, width: 200, height: 32 }}>
          <option value="">{t("No role yet", "暂不关联岗位")}</option>
          {requisitions.filter((r) => r.state === "open").map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={form.consented} onChange={(e) => setForm({ ...form, consented: e.target.checked })} />
          {t("They consented to us keeping this", "对方同意我们保存这些信息")}
        </label>
        <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12 }}>
          {t("Keep for", "保留")}
          <input value={form.retainMonths} onChange={(e) => setForm({ ...form, retainMonths: e.target.value.replace(/\D/g, "") })} style={{ ...field, width: 70, height: 28, textAlign: "right" }} />
          {t("months", "个月")}
        </label>
        <button
          type="button"
          disabled={busy || !form.name.trim()}
          onClick={() => {
            onAdd({ ...form, retainMonths: Number(form.retainMonths) || 12, requisitionId: form.requisitionId || null });
            setForm({ name: "", email: "", phone: "", source: "direct", notes: "", consented: false, retainMonths: "12", requisitionId: "" });
          }}
          style={{ ...solid, opacity: busy || !form.name.trim() ? 0.45 : 1 }}
        >
          {t("Add", "关注")}
        </button>
      </div>

      {candidates.length === 0 ? (
        <Empty title={t("No candidates yet", "还没有候选人")} />
      ) : (
        candidates.map((c) => (
          <div key={c.id} style={{ borderTop: "1px solid #f3f3f3", padding: "11px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{c.name}</span>
              {c.email && <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{c.email}</span>}
              <Badge tone="quiet">{c.source}</Badge>
              {c.consentAt ? (
                <Badge tone="good">{t("consented", "已同意")}</Badge>
              ) : (
                <Badge tone="warn">{t("no consent recorded", "未记录同意")}</Badge>
              )}
              {c.retainUntil && (
                <span style={{ fontSize: 11, color: "#999999" }}>
                  {t("keep until", "保留至")} {c.retainUntil}
                </span>
              )}
              <button type="button" disabled={busy} onClick={() => onDelete(c)} style={{ ...ghost, marginLeft: "auto", height: 24, fontSize: 11 }}>
                {t("delete", "删除")}
              </button>
            </div>

            {c.applications.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 7 }}>
                {c.applications.map((a) => (
                  <span key={a.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                    <span style={{ color: "#7c7c7c" }}>{a.requisitionTitle}</span>
                    <select value={a.stage} disabled={busy} onChange={(e) => onStage(a.id, e.target.value)} style={{ ...field, height: 24, width: 120, fontSize: 11 }}>
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}

/* ---------------------------------------------------------------- people */

function People({
  employees,
  canManage,
  zh,
  busy,
  onSave,
  onAddTask,
  onTick,
}: {
  employees: EmployeeRow[];
  canManage: boolean;
  zh: boolean;
  busy: boolean;
  onSave: (userId: string, input: { jobTitle: string; department: string; startedOn: string; employmentType: string }) => void;
  onAddTask: (userId: string, label: string) => void;
  onTick: (taskId: string, done: boolean) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [task, setTask] = useState<Record<string, string>>({});

  return (
    <>
      {employees.map((e) => (
        <div key={e.userId} style={{ borderTop: "1px solid #f3f3f3", padding: "12px 0" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 500, width: 170 }}>{e.name}</span>
            {canManage ? (
              <>
                <input
                  key={`${e.userId}-title`}
                  defaultValue={e.jobTitle ?? ""}
                  onBlur={(ev) =>
                    ev.target.value !== (e.jobTitle ?? "") &&
                    onSave(e.userId, {
                      jobTitle: ev.target.value,
                      department: e.department ?? "",
                      startedOn: e.startedOn ?? "",
                      employmentType: e.employmentType,
                    })
                  }
                  placeholder={t("Job title", "岗位")}
                  style={{ ...field, width: 190, height: 28 }}
                />
                <input
                  key={`${e.userId}-dept`}
                  defaultValue={e.department ?? ""}
                  onBlur={(ev) =>
                    ev.target.value !== (e.department ?? "") &&
                    onSave(e.userId, {
                      jobTitle: e.jobTitle ?? "",
                      department: ev.target.value,
                      startedOn: e.startedOn ?? "",
                      employmentType: e.employmentType,
                    })
                  }
                  placeholder={t("Department", "部门")}
                  style={{ ...field, width: 150, height: 28 }}
                />
                <input
                  key={`${e.userId}-start`}
                  type="date"
                  defaultValue={e.startedOn ?? ""}
                  onBlur={(ev) =>
                    ev.target.value !== (e.startedOn ?? "") &&
                    onSave(e.userId, {
                      jobTitle: e.jobTitle ?? "",
                      department: e.department ?? "",
                      startedOn: ev.target.value,
                      employmentType: e.employmentType,
                    })
                  }
                  style={{ ...field, width: 150, height: 28 }}
                />
              </>
            ) : (
              <span style={{ fontSize: 12, color: "#7c7c7c" }}>
                {e.jobTitle ?? ""} {e.department ? `· ${e.department}` : ""}
              </span>
            )}
          </div>

          {e.onboarding.length > 0 && (
            <div style={{ marginTop: 8, paddingLeft: 4 }}>
              {e.onboarding.map((task) => (
                <label key={task.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "3px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={task.done} disabled={busy} onChange={(ev) => onTick(task.id, ev.target.checked)} />
                  <span style={{ color: task.done ? "#c7c7c7" : "#383838", textDecoration: task.done ? "line-through" : "none" }}>
                    {task.label}
                  </span>
                </label>
              ))}
            </div>
          )}

          {canManage && (
            <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
              <input
                value={task[e.userId] ?? ""}
                onChange={(ev) => setTask((s) => ({ ...s, [e.userId]: ev.target.value }))}
                placeholder={t("An onboarding task", "入职事项")}
                style={{ ...field, width: 280, height: 28 }}
              />
              <button
                type="button"
                disabled={busy || !(task[e.userId] ?? "").trim()}
                onClick={() => {
                  onAddTask(e.userId, task[e.userId]);
                  setTask((s) => ({ ...s, [e.userId]: "" }));
                }}
                style={{ ...ghost, height: 28 }}
              >
                {t("add", "关注")}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
