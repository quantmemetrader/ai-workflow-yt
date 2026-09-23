"use client";

import { useState } from "react";
import type { ChecklistRow, ContractRow, RunRow, TemplateRow } from "@/lib/legal/service";
import {
  acknowledgeFindingAction,
  draftContractAction,
  findingsAction,
  reviewContractAction,
  saveRunAction,
  saveTemplateAction,
  seedTemplatesAction,
  updateContractAction,
} from "@/app/(app)/legal/actions";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { notify } from "@/lib/client/notify";
import { Badge, Empty, Label, ModuleHeader, Row, clip, field, ghost, solid, useAction } from "@/components/ui/kit";
import { ModuleSidebar, type ScreenItem } from "@/components/shell/ModuleSidebar";

/**
 * Legal (spec §4.10), transcribed from the four `Legal-*` artboards.
 *
 * The non-advice notice sits under the header on every tab, not in a footer
 * somebody scrolls past: it is a term of the contract this was built under
 * (8.4), and clause review is exactly the screen where somebody might forget.
 *
 * Clause review marks departures and explains them. There is no risk column,
 * no score and no recommendation, because a plausible-sounding verdict from a
 * machine is worse than no verdict at all.
 */
type Tab = "draft" | "review" | "repository" | "compliance" | "templates";

type Finding = {
  id: string;
  clause: string;
  templateText: string | null;
  contractText: string | null;
  explanation: string;
  departure: string;
  acknowledgedByName: string | null;
  acknowledged: boolean;
};

export function LegalScreen({
  templates,
  contracts,
  checklists,
  runs,
  nonAdvice,
  locale,
  model,
}: {
  templates: TemplateRow[];
  contracts: ContractRow[];
  checklists: ChecklistRow[];
  runs: RunRow[];
  nonAdvice: string;
  locale: string;
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { busy, run } = useAction();
  const agent = useInlineAgent({ module: "legal" });
  const [tab, setTab] = useState<Tab>(templates.length ? "draft" : "templates");
  const [selected, setSelected] = useState<ContractRow | null>(contracts[0] ?? null);
  const [findings, setFindings] = useState<Finding[]>([]);

  const current = contracts.find((c) => c.id === selected?.id) ?? contracts[0] ?? null;
  const openFindings = contracts.reduce((n, c) => n + c.unacknowledged, 0);

  async function loadFindings(contractId: string) {
    const res = await findingsAction(contractId);
    setFindings(res.findings);
  }

  /* The design draws these down a 212px column, the way every other
     desktop artboard in the set does — not across the top. */
  const SCREENS: ScreenItem<Tab>[] = [
    { key: "draft", label: "Drafting", labelZh: "起草" },
    { key: "review", label: "Clause review", labelZh: "条款审阅", badge: openFindings },
    { key: "repository", label: "Repository", labelZh: "合同库", badge: contracts.length },
    { key: "compliance", label: "Compliance", labelZh: "合规" },
    { key: "templates", label: "Templates", labelZh: "模板", badge: templates.length },
  ];

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
    <ModuleSidebar
      title="Legal"
      titleZh="法务"
      screens={SCREENS}
      active={tab}
      onChange={setTab}
      zh={zh}
      storageKey="legal-sidebar"
    />
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ModuleHeader title={t("Legal", "法务")} note={t("drafting and comparison", "起草与比对")} />

      {/* The notice, on every tab. Contract clause 8.4. */}
      <div
        style={{
          flexShrink: 0,
          padding: "9px 22px",
          borderBottom: "1px solid #ededed",
          fontSize: 11.5,
          color: "#a35f00",
          background: "#fffbf3",
          lineHeight: 1.5,
        }}
      >
        {nonAdvice}
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
          {tab === "draft" && (
            <Drafting
              templates={templates}
              zh={zh}
              busy={busy}
              onSeed={() => run(() => seedTemplatesAction())}
              onDraft={(input) =>
                run(async () => {
                  const res = await draftContractAction(input);
                  if ("id" in res && res.id) {
                    setTab("repository");
                  }
                  return res;
                })
              }
            />
          )}

          {tab === "review" && (
            <Review
              contracts={contracts}
              current={current}
              findings={findings}
              zh={zh}
              busy={busy}
              onSelect={(c) => {
                setSelected(c);
                setFindings([]);
                void loadFindings(c.id);
              }}
              onCompare={(c) =>
                run(async () => {
                  const res = await reviewContractAction(c.id);
                  if ("found" in res) {
                    await loadFindings(c.id);
                    notify(
                      t(`${res.found} departure${res.found === 1 ? "" : "s"} from the template.`, `与模板有 ${res.found} 处差异。`),
                      "ok",
                    );
                  }
                  return res;
                })
              }
              onAcknowledge={(f) =>
                run(
                  () => acknowledgeFindingAction(f.id),
                  () => setFindings((cur) => cur.map((x) => (x.id === f.id ? { ...x, acknowledged: true } : x))),
                )
              }
            />
          )}

          {tab === "repository" && (
            <Repository
              contracts={contracts}
              zh={zh}
              busy={busy}
              onUpdate={(id, input) => run(() => updateContractAction(id, input))}
              onReview={(c) => {
                setSelected(c);
                setTab("review");
                void loadFindings(c.id);
              }}
            />
          )}

          {tab === "compliance" && (
            <Compliance
              checklists={checklists}
              runs={runs}
              zh={zh}
              busy={busy}
              onSeed={() => run(() => seedTemplatesAction())}
              onSave={(input) => run(() => saveRunAction(input))}
            />
          )}

          {tab === "templates" && (
            <Templates
              templates={templates}
              zh={zh}
              busy={busy}
              onSeed={() => run(() => seedTemplatesAction())}
              onSave={(input, after) => run(() => saveTemplateAction(input), after)}
            />
          )}
        </div>

        <ResearchAgentPanel
          accent="#007be0"
          zh={zh}
          scope={t("Legal", "法务")}
          note={t(
            `${contracts.length} contract${contracts.length === 1 ? "" : "s"}, ${openFindings} departure${openFindings === 1 ? "" : "s"} nobody has read yet.`,
            `${contracts.length} 份合同，${openFindings} 处差异尚未有人查看。`,
          )}
          placeholder={t("Ask about a contract…", "询问合同…")}
          footnote={nonAdvice}
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

/* -------------------------------------------------------------- drafting */

function Drafting({
  templates,
  zh,
  busy,
  onSeed,
  onDraft,
}: {
  templates: TemplateRow[];
  zh: boolean;
  busy: boolean;
  onSeed: () => void;
  onDraft: (input: { templateId: string; title: string; counterparty: string; values: Record<string, string> }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const template = templates.find((x) => x.id === templateId) ?? templates[0] ?? null;

  if (!templates.length) {
    return (
      <>
        <Empty
          title={t("No templates yet", "还没有模板")}
          body={t(
            "Start with the two a channel like this signs: a contributor and likeness release, and a freelance production services agreement. Both are editable in full.",
            "可以先用这类频道最常签的两份：出镜同意与肖像使用授权书，以及自由职业制作服务协议。两份都可以完全修改。",
          )}
        />
        <button type="button" disabled={busy} onClick={onSeed} style={solid}>
          {t("Add the two starting templates", "添加这两份初始模板")}
        </button>
      </>
    );
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setValues({}); }} style={{ ...field, width: 340 }}>
        {templates.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Title for this one", "这份合同的标题")} style={{ ...field, width: 330 }} />
        <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={t("Who it is with", "对方")} style={{ ...field, width: 240 }} />
      </div>

      {template && template.fields.length > 0 && (
        <>
          <Label>{t("Fill in", "填写")}</Label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 9 }}>
            {template.fields.map((f) => (
              <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 500, color: "#999999" }}>{f.label}</span>
                <input
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.hint}
                  style={{ ...field, height: 32 }}
                />
              </label>
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        disabled={busy || !template}
        onClick={() => template && onDraft({ templateId: template.id, title, counterparty, values })}
        style={{ ...solid, marginTop: 18 }}
      >
        {busy ? t("Drafting…", "起草中…") : t("Draft it", "生成草稿")}
      </button>

      {template && (
        <>
          <Label>{t("The template", "模板原文")}</Label>
          <pre
            style={{
              margin: 0,
              padding: 14,
              border: "1px solid #ededed",
              borderRadius: 10,
              background: "#fcfcfc",
              fontSize: 11.5,
              lineHeight: 1.7,
              color: "#383838",
              whiteSpace: "pre-wrap",
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {template.body}
          </pre>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- review */

function Review({
  contracts,
  current,
  findings,
  zh,
  busy,
  onSelect,
  onCompare,
  onAcknowledge,
}: {
  contracts: ContractRow[];
  current: ContractRow | null;
  findings: Finding[];
  zh: boolean;
  busy: boolean;
  onSelect: (c: ContractRow) => void;
  onCompare: (c: ContractRow) => void;
  onAcknowledge: (f: Finding) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);

  if (!contracts.length) {
    return <Empty title={t("Nothing to review", "没有可审阅的合同")} body={t("Draft a contract first.", "请先起草一份合同。")} />;
  }

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      <div style={{ width: 230, flexShrink: 0 }}>
        {contracts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            style={{
              width: "100%",
              textAlign: "left",
              border: 0,
              borderRadius: 9,
              padding: "9px 10px",
              cursor: "pointer",
              background: current?.id === c.id ? "#f3f3f3" : "transparent",
              fontFamily: "inherit",
              letterSpacing: "inherit",
              color: "#171717",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 500, display: "block" }}>{c.title}</span>
            <span style={{ fontSize: 11, color: "#999999", display: "block", marginTop: 2 }}>
              {c.templateName ?? t("no template", "无模板")}
              {c.unacknowledged > 0 ? ` · ${c.unacknowledged} ${t("to read", "待查看")}` : ""}
            </span>
          </button>
        ))}
      </div>

      {current && (
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>{current.title}</span>
            <button type="button" disabled={busy} onClick={() => onCompare(current)} style={{ ...solid, marginLeft: "auto" }}>
              {busy ? t("Comparing…", "比对中…") : t("Compare with the template", "与模板比对")}
            </button>
          </div>

          {findings.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.65 }}>
              {t(
                "No departures recorded. Compare it with its template to find them, or there are none.",
                "尚无记录的差异。点击与模板比对进行检查，也可能本来就没有差异。",
              )}
            </p>
          ) : (
            findings.map((f) => (
              <div key={f.id} style={{ border: "1px solid #ededed", borderRadius: 11, padding: 13, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                    {t("Clause", "条款")} {f.clause}
                  </span>
                  <Badge tone={f.departure === "missing" ? "bad" : f.departure === "reworded" ? "quiet" : "warn"}>
                    {f.departure}
                  </Badge>
                  <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{f.explanation}</span>
                  {f.acknowledged ? (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#278f5e" }}>
                      {t("read by", "已查看")} {f.acknowledgedByName ?? "—"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAcknowledge(f)}
                      style={{ ...ghost, marginLeft: "auto", height: 24, fontSize: 11 }}
                    >
                      {t("I have read this", "我已查看")}
                    </button>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 9 }}>
                  <Side label={t("Template", "模板")} text={f.templateText} zh={zh} />
                  <Side label={t("This contract", "本合同")} text={f.contractText} zh={zh} />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Side({ label, text, zh }: { label: string; text: string | null; zh: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 500, color: "#c7c7c7", marginBottom: 3 }}>{label}</div>
      <div
        style={{
          fontSize: 11.5,
          lineHeight: 1.6,
          color: text ? "#383838" : "#c7c7c7",
          background: "#fcfcfc",
          border: "1px solid #f3f3f3",
          borderRadius: 8,
          padding: "8px 10px",
          whiteSpace: "pre-wrap",
          maxHeight: 190,
          overflowY: "auto",
        }}
      >
        {text ?? (zh ? "（本文本中没有这一条）" : "(not in this text)")}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ repository */

function Repository({
  contracts,
  zh,
  busy,
  onUpdate,
  onReview,
}: {
  contracts: ContractRow[];
  zh: boolean;
  busy: boolean;
  onUpdate: (id: string, input: { state?: string; signedOn?: string; expiresOn?: string }) => void;
  onReview: (c: ContractRow) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);

  if (!contracts.length) return <Empty title={t("No contracts yet", "还没有合同")} />;

  return (
    <>
      <Row head>
        <span style={{ flexGrow: 1 }}>{t("Contract", "合同")}</span>
        <span style={{ width: 150 }}>{t("With", "对方")}</span>
        <span style={{ width: 120 }}>{t("State", "状态")}</span>
        <span style={{ width: 120 }}>{t("Signed", "签署日")}</span>
        <span style={{ width: 120 }}>{t("Expires", "到期日")}</span>
        <span style={{ width: 70 }} />
      </Row>
      {contracts.map((c) => (
        <Row key={c.id} style={{ alignItems: "center" }}>
          <span style={{ flexGrow: 1, ...clip }} title={c.title}>
            {c.title}
            {c.unacknowledged > 0 && (
              <span style={{ marginLeft: 7 }}>
                <Badge tone="warn">{t(`${c.unacknowledged} to read`, `${c.unacknowledged} 待查看`)}</Badge>
              </span>
            )}
          </span>
          <span style={{ width: 150, color: "#7c7c7c" }}>{c.counterparty ?? ""}</span>
          <span style={{ width: 120 }}>
            <select
              value={c.state}
              disabled={busy}
              onChange={(e) => onUpdate(c.id, { state: e.target.value })}
              style={{ ...field, height: 26, width: 110, fontSize: 11.5 }}
            >
              {["draft", "in_review", "sent", "signed", "expired", "terminated"].map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </span>
          <span style={{ width: 120 }}>
            <input
              type="date"
              defaultValue={c.signedOn ?? ""}
              onBlur={(e) => e.target.value !== (c.signedOn ?? "") && onUpdate(c.id, { signedOn: e.target.value })}
              style={{ ...field, height: 26, width: 112, fontSize: 11.5 }}
            />
          </span>
          <span style={{ width: 120 }}>
            <input
              type="date"
              defaultValue={c.expiresOn ?? ""}
              onBlur={(e) => e.target.value !== (c.expiresOn ?? "") && onUpdate(c.id, { expiresOn: e.target.value })}
              style={{ ...field, height: 26, width: 112, fontSize: 11.5 }}
            />
          </span>
          <span style={{ width: 70, textAlign: "right" }}>
            <button type="button" onClick={() => onReview(c)} style={{ ...ghost, height: 24, fontSize: 11 }}>
              {t("review", "审阅")}
            </button>
          </span>
        </Row>
      ))}
    </>
  );
}

/* ------------------------------------------------------------ compliance */

function Compliance({
  checklists,
  runs,
  zh,
  busy,
  onSeed,
  onSave,
}: {
  checklists: ChecklistRow[];
  runs: RunRow[];
  zh: boolean;
  busy: boolean;
  onSeed: () => void;
  onSave: (input: { checklistId: string; subject: string; answers: Record<string, { value: string }>; complete: boolean }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [listId, setListId] = useState(checklists[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [answers, setAnswers] = useState<Record<string, { value: string }>>({});

  const list = checklists.find((c) => c.id === listId) ?? checklists[0] ?? null;

  if (!checklists.length) {
    return (
      <>
        <Empty
          title={t("No checklists yet", "还没有检查清单")}
          body={t("Start with the one a video channel runs before publishing.", "可以先用视频频道发布前的那份清单。")}
        />
        <button type="button" disabled={busy} onClick={onSeed} style={solid}>
          {t("Add a starting checklist", "添加初始清单")}
        </button>
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select value={listId} onChange={(e) => { setListId(e.target.value); setAnswers({}); }} style={{ ...field, width: 280 }}>
          {checklists.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("Which video or contract?", "针对哪个视频或合同？")} style={{ ...field, width: 300 }} />
      </div>

      {list?.items.map((item) => (
        <Row key={item.key} style={{ alignItems: "center" }}>
          <span style={{ flexGrow: 1, minWidth: 0, lineHeight: 1.5 }}>{item.text}</span>
          <span style={{ display: "flex", gap: 4 }}>
            {(["yes", "no", "na"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAnswers((a) => ({ ...a, [item.key]: { value: v } }))}
                style={{
                  height: 26,
                  padding: "0 11px",
                  borderRadius: 7,
                  border: "1px solid #ededed",
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                  background:
                    answers[item.key]?.value === v
                      ? v === "yes"
                        ? "#e4faeb"
                        : v === "no"
                          ? "#ffe7e7"
                          : "#f3f3f3"
                      : "#fff",
                  color: answers[item.key]?.value === v ? "#171717" : "#999999",
                }}
              >
                {v === "na" ? t("n/a", "不适用") : v === "yes" ? t("yes", "是") : t("no", "否")}
              </button>
            ))}
          </span>
        </Row>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          disabled={busy || !list}
          onClick={() => list && onSave({ checklistId: list.id, subject, answers, complete: false })}
          style={ghost}
        >
          {t("Save as it is", "保存当前进度")}
        </button>
        <button
          type="button"
          disabled={busy || !list || Object.keys(answers).length < (list?.items.length ?? 0)}
          onClick={() => list && onSave({ checklistId: list.id, subject, answers, complete: true })}
          style={solid}
        >
          {t("Complete the run", "完成检查")}
        </button>
      </div>

      <Label>{t("Past runs", "历史记录")}</Label>
      {runs.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#999999", margin: 0 }}>{t("None yet.", "暂无。")}</p>
      ) : (
        runs.map((r) => {
          const no = Object.values(r.answers).filter((a) => a.value === "no").length;
          return (
            <Row key={r.id} style={{ alignItems: "center" }}>
              <span style={{ width: 110, color: "#7c7c7c", fontSize: 11.5 }}>
                {r.createdAt.toISOString().slice(0, 10)}
              </span>
              <span style={{ flexGrow: 1, minWidth: 0 }}>
                {r.subject || r.checklistName}
                <span style={{ color: "#999999", marginLeft: 8, fontSize: 11 }}>{r.checklistName}</span>
              </span>
              <span style={{ width: 120, color: "#7c7c7c", fontSize: 11.5 }}>{r.ranByName ?? "—"}</span>
              <span style={{ width: 110, textAlign: "right" }}>
                {r.completedAt ? (
                  no > 0 ? (
                    <Badge tone="warn">{t(`${no} answered no`, `${no} 项为否`)}</Badge>
                  ) : (
                    <Badge tone="good">{t("complete", "已完成")}</Badge>
                  )
                ) : (
                  <Badge tone="quiet">{t("in progress", "进行中")}</Badge>
                )}
              </span>
            </Row>
          );
        })
      )}
    </>
  );
}

/* ------------------------------------------------------------- templates */

function Templates({
  templates,
  zh,
  busy,
  onSeed,
  onSave,
}: {
  templates: TemplateRow[];
  zh: boolean;
  busy: boolean;
  onSeed: () => void;
  onSave: (
    input: { id?: string | null; name: string; kind: string; body: string; fields: { key: string; label: string }[] },
    after?: () => void,
  ) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [form, setForm] = useState({ name: "", kind: "agreement", body: "" });

  function open(row: TemplateRow | "new") {
    setEditing(row);
    setForm(row === "new" ? { name: "", kind: "agreement", body: "" } : { name: row.name, kind: row.kind, body: row.body });
  }

  return (
    <>
      <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 14 }}>
        <p style={{ fontSize: 12, color: "#999999", margin: 0, flexGrow: 1, lineHeight: 1.6 }}>
          {t(
            "Write them here. A field the drafting screen should ask for is written as {{ name }} in the body.",
            "在这里撰写模板。需要起草时填写的字段，在正文中写成 {{ 名称 }}。",
          )}
        </p>
        {templates.length === 0 && (
          <button type="button" disabled={busy} onClick={onSeed} style={ghost}>
            {t("Add the two starters", "添加两份初始模板")}
          </button>
        )}
        <button type="button" onClick={() => open("new")} style={solid}>
          {t("New template", "新建模板")}
        </button>
      </div>

      {templates.map((x) => (
        <Row key={x.id} style={{ alignItems: "center" }}>
          <span style={{ flexGrow: 1, ...clip }} title={x.name}>{x.name}</span>
          <span style={{ width: 120, fontSize: 11, color: "#999999" }}>{x.kind}</span>
          <span style={{ width: 120, fontSize: 11, color: "#999999" }}>
            {x.fields.length} {t("fields", "个字段")}
          </span>
          <span style={{ width: 60, textAlign: "right" }}>
            <button type="button" onClick={() => open(x)} style={{ ...ghost, height: 24, fontSize: 11 }}>
              {t("edit", "编辑")}
            </button>
          </span>
        </Row>
      ))}

      {editing !== null && (
        <div
          onMouseDown={() => setEditing(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 210,
            background: "rgba(23,23,23,0.2)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "7vh 18px 18px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
            style={{
              width: "min(720px, 100%)",
              maxHeight: "84vh",
              display: "flex",
              flexDirection: "column",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #e2e2e2",
              boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
              overflow: "hidden",
              animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
            }}
          >
            <div style={{ padding: "17px 18px 0", overflowY: "auto", minHeight: 0 }}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Template name", "模板名称")} style={{ ...field, fontSize: 15, fontWeight: 600, height: 38 }} />
              <textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder={t("The text. Number the clauses so review can compare them.", "正文。请给条款编号，以便审阅时比对。")}
                style={{ ...field, marginTop: 10, minHeight: 330, resize: "vertical", lineHeight: 1.7, padding: "11px 13px" }}
              />
              <p style={{ fontSize: 11, color: "#c7c7c7", margin: "8px 0 0", lineHeight: 1.55 }}>
                {t(
                  "Clause review compares numbered clauses (1., 2., 3.) between a contract and the template it came from.",
                  "条款审阅会按编号（1.、2.、3.）比对合同与其来源模板。",
                )}
              </p>
            </div>

            <div style={{ flexShrink: 0, display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 18px 14px", borderTop: "1px solid #f3f3f3" }}>
              <button type="button" onClick={() => setEditing(null)} style={ghost}>
                {t("Cancel", "取消")}
              </button>
              <button
                type="button"
                disabled={busy || !form.name.trim() || !form.body.trim()}
                onClick={() =>
                  onSave(
                    {
                      id: editing === "new" ? null : editing.id,
                      name: form.name,
                      kind: form.kind,
                      body: form.body,
                      // The fields are whatever the body asks for, so they stay
                      // in step with the text instead of drifting from it.
                      fields: [...new Set([...form.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))]
                        .filter((k) => k !== "studio")
                        .map((k) => ({ key: k, label: k.replace(/_/g, " ") })),
                    },
                    () => setEditing(null),
                  )
                }
                style={{ ...solid, opacity: busy || !form.name.trim() ? 0.45 : 1 }}
              >
                {t("Save", "保存")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
