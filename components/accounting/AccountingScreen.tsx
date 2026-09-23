"use client";

import { useState } from "react";
import type { AccountRow, DocumentRow, EntryRow } from "@/lib/accounting/service";
import {
  addDocumentAction,
  archiveAccountAction,
  createAccountAction,
  deleteDraftAction,
  exportPeriodAction,
  postEntryAction,
  removeDocumentAction,
  saveEntryAction,
  seedAccountsAction,
  voidEntryAction,
} from "@/app/(app)/accounting/actions";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { notify } from "@/lib/client/notify";
import { Badge, Empty, Label, ModuleHeader, Row, clip, field, ghost, money, solid, useAction } from "@/components/ui/kit";
import { ModuleSidebar, type ScreenItem } from "@/components/shell/ModuleSidebar";

/**
 * Accounting (spec §4.7), transcribed from the four `Acc-*` artboards.
 *
 * Manual throughout, at the client's own direction: somebody enters the
 * document, somebody writes the entry, and the export is a CSV. Nothing here
 * reads a receipt, and there is no integration to configure.
 *
 * The rule the spec actually cares about survives intact and is visible on the
 * screen: **nothing posts without a confirmation.** An entry is a draft with
 * its out-of-balance figure showing until a named person posts it, posting
 * refuses an entry that does not balance, and a posted entry cannot be edited.
 * A correction is another entry.
 */
type Tab = "inbox" | "entries" | "period" | "accounts";

type Draft = {
  id: string | null;
  entryDate: string;
  memo: string;
  documentId: string | null;
  lines: { accountId: string; amount: string; description: string }[];
};

export function AccountingScreen({
  period,
  accounts,
  documents,
  entries,
  summary,
  locale,
  model,
}: {
  period: string;
  accounts: AccountRow[];
  documents: DocumentRow[];
  entries: EntryRow[];
  summary: {
    balances: { code: string; name: string; kind: string; totalMicros: number }[];
    draftCount: number;
    unenteredDocuments: number;
  };
  locale: string;
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { busy, run } = useAction();
  const agent = useInlineAgent({ module: "accounting" });
  const [tab, setTab] = useState<Tab>("inbox");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [voiding, setVoiding] = useState<EntryRow | null>(null);

  const pending = documents.filter((d) => !d.enteredAt);

  function newEntry(fromDocument?: DocumentRow) {
    setDraft({
      id: null,
      entryDate: new Date().toISOString().slice(0, 10),
      memo: fromDocument ? fromDocument.title : "",
      documentId: fromDocument?.id ?? null,
      lines: [
        { accountId: "", amount: fromDocument?.amountMicros ? String(fromDocument.amountMicros / 1_000_000) : "", description: "" },
        { accountId: "", amount: fromDocument?.amountMicros ? String(-fromDocument.amountMicros / 1_000_000) : "", description: "" },
      ],
    });
    setTab("entries");
  }

  /* The design draws these down a 212px column, the way every other
     desktop artboard in the set does — not across the top. */
  const SCREENS: ScreenItem<Tab>[] = [
    { key: "inbox", label: "Document inbox", labelZh: "单据收件箱", badge: pending.length },
    { key: "entries", label: "Entries", labelZh: "分录", badge: summary.draftCount },
    { key: "period", label: "Period close", labelZh: "期末结账" },
    { key: "accounts", label: "Accounts", labelZh: "科目" },
  ];

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
    <ModuleSidebar
      title="Accounting"
      titleZh="账务"
      screens={SCREENS}
      active={tab}
      onChange={setTab}
      zh={zh}
      storageKey="accounting-sidebar"
    />
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ModuleHeader
        title={t("Accounting", "账务")}
        note={t("manual entry, nothing posts without a confirmation", "手工记账，未确认不过账")}
        right={
          <button type="button" onClick={() => newEntry()} style={solid}>
            {t("New entry", "新建分录")}
          </button>
        }
      />

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
          {tab === "inbox" && (
            <Inbox
              documents={documents}
              zh={zh}
              busy={busy}
              onAdd={(input) => run(() => addDocumentAction(input))}
              onRemove={(id) => run(() => removeDocumentAction(id))}
              onEnter={(d) => newEntry(d)}
            />
          )}

          {tab === "entries" && (
            <Entries
              entries={entries}
              accounts={accounts}
              documents={pending}
              draft={draft}
              period={period}
              zh={zh}
              busy={busy}
              onDraft={setDraft}
              onSave={(d) =>
                run(
                  () =>
                    saveEntryAction({
                      id: d.id,
                      period,
                      entryDate: d.entryDate,
                      memo: d.memo,
                      documentId: d.documentId,
                      lines: d.lines,
                    }),
                  () => setDraft(null),
                )
              }
              onEdit={(e) =>
                setDraft({
                  id: e.id,
                  entryDate: e.entryDate,
                  memo: e.memo,
                  documentId: e.documentId,
                  lines: e.lines.map((l) => ({
                    accountId: l.accountId,
                    amount: String(l.amountMicros / 1_000_000),
                    description: l.description ?? "",
                  })),
                })
              }
              onPost={(id) => run(() => postEntryAction(id))}
              onVoid={(e) => setVoiding(e)}
              onDelete={(id) => run(() => deleteDraftAction(id))}
            />
          )}

          {tab === "period" && (
            <Period
              period={period}
              summary={summary}
              zh={zh}
              busy={busy}
              onExport={() =>
                run(async () => {
                  const res = await exportPeriodAction(period);
                  if ("error" in res) return res;
                  download(res.filename, res.csv);
                  notify(t("Exported.", "已导出。"), "ok");
                  return {};
                })
              }
            />
          )}

          {tab === "accounts" && (
            <Accounts
              accounts={accounts}
              zh={zh}
              busy={busy}
              onSeed={() => run(() => seedAccountsAction())}
              onCreate={(code, name, kind) => run(() => createAccountAction(code, name, kind))}
              onArchive={(id) => run(() => archiveAccountAction(id))}
            />
          )}
        </div>

        <ResearchAgentPanel
          accent="#007be0"
          zh={zh}
          scope={t("Accounting", "账务")}
          note={t(
            `${pending.length} document${pending.length === 1 ? "" : "s"} waiting to be entered, ${summary.draftCount} draft entr${summary.draftCount === 1 ? "y" : "ies"} in ${period}.`,
            `${pending.length} 份单据待录入，${period} 有 ${summary.draftCount} 条草稿分录。`,
          )}
          placeholder={t("Ask about the books…", "询问账务…")}
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

      {voiding && (
        <ConfirmDialog
          danger
          title={t("Void this entry?", "作废这条分录？")}
          body={t(
            "The row stays and the void is on the record. Nothing is deleted, and the balances stop counting it.",
            "记录会保留，作废会留痕。不会删除任何内容，余额不再计入这条分录。",
          )}
          confirm={t("Void", "作废")}
          cancel={t("Cancel", "取消")}
          onClose={() => setVoiding(null)}
          onConfirm={() => run(() => voidEntryAction(voiding.id))}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- inbox */

function Inbox({
  documents,
  zh,
  busy,
  onAdd,
  onRemove,
  onEnter,
}: {
  documents: DocumentRow[];
  zh: boolean;
  busy: boolean;
  onAdd: (input: { title: string; supplier: string; documentDate: string; amount: string; note: string; fileId: null }) => void;
  onRemove: (id: string) => void;
  onEnter: (d: DocumentRow) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [form, setForm] = useState({ title: "", supplier: "", documentDate: "", amount: "", note: "" });

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 14px", lineHeight: 1.6 }}>
        {t(
          "Receipts and invoices as they arrive. Nothing is read off them automatically; somebody types what matters and writes the entry.",
          "到达的收据与发票。系统不会自动识别，由人录入关键信息并写分录。",
        )}
      </p>

      <Label style={{ margin: "0 0 8px" }}>{t("Add a document", "新增单据")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("What is it?", "单据名称")} style={{ ...field, width: 220, height: 32 }} />
        <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder={t("Supplier", "供应商")} style={{ ...field, width: 160, height: 32 }} />
        <input type="date" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} style={{ ...field, width: 150, height: 32 }} />
        <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.-]/g, "") })} placeholder={t("Amount", "金额")} inputMode="decimal" style={{ ...field, width: 120, height: 32, textAlign: "right" }} />
        <button
          type="button"
          disabled={busy || !form.title.trim()}
          onClick={() => {
            onAdd({ ...form, fileId: null });
            setForm({ title: "", supplier: "", documentDate: "", amount: "", note: "" });
          }}
          style={{ ...solid, opacity: busy || !form.title.trim() ? 0.45 : 1 }}
        >
          {t("Add", "关注")}
        </button>
      </div>

      {documents.length === 0 ? (
        <Empty title={t("Nothing in the inbox", "收件箱是空的")} />
      ) : (
        documents.map((d) => (
          <Row key={d.id} style={{ alignItems: "center" }}>
            <span style={{ flexGrow: 1, ...clip }} title={d.title}>
              {d.title}
              {d.supplier && <span style={{ color: "#999999", marginLeft: 8 }}>{d.supplier}</span>}
            </span>
            <span style={{ width: 110, color: "#7c7c7c" }}>{d.documentDate ?? ""}</span>
            <span style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {d.amountMicros === null ? "" : money(d.amountMicros)}
            </span>
            <span style={{ width: 170, textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {d.enteredAt ? (
                <Badge tone="good">{t("entered", "已录入")}</Badge>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => onEnter(d)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                    {t("write the entry", "写分录")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => onRemove(d.id)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                    {t("remove", "删除")}
                  </button>
                </>
              )}
            </span>
          </Row>
        ))
      )}
    </>
  );
}

/* --------------------------------------------------------------- entries */

function Entries({
  entries,
  accounts,
  documents,
  draft,
  period,
  zh,
  busy,
  onDraft,
  onSave,
  onEdit,
  onPost,
  onVoid,
  onDelete,
}: {
  entries: EntryRow[];
  accounts: AccountRow[];
  documents: DocumentRow[];
  draft: Draft | null;
  period: string;
  zh: boolean;
  busy: boolean;
  onDraft: (d: Draft | null) => void;
  onSave: (d: Draft) => void;
  onEdit: (e: EntryRow) => void;
  onPost: (id: string) => void;
  onVoid: (e: EntryRow) => void;
  onDelete: (id: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const balance = draft
    ? draft.lines.reduce((n, l) => n + (Number(l.amount) || 0), 0)
    : 0;

  return (
    <>
      {draft && (
        <div style={{ border: "1px solid #e2e2e2", borderRadius: 11, padding: 14, marginBottom: 20, background: "#fcfcfc" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input type="date" value={draft.entryDate} onChange={(e) => onDraft({ ...draft, entryDate: e.target.value })} style={{ ...field, width: 150, height: 30 }} />
            <input value={draft.memo} onChange={(e) => onDraft({ ...draft, memo: e.target.value })} placeholder={t("What is this entry for?", "摘要")} style={{ ...field, flexGrow: 1, minWidth: 200, height: 30 }} />
            <select value={draft.documentId ?? ""} onChange={(e) => onDraft({ ...draft, documentId: e.target.value || null })} style={{ ...field, width: 190, height: 30 }}>
              <option value="">{t("No document", "无关联单据")}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>

          {draft.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <select
                value={l.accountId}
                onChange={(e) => {
                  const lines = [...draft.lines];
                  lines[i] = { ...l, accountId: e.target.value };
                  onDraft({ ...draft, lines });
                }}
                style={{ ...field, width: 280, height: 30 }}
              >
                <option value="">{t("Choose an account", "选择科目")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
              <input
                value={l.description}
                onChange={(e) => {
                  const lines = [...draft.lines];
                  lines[i] = { ...l, description: e.target.value };
                  onDraft({ ...draft, lines });
                }}
                placeholder={t("Line description", "行说明")}
                style={{ ...field, flexGrow: 1, minWidth: 140, height: 30 }}
              />
              <input
                value={l.amount}
                onChange={(e) => {
                  const lines = [...draft.lines];
                  lines[i] = { ...l, amount: e.target.value.replace(/[^\d.-]/g, "") };
                  onDraft({ ...draft, lines });
                }}
                placeholder={t("Debit +, credit -", "借 +，贷 -")}
                inputMode="decimal"
                style={{ ...field, width: 140, height: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              />
              <button
                type="button"
                onClick={() => onDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}
                style={{ ...ghost, height: 26, width: 30, padding: 0 }}
                aria-label={t("Remove line", "删除该行")}
              >
                &times;
              </button>
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => onDraft({ ...draft, lines: [...draft.lines, { accountId: "", amount: "", description: "" }] })}
              style={ghost}
            >
              {t("Add a line", "添加行")}
            </button>
            <span
              style={{
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                color: Math.abs(balance) < 0.005 ? "#278f5e" : "#e03636",
              }}
            >
              {Math.abs(balance) < 0.005
                ? t("balances", "已平衡")
                : t(`out by ${balance.toFixed(2)}`, `差额 ${balance.toFixed(2)}`)}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button type="button" onClick={() => onDraft(null)} style={ghost}>
                {t("Cancel", "取消")}
              </button>
              <button type="button" disabled={busy} onClick={() => onSave(draft)} style={solid}>
                {t("Save draft", "保存草稿")}
              </button>
            </span>
          </div>
          <p style={{ fontSize: 11, color: "#c7c7c7", margin: "9px 0 0" }}>
            {t(
              `Saved into ${period}. It stays a draft until somebody posts it, and posting refuses an entry that does not balance.`,
              `保存到 ${period}。在有人过账前始终是草稿，未平衡的分录无法过账。`,
            )}
          </p>
        </div>
      )}

      {entries.length === 0 ? (
        <Empty
          title={t("No entries yet", "还没有分录")}
          body={t("New entry starts one, or write one straight off a document in the inbox.", "点击“新建分录”，或从收件箱的单据直接写分录。")}
        />
      ) : (
        entries.map((e) => (
          <div key={e.id} style={{ borderTop: "1px solid #f3f3f3", padding: "11px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: "#7c7c7c", width: 86 }}>{e.entryDate}</span>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{e.memo || t("(no memo)", "（无摘要）")}</span>
              <Badge tone={e.state === "posted" ? "good" : e.state === "void" ? "bad" : "warn"}>
                {e.state === "posted" ? t("posted", "已过账") : e.state === "void" ? t("void", "已作废") : t("draft", "草稿")}
              </Badge>
              {e.balanceMicros !== 0 && <Badge tone="bad">{t(`out by ${money(e.balanceMicros)}`, `差额 ${money(e.balanceMicros)}`)}</Badge>}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#999999" }}>
                {e.state === "posted"
                  ? `${t("posted by", "过账人")} ${e.postedByName ?? "—"}`
                  : `${t("written by", "录入人")} ${e.createdByName ?? "—"}`}
              </span>
            </div>

            <div style={{ marginTop: 6 }}>
              {e.lines.map((l) => (
                <div key={l.id} style={{ display: "flex", gap: 10, fontSize: 11.5, color: "#7c7c7c", padding: "2px 0" }}>
                  <span style={{ width: 86 }} />
                  <span style={{ width: 300, minWidth: 0 }}>
                    {l.code} · {l.name}
                  </span>
                  <span style={{ flexGrow: 1, minWidth: 0 }}>{l.description ?? ""}</span>
                  <span style={{ width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums", color: l.amountMicros < 0 ? "#0060b0" : "#171717" }}>
                    {money(l.amountMicros)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 7, marginTop: 8, paddingLeft: 86 }}>
              {e.state === "draft" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onEdit(e)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                    {t("edit", "编辑")}
                  </button>
                  <button
                    type="button"
                    disabled={busy || e.balanceMicros !== 0}
                    title={e.balanceMicros !== 0 ? t("It has to balance first.", "需先平衡。") : undefined}
                    onClick={() => onPost(e.id)}
                    style={{ ...solid, height: 24, fontSize: 11, opacity: e.balanceMicros !== 0 ? 0.45 : 1 }}
                  >
                    {t("post", "过账")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDelete(e.id)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                    {t("delete", "删除")}
                  </button>
                </>
              )}
              {e.state === "posted" && (
                <button type="button" disabled={busy} onClick={() => onVoid(e)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                  {t("void", "作废")}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}

/* ---------------------------------------------------------------- period */

function Period({
  period,
  summary,
  zh,
  busy,
  onExport,
}: {
  period: string;
  summary: {
    balances: { code: string; name: string; kind: string; totalMicros: number }[];
    draftCount: number;
    unenteredDocuments: number;
  };
  zh: boolean;
  busy: boolean;
  onExport: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const blockers = summary.draftCount + summary.unenteredDocuments;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{period}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t("posted entries only", "仅统计已过账的分录")}
        </span>
        <button type="button" disabled={busy} onClick={onExport} style={{ ...solid, marginLeft: "auto" }}>
          {busy ? t("Exporting…", "导出中…") : t("Export CSV", "导出 CSV")}
        </button>
      </div>

      {blockers > 0 && (
        <div style={{ border: "1px solid #ffe2bd", background: "#fffaf3", borderRadius: 10, padding: "11px 13px", marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: "#5c4420", margin: 0, lineHeight: 1.6 }}>
            {t(
              `Before this period closes: ${summary.draftCount} entry to post, ${summary.unenteredDocuments} document not entered.`,
              `结账前还需处理：${summary.draftCount} 条分录待过账，${summary.unenteredDocuments} 份单据未录入。`,
            )}
          </p>
        </div>
      )}

      {summary.balances.length === 0 ? (
        <Empty title={t("Nothing posted in this period", "本期还没有过账的分录")} />
      ) : (
        <>
          <Row head>
            <span style={{ width: 80 }}>{t("Code", "科目号")}</span>
            <span style={{ flexGrow: 1 }}>{t("Account", "科目")}</span>
            <span style={{ width: 90 }}>{t("Kind", "类型")}</span>
            <span style={{ width: 130, textAlign: "right" }}>{t("Movement", "本期发生额")}</span>
          </Row>
          {summary.balances.map((b) => (
            <Row key={b.code} style={{ alignItems: "center" }}>
              <span style={{ width: 80, color: "#7c7c7c" }}>{b.code}</span>
              <span style={{ flexGrow: 1, ...clip }} title={b.name}>{b.name}</span>
              <span style={{ width: 90, color: "#999999", fontSize: 11 }}>{b.kind}</span>
              <span style={{ width: 130, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {money(b.totalMicros)}
              </span>
            </Row>
          ))}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------- accounts */

function Accounts({
  accounts,
  zh,
  busy,
  onSeed,
  onCreate,
  onArchive,
}: {
  accounts: AccountRow[];
  zh: boolean;
  busy: boolean;
  onSeed: () => void;
  onCreate: (code: string, name: string, kind: string) => void;
  onArchive: (id: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [form, setForm] = useState({ code: "", name: "", kind: "expense" });

  if (!accounts.length) {
    return (
      <>
        <Empty
          title={t("No chart of accounts yet", "还没有科目表")}
          body={t(
            "Start from a chart that suits a video studio, then change every line of it. Or add accounts one at a time below.",
            "可以先用一套适合视频工作室的科目表，之后逐条修改；也可以在下方逐个添加。",
          )}
        />
        <button type="button" disabled={busy} onClick={onSeed} style={solid}>
          {t("Use a starting chart", "使用初始科目表")}
        </button>
      </>
    );
  }

  return (
    <>
      <Row head>
        <span style={{ width: 90 }}>{t("Code", "科目号")}</span>
        <span style={{ flexGrow: 1 }}>{t("Name", "名称")}</span>
        <span style={{ width: 110 }}>{t("Kind", "类型")}</span>
        <span style={{ width: 60 }} />
      </Row>
      {accounts.map((a) => (
        <Row key={a.id} style={{ alignItems: "center" }}>
          <span style={{ width: 90, color: "#7c7c7c" }}>{a.code}</span>
          <span style={{ flexGrow: 1, ...clip }} title={a.name}>{a.name}</span>
          <span style={{ width: 110, fontSize: 11, color: "#999999" }}>{a.kind}</span>
          <span style={{ width: 60, textAlign: "right" }}>
            <button type="button" disabled={busy} onClick={() => onArchive(a.id)} style={{ ...ghost, height: 22, fontSize: 10.5 }}>
              {t("hide", "隐藏")}
            </button>
          </span>
        </Row>
      ))}

      <Label>{t("Add an account", "添加科目")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t("Code", "科目号")} style={{ ...field, width: 110, height: 32 }} />
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Name", "名称")} style={{ ...field, width: 240, height: 32 }} />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={{ ...field, width: 140, height: 32 }}>
          {["asset", "liability", "equity", "income", "expense"].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !form.code.trim() || !form.name.trim()}
          onClick={() => {
            onCreate(form.code, form.name, form.kind);
            setForm({ code: "", name: "", kind: "expense" });
          }}
          style={{ ...solid, opacity: busy || !form.code.trim() ? 0.45 : 1 }}
        >
          {t("Add", "关注")}
        </button>
      </div>
    </>
  );
}

/**
 * Hand the CSV to the browser.
 *
 * A blob and an anchor rather than a route: the text is already here, and a
 * download route would have to repeat the permission check that the action
 * that produced this has already made.
 */
function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
