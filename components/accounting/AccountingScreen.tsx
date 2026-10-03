"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { AccountRow, DocumentRow, EntryRow, PeriodCloseView, PeriodStatus } from "@/lib/accounting/service";
import {
  addDocumentAction,
  archiveAccountAction,
  closePeriodAction,
  createAccountAction,
  deleteDraftAction,
  exportPeriodAction,
  periodCloseViewAction,
  postEntryAction,
  removeDocumentAction,
  reopenPeriodAction,
  saveEntryAction,
  seedAccountsAction,
  unarchiveAccountAction,
  voidEntryAction,
} from "@/app/(app)/accounting/actions";
import { currencySymbol, hkDateTime, hkToday, periodOfDate } from "@/lib/accounting/close";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAsk } from "@/components/ui/useAsk";
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
type Tab = "inbox" | "entries" | "period" | "accounts" | "library";

type Draft = {
  id: string | null;
  entryDate: string;
  memo: string;
  documentId: string | null;
  lines: { accountId: string; amount: string; description: string }[];
};

export function AccountingScreen({
  period,
  thisMonth,
  currency,
  accounts,
  hiddenAccounts,
  documents,
  entries,
  summary,
  months,
  close,
  canClose,
  locale,
  model,
  library,
}: {
  /** The month 账目 shows (?month=, default this month in Hong Kong). */
  period: string;
  /** This month on Hong Kong's clock. */
  thisMonth: string;
  /** The module's currency code (HKD): every amount is labelled with it. */
  currency: string;
  accounts: AccountRow[];
  /** Accounts somebody hid, to show again. */
  hiddenAccounts: AccountRow[];
  documents: DocumentRow[];
  entries: EntryRow[];
  summary: {
    balances: { code: string; name: string; kind: string; totalMicros: number }[];
    draftCount: number;
    unenteredDocuments: number;
  };
  /** 月结: every month with entries or a close record, newest first. */
  months: PeriodStatus[];
  /** 月结: this month's checklist and summary, as the page loaded it. */
  close: PeriodCloseView;
  /** Owner or admin: may 结账 / 反结账. The server checks again. */
  canClose: boolean;
  locale: string;
  model: string;
  /** The 账务资料库 (1 Oct), drawn by the page. */
  library?: React.ReactNode;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { busy, run } = useAction();
  const agent = useInlineAgent({ module: "accounting" });
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>(sp?.get("tab") === "entries" ? "entries" : sp?.get("tab") === "inbox" || !library ? "inbox" : "library");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [voiding, setVoiding] = useState<EntryRow | null>(null);
  const [deleting, setDeleting] = useState<EntryRow | null>(null);
  const [switching, startSwitch] = useTransition();
  const sym = currencySymbol(currency);

  /* (4 Oct) Another month's entries: the page reads ?month=, so a refresh
     after any action keeps showing the same month. A soft navigation, not a reload. */
  function showMonth(m: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || m === period) return;
    startSwitch(() => router.replace(`${pathname}?tab=entries&month=${m}`, { scroll: false }));
  }

  const pending = documents.filter((d) => !d.enteredAt);
  const closedMonths = new Set(months.filter((m) => m.closed).map((m) => m.period));

  function newEntry(fromDocument?: DocumentRow) {
    setDraft({
      id: null,
      /* The document's own date when it has one, else today in Hong Kong. */
      entryDate: fromDocument?.documentDate || hkToday(),
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
    ...(library ? [{ key: "library" as const, label: "Library", labelZh: "资料库" }] : []),
    { key: "inbox", label: "Document inbox", labelZh: "单据", badge: pending.length },
    { key: "entries", label: "Entries", labelZh: "账目", badge: summary.draftCount },
    { key: "period", label: "Period close", labelZh: "月结" },
    { key: "accounts", label: "Accounts", labelZh: "科目" },
  ];

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ModuleHeader
        title={t("Accounting", "账务")}
        note={t("record receipts and entries; nothing counts until confirmed", "录入单据和账目，确认后才入账")}
        right={
          <button type="button" onClick={() => newEntry()} style={solid}>
            {t("Record an entry", "记一笔账")}
          </button>
        }
      />
      <ModuleSidebar
      title="Accounting"
      titleZh="账务"
      screens={SCREENS}
      active={tab}
      onChange={setTab}
      zh={zh}
      storageKey="accounting-sidebar"
    />

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
          {tab === "library" && library}
          {tab === "inbox" && (
            <Inbox
              documents={documents}
              zh={zh}
              busy={busy}
              onAdd={(input) => run(() => addDocumentAction(input))}
              onRemove={(id) => run(() => removeDocumentAction(id))}
              currency={currency}
              onEnter={(d) => newEntry(d)}
            />
          )}

          {tab === "entries" && (
            <Entries
              entries={entries}
              closedMonths={closedMonths}
              accounts={accounts}
              documents={pending}
              draft={draft}
              period={period}
              thisMonth={thisMonth}
              months={months}
              sym={sym}
              switching={switching}
              onMonth={showMonth}
              zh={zh}
              busy={busy}
              onDraft={setDraft}
              onSave={(d) => {
                let savedInto = "";
                run(
                  async () => {
                    const res = await saveEntryAction({
                      id: d.id,
                      entryDate: d.entryDate,
                      memo: d.memo,
                      documentId: d.documentId,
                      lines: d.lines,
                    });
                    if ("period" in res && res.period) savedInto = res.period;
                    return res;
                  },
                  () => {
                    setDraft(null);
                    notify(t(`Saved as a draft in ${savedInto}.`, `已保存为草稿，记入 ${savedInto}。`), "ok");
                    /* Dated in another month: show that month, where it now is. */
                    if (savedInto && savedInto !== period) showMonth(savedInto);
                  },
                );
              }}
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
              onPost={(id) => run(() => postEntryAction(id), () => notify(t("Posted.", "已确认入账。"), "ok"))}
              onVoid={(e) => setVoiding(e)}
              onDelete={(e) => setDeleting(e)}
            />
          )}

          {tab === "period" && (
            <Period
              initial={close}
              months={months}
              sym={sym}
              canClose={canClose}
              zh={zh}
              busy={busy}
              run={run}
            />
          )}

          {tab === "accounts" && (
            <Accounts
              accounts={accounts}
              hidden={hiddenAccounts}
              zh={zh}
              busy={busy}
              run={run}
              onSeed={() => run(() => seedAccountsAction())}
              onArchive={(id) => run(() => archiveAccountAction(id), () => notify(t("Hidden. It can be shown again below.", "已隐藏，可在下方重新显示。"), "ok"))}
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
          attach
          onAsk={(prompt, files) => void agent.send(prompt, files)}
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
          title={t("Void this entry?", "作废这笔账？")}
          body={t(
            "The row stays and the void is on the record. Nothing is deleted, and the balances stop counting it.",
            "记录会保留，作废会留痕。不会删除任何内容，余额不再计入这条分录。",
          )}
          confirm={t("Void", "作废")}
          cancel={t("Cancel", "取消")}
          onClose={() => setVoiding(null)}
          onConfirm={() => run(() => voidEntryAction(voiding.id), () => notify(t("Voided.", "已作废。"), "ok"))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          danger
          title={t("Delete this draft?", "删除这条草稿分录？")}
          body={t(
            `"${deleting.memo || "(no memo)"}", dated ${deleting.entryDate}. A draft has not been posted, so the books do not change; the draft itself cannot be brought back.`,
            `「${deleting.memo || "无摘要"}」，日期 ${deleting.entryDate}。草稿尚未入账，删除不影响账目余额，但删除后无法恢复。`,
          )}
          confirm={t("Delete", "删除")}
          cancel={t("Cancel", "取消")}
          onClose={() => setDeleting(null)}
          onConfirm={() => run(() => deleteDraftAction(deleting.id), () => notify(t("Draft deleted.", "草稿已删除。"), "ok"))}
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
  currency,
}: {
  documents: DocumentRow[];
  currency: string;
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
          "收到的收据和发票记在这里，再从单据记账。",
        )}
      </p>

      <Label style={{ margin: "0 0 8px" }}>{t("Add a document", "新增单据")}</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 20 }}>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("What is it?", "单据名称")} style={{ ...field, width: 220, height: 32 }} />
        <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder={t("Supplier", "供应商")} style={{ ...field, width: 160, height: 32 }} />
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={{ fontSize: 11.5, color: "#8a8a8a" }}>{t("Date", "日期")}</span><input type="date" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} style={{ ...field, width: 150, height: 32 }} /></label>
        <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.-]/g, "") })} placeholder={t(`Amount (${currencySymbol(currency)})`, `金额（${currencySymbol(currency)}）`)} inputMode="decimal" style={{ ...field, width: 120, height: 32, textAlign: "right" }} />
        <button
          type="button"
          disabled={busy || !form.title.trim()}
          onClick={() => {
            onAdd({ ...form, fileId: null });
            setForm({ title: "", supplier: "", documentDate: "", amount: "", note: "" });
          }}
          style={{ ...solid, opacity: busy || !form.title.trim() ? 0.45 : 1 }}
        >
          {t("Add", "添加")}
        </button>
      </div>

      {documents.length === 0 ? (
        <Empty title={t("No documents yet", "还没有单据")} />
      ) : (
        documents.map((d) => (
          <Row key={d.id} style={{ alignItems: "center" }}>
            <span style={{ flexGrow: 1, ...clip }} title={d.title}>
              {d.title}
              {d.supplier && <span style={{ color: "#999999", marginLeft: 8 }}>{d.supplier}</span>}
            </span>
            <span style={{ width: 110, color: "#7c7c7c" }}>{d.documentDate ?? ""}</span>
            <span style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {d.amountMicros === null ? "" : money(d.amountMicros, currencySymbol(d.currency || currency))}
            </span>
            <span style={{ width: 170, textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {d.enteredAt ? (
                <Badge tone="good">{t("entered", "已录入")}</Badge>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => onEnter(d)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                    {t("write the entry", "记账")}
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
  closedMonths,
  accounts,
  documents,
  draft,
  period,
  thisMonth,
  months,
  sym,
  switching,
  onMonth,
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
  closedMonths: Set<string>;
  accounts: AccountRow[];
  documents: DocumentRow[];
  draft: Draft | null;
  period: string;
  thisMonth: string;
  months: PeriodStatus[];
  sym: string;
  switching: boolean;
  onMonth: (m: string) => void;
  zh: boolean;
  busy: boolean;
  onDraft: (d: Draft | null) => void;
  onSave: (d: Draft) => void;
  onEdit: (e: EntryRow) => void;
  onPost: (id: string) => void;
  onVoid: (e: EntryRow) => void;
  onDelete: (e: EntryRow) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const m = (micros: number) => money(micros, sym);
  const draftPeriod = draft ? periodOfDate(draft.entryDate) : null;
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
                placeholder={t(`${sym} debit +, credit -`, `${sym} 借 +，贷 -`)}
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
                : t(`out by ${sym}${balance.toFixed(2)}`, `差额 ${sym}${balance.toFixed(2)}`)}
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
          <p style={{ fontSize: 11, color: draftPeriod && closedMonths.has(draftPeriod) ? "#b42323" : "#c7c7c7", margin: "9px 0 0" }}>
            {draftPeriod && closedMonths.has(draftPeriod)
              ? t(
                  `${draftPeriod} is closed: an entry dated in it cannot be saved until an owner or admin reopens it.`,
                  `${draftPeriod} 已结账：日期在该月的分录不能保存，需管理员先反结账。`,
                )
              : t(
                  `Saved into ${draftPeriod ?? "the month of its date"}, the month of its date. It stays a draft until somebody posts it, and posting refuses an entry that does not balance.`,
                  `按日期记入 ${draftPeriod ?? "日期所在月份"}。在有人过账前始终是草稿，未平衡的分录无法过账。`,
                )}
          </p>
        </div>
      )}

      {/* (4 Oct) Any month, not only the current one: after 反结账 an earlier month's entries can be found and corrected. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select
          value={months.some((x) => x.period === period) ? period : ""}
          disabled={switching}
          onChange={(e) => e.target.value && onMonth(e.target.value)}
          style={{ ...field, width: 190, height: 30 }}
          aria-label={t("Month", "月份")}
        >
          {!months.some((x) => x.period === period) && <option value="">{period}</option>}
          {months.map((x) => (
            <option key={x.period} value={x.period}>
              {x.period}
              {x.period === thisMonth ? t(" (this month)", "（本月）") : ""} · {x.closed ? t("closed", "已结账") : t("open", "未结账")}
            </option>
          ))}
        </select>
        <input
          type="month"
          value={period}
          disabled={switching}
          onChange={(e) => onMonth(e.target.value)}
          style={{ ...field, width: 150, height: 30 }}
          aria-label={t("Any month", "其他月份")}
        />
        {period !== thisMonth && (
          <button type="button" disabled={switching} onClick={() => onMonth(thisMonth)} style={{ ...ghost, height: 28, fontSize: 11.5 }}>
            {t("This month", "回到本月")}
          </button>
        )}
        {closedMonths.has(period) && <Badge tone="quiet">{t("closed", "已结账")}</Badge>}
        <span style={{ fontSize: 11, color: "#b0b0b0", marginLeft: "auto" }}>
          {switching ? t("Loading…", "读取中…") : t(`Entries booked into or dated in ${period}. Amounts in ${sym}.`, `显示记入或日期在 ${period} 的分录，金额单位 ${sym}`)}
        </span>
      </div>

      {entries.length === 0 ? (
        <Empty
          title={t(`No entries in ${period}`, `${period} 还没有账目`)}
          body={t("New entry starts one, or write one straight off a document in the inbox.", "点「记一笔账」，或在「单据」里从一张单据直接记账。")}
        />
      ) : (
        entries.map((e) => {
          /* 月结: the server refuses any change to an entry in a closed month; the buttons go too. */
          const locked = closedMonths.has(e.period) || closedMonths.has(e.entryDate.slice(0, 7));
          return (
          <div key={e.id} style={{ borderTop: "1px solid #f3f3f3", padding: "11px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: "#7c7c7c", width: 86 }}>{e.entryDate}</span>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{e.memo || t("(no memo)", "（无摘要）")}</span>
              <Badge tone={e.state === "posted" ? "good" : e.state === "void" ? "bad" : "warn"}>
                {e.state === "posted" ? t("posted", "已入账") : e.state === "void" ? t("void", "已作废") : t("draft", "草稿")}
              </Badge>
              {locked && <Badge tone="quiet">{t("period closed", "已结账")}</Badge>}
              {e.balanceMicros !== 0 && <Badge tone="bad">{t(`out by ${m(e.balanceMicros)}`, `差额 ${m(e.balanceMicros)}`)}</Badge>}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#999999" }}>
                {e.state === "posted"
                  ? `${t("posted by", "确认人")} ${e.postedByName ?? "—"}`
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
                    {m(l.amountMicros)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 7, marginTop: 8, paddingLeft: 86 }}>
              {!locked && e.state === "draft" && (
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
                    {t("post", "确认入账")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDelete(e)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                    {t("delete", "删除")}
                  </button>
                </>
              )}
              {!locked && e.state === "posted" && (
                <button type="button" disabled={busy} onClick={() => onVoid(e)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                  {t("void", "作废")}
                </button>
              )}
            </div>
          </div>
          );
        })
      )}
    </>
  );
}

/* ---------------------------------------------------------------- period */

/**
 * 月结. Pick a month; see what stands between it and closing; close it (owner
 * or admin). A closed month says when and by whom, and only reopens with a
 * reason. Every rule here is enforced again by the service: the screen only
 * saves somebody a refusal.
 */
function Period({
  initial,
  months,
  sym,
  canClose,
  zh,
  busy,
  run,
}: {
  initial: PeriodCloseView;
  months: PeriodStatus[];
  sym: string;
  canClose: boolean;
  zh: boolean;
  busy: boolean;
  run: ReturnType<typeof useAction>["run"];
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const ask = useAsk(zh);
  const [view, setView] = useState<PeriodCloseView>(initial);
  const [loading, setLoading] = useState(false);
  const period = view.period;
  const c = view.checklist;
  const closed = view.status.closed;
  /* (4 Oct) On Hong Kong's clock, explicitly: the server renders in UTC and
     the browser in its own zone, and they disagreed around midnight. */
  const day = (d: Date | string | null) => hkDateTime(d);
  const money = (micros: number) => moneyIn(micros, sym);
  const total = view.balances.reduce((n, b) => n + b.totalMicros, 0);

  async function load(p: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return;
    setLoading(true);
    try {
      const res = await periodCloseViewAction(p);
      if ("error" in res) notify(res.error ?? t("Could not load.", "没能读取。"));
      else setView(res.view);
    } finally {
      setLoading(false);
    }
  }

  async function onClose() {
    const ok = await ask.confirm({
      title: t(`Close ${period}?`, `结账 ${period}？`),
      body: t(
        "Once closed, no entry booked into or dated in this month can be written, posted, voided or deleted. An owner or admin can reopen it, with a reason.",
        "结账后，记入或日期在本月的分录都不能再新增、修改、过账、作废或删除。如需更正，管理员或所有者可以写明原因后反结账。",
      ),
      confirm: t("Close the month", "结账"),
    });
    if (!ok) return;
    run(async () => {
      const res = await closePeriodAction(period);
      if (res.error) return res;
      await load(period);
      notify(t(`${period} closed.`, `${period} 已结账。`), "ok");
      return {};
    });
  }

  async function onReopen() {
    const reason = await ask.prompt({
      title: t(`Reopen ${period}? Say why.`, `反结账 ${period}，请写明原因`),
      placeholder: t("e.g. a supplier invoice dated in this month arrived late", "例如：本月的一张供应商发票迟到，需要补记"),
      confirm: t("Reopen", "反结账"),
    });
    if (!reason) return;
    run(async () => {
      const res = await reopenPeriodAction(period, reason);
      if (res.error) return res;
      await load(period);
      notify(t(`${period} reopened.`, `${period} 已反结账。`), "ok");
      return {};
    });
  }

  const checks: { ok: boolean; warn?: boolean; text: string }[] = [
    {
      ok: c.drafts === 0,
      text:
        c.drafts === 0
          ? t("No draft entries in this month", "本月没有草稿分录")
          : t(
              `${c.drafts} draft entr${c.drafts === 1 ? "y" : "ies"} to post or delete${c.unbalanced ? `, ${c.unbalanced} not balancing` : ""}`,
              `${c.drafts} 条草稿分录待过账或删除${c.unbalanced ? `，其中 ${c.unbalanced} 条借贷不平` : ""}`,
            ),
    },
    {
      ok: c.trialBalanceMicros === 0,
      text:
        c.trialBalanceMicros === 0
          ? t("Trial balance balances", "试算平衡：借贷相等")
          : t(`Trial balance out by ${money(c.trialBalanceMicros)}`, `试算不平衡：借贷相差 ${money(c.trialBalanceMicros)}`),
    },
    {
      ok: c.earlierOpen.length === 0,
      text:
        c.earlierOpen.length === 0
          ? t("Every earlier month with entries is closed", "更早有分录的月份都已结账")
          : t(`Close earlier months first: ${c.earlierOpen.join(", ")}`, `请先结更早的月份：${c.earlierOpen.join("、")}`),
    },
    {
      ok: c.unenteredDocuments === 0,
      warn: c.unenteredDocuments > 0,
      text:
        c.unenteredDocuments === 0
          ? t("Every document from this month has an entry", "本月的单据都已记账")
          : t(
              `${c.unenteredDocuments} document${c.unenteredDocuments === 1 ? "" : "s"} from this month without an entry (does not block; book it into an open month later)`,
              `本月有 ${c.unenteredDocuments} 份单据还没记账（不影响结账，之后可记入未结账的月份）`,
            ),
    },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select
          value={months.some((m) => m.period === period) ? period : ""}
          disabled={loading}
          onChange={(e) => e.target.value && void load(e.target.value)}
          style={{ ...field, width: 210, height: 32 }}
          aria-label={t("Month", "月份")}
        >
          {!months.some((m) => m.period === period) && <option value="">{period}</option>}
          {months.map((m) => (
            <option key={m.period} value={m.period}>
              {m.period} · {m.closed ? t("closed", "已结账") : t("open", "未结账")}
            </option>
          ))}
        </select>
        <input
          type="month"
          value={period}
          disabled={loading}
          onChange={(e) => void load(e.target.value)}
          style={{ ...field, width: 150, height: 32 }}
          aria-label={t("Any month", "其他月份")}
        />
        <Badge tone={closed ? "good" : "warn"}>{closed ? t("closed", "已结账") : t("open", "未结账")}</Badge>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const res = await exportPeriodAction(period);
                if ("error" in res) return res;
                download(res.filename, res.csv);
                notify(t("Exported.", "已导出。"), "ok");
                return {};
              })
            }
            style={ghost}
          >
            {t("Export CSV", "导出 CSV")}
          </button>
          {canClose &&
            (closed ? (
              <button type="button" disabled={busy || loading} onClick={() => void onReopen()} style={ghost}>
                {t("Reopen", "反结账")}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || loading || view.blockers.length > 0}
                title={view.blockers.length ? view.blockers.join("；") : undefined}
                onClick={() => void onClose()}
                style={{ ...solid, opacity: view.blockers.length ? 0.45 : 1 }}
              >
                {t("Close the month", "结账")}
              </button>
            ))}
        </span>
      </div>

      {closed ? (
        <div style={{ border: "1px solid #d7eee2", background: "#f5fbf8", borderRadius: 10, padding: "11px 13px", marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: "#1f5e40", margin: 0, lineHeight: 1.6 }}>
            {t(
              `Closed ${day(view.status.closedAt)} by ${view.status.closedByName ?? "—"}. Entries in ${period} can no longer be changed.`,
              `已结账 · ${day(view.status.closedAt)} · ${view.status.closedByName ?? "—"}。${period} 的分录不能再改动。`,
            )}
          </p>
        </div>
      ) : (
        <>
          <Label style={{ margin: "0 0 8px" }}>{t("Before closing", "结账前检查")}</Label>
          <div style={{ marginBottom: 14 }}>
            {checks.map((k) => (
              <div key={k.text} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, padding: "4px 0", color: k.ok ? "#525252" : k.warn ? "#5c4420" : "#b42323" }}>
                <CheckMark state={k.ok ? "ok" : k.warn ? "warn" : "bad"} />
                <span style={{ lineHeight: 1.55 }}>{k.text}</span>
              </div>
            ))}
          </div>
          {!canClose && (
            <p style={{ fontSize: 11.5, color: "#999999", margin: "0 0 14px" }}>
              {t("Only an owner or admin can close a month.", "只有管理员或所有者可以结账。")}
            </p>
          )}
        </>
      )}

      {view.status.reopenedAt && (
        <p style={{ fontSize: 11.5, color: "#999999", margin: "0 0 14px", lineHeight: 1.6 }}>
          {t(
            `Reopened ${day(view.status.reopenedAt)} by ${view.status.reopenedByName ?? "—"}: ${view.status.reopenReason ?? ""}`,
            `曾于 ${day(view.status.reopenedAt)} 由 ${view.status.reopenedByName ?? "—"} 反结账，原因：${view.status.reopenReason ?? ""}`,
          )}
        </p>
      )}

      <Label style={{ margin: "6px 0 8px" }}>{t(`${period} summary (posted entries only)`, `${period} 结账汇总（只算已入账的）`)}</Label>
      {view.balances.length === 0 ? (
        <Empty title={t("Nothing posted in this period", "本期还没有入账的记录")} />
      ) : (
        <>
          <Row head>
            <span style={{ width: 80 }}>{t("Code", "科目号")}</span>
            <span style={{ flexGrow: 1 }}>{t("Account", "科目")}</span>
            <span style={{ width: 90 }}>{t("Kind", "类型")}</span>
            <span style={{ width: 120, textAlign: "right" }}>{t("Debit", "借方")}</span>
            <span style={{ width: 120, textAlign: "right" }}>{t("Credit", "贷方")}</span>
          </Row>
          {view.balances.map((b) => (
            <Row key={b.code} style={{ alignItems: "center" }}>
              <span style={{ width: 80, color: "#7c7c7c" }}>{b.code}</span>
              <span style={{ flexGrow: 1, ...clip }} title={b.name}>{b.name}</span>
              <span style={{ width: 90, color: "#999999", fontSize: 11 }}>{kindLabel(b.kind, zh)}</span>
              <span style={{ width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.totalMicros > 0 ? money(b.totalMicros) : ""}</span>
              <span style={{ width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#0060b0" }}>{b.totalMicros < 0 ? money(-b.totalMicros) : ""}</span>
            </Row>
          ))}
          <Row style={{ alignItems: "center", fontWeight: 500 }}>
            <span style={{ width: 80 }} />
            <span style={{ flexGrow: 1 }}>
              {t("Total", "合计")}{" "}
              <Badge tone={total === 0 ? "good" : "bad"}>{total === 0 ? t("balances", "借贷平衡") : t(`out by ${money(total)}`, `相差 ${money(total)}`)}</Badge>
            </span>
            <span style={{ width: 90 }} />
            <span style={{ width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {money(view.balances.reduce((n, b) => n + Math.max(b.totalMicros, 0), 0))}
            </span>
            <span style={{ width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#0060b0" }}>
              {money(view.balances.reduce((n, b) => n + Math.max(-b.totalMicros, 0), 0))}
            </span>
          </Row>
        </>
      )}

      <Label style={{ margin: "22px 0 8px" }}>{t("Months", "各月状态")}</Label>
      <Row head>
        <span style={{ width: 90 }}>{t("Month", "月份")}</span>
        <span style={{ width: 80, textAlign: "right" }}>{t("Entries", "分录")}</span>
        <span style={{ flexGrow: 1, paddingLeft: 18 }}>{t("Status", "状态")}</span>
      </Row>
      {months.map((m) => (
        <Row key={m.period} style={{ alignItems: "center", cursor: "pointer", background: m.period === period ? "#f7f7f7" : undefined }}>
          <button
            type="button"
            onClick={() => void load(m.period)}
            style={{ width: 90, textAlign: "left", border: 0, background: "none", padding: 0, font: "inherit", cursor: "pointer", color: "#171717" }}
          >
            {m.period}
          </button>
          <span style={{ width: 80, textAlign: "right", color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>{m.entries}</span>
          <span style={{ flexGrow: 1, paddingLeft: 18, color: m.closed ? "#278f5e" : "#7c7c7c", ...clip }}>
            {m.closed
              ? t(`Closed · ${day(m.closedAt)} · ${m.closedByName ?? "—"}`, `已结账 · ${day(m.closedAt)} · ${m.closedByName ?? "—"}`)
              : t("Open", "未结账")}
          </span>
        </Row>
      ))}

      {ask.dialog}
    </>
  );
}

const moneyIn = (micros: number, sym: string) => money(micros, sym);

/** A line icon for a checklist item: tick, warning dot, or cross. No emoji. */
function CheckMark({ state }: { state: "ok" | "warn" | "bad" }) {
  const color = state === "ok" ? "#278f5e" : state === "warn" ? "#c27a12" : "#e03636";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
      <circle cx="7" cy="7" r="6.25" stroke={color} strokeWidth="1.2" />
      {state === "ok" && <path d="M4.3 7.2l1.8 1.8 3.6-3.8" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
      {state === "warn" && <path d="M7 4v3.6M7 9.6v.1" stroke={color} strokeWidth="1.3" strokeLinecap="round" />}
      {state === "bad" && <path d="M5 5l4 4M9 5l-4 4" stroke={color} strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

/* (QA, 2 Oct) Account kinds are stored as English keys; shown in Chinese. */
const KIND_ZH: Record<string, string> = { asset: "资产", liability: "负债", equity: "权益", income: "收入", expense: "费用" };
const kindLabel = (k: string, zh: boolean) => (zh ? (KIND_ZH[k] ?? k) : k);

/* -------------------------------------------------------------- accounts */

function Accounts({
  accounts,
  hidden,
  zh,
  busy,
  run,
  onSeed,
  onArchive,
}: {
  accounts: AccountRow[];
  hidden: AccountRow[];
  zh: boolean;
  busy: boolean;
  run: ReturnType<typeof useAction>["run"];
  onSeed: () => void;
  onArchive: (id: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const ask = useAsk(zh);
  const [form, setForm] = useState({ code: "", name: "", kind: "expense" });

  const unhide = (a: AccountRow) =>
    run(() => unarchiveAccountAction(a.id), () => notify(t(`${a.code} ${a.name} is shown again.`, `已重新显示科目 ${a.code} ${a.name}。`), "ok"));

  /* (QA, 4 Oct) A code already in use used to vanish without a word. Now it
     says so; when the code belongs to a hidden account, it offers to show
     that one again instead. The form keeps what was typed until it saves. */
  function onCreate(code: string, name: string, kind: string) {
    let hiddenMatch: AccountRow | null = null;
    run(
      async () => {
        const res = await createAccountAction(code, name, kind);
        if ("hidden" in res && res.hidden) {
          hiddenMatch = res.hidden;
          return {};
        }
        return res;
      },
      () => {
        const match = hiddenMatch as AccountRow | null;
        if (!match) {
          setForm({ code: "", name: "", kind: "expense" });
          notify(t("Account added.", "科目已添加。"), "ok");
          return;
        }
        void ask
          .confirm({
            title: t(`Code ${match.code} belongs to a hidden account`, `科目代码 ${match.code} 已存在（已隐藏）`),
            body: t(
              `"${match.code} ${match.name}" was hidden. Show it again instead of adding a new one?`,
              `「${match.code} ${match.name}」之前被隐藏了。要重新显示它吗？`,
            ),
            confirm: t("Show it again", "重新显示"),
          })
          .then((ok) => {
            if (ok) {
              setForm({ code: "", name: "", kind: "expense" });
              unhide(match);
            }
          });
      },
    );
  }
  const addForm = (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t("Code", "科目号")} style={{ ...field, width: 110, height: 32 }} />
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Name", "名称")} style={{ ...field, width: 240, height: 32 }} />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={{ ...field, width: 140, height: 32 }}>
          {["asset", "liability", "equity", "income", "expense"].map((k) => (
            <option key={k} value={k}>
              {kindLabel(k, zh)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !form.code.trim() || !form.name.trim()}
          onClick={() => onCreate(form.code, form.name, form.kind)}
          style={{ ...solid, opacity: busy || !form.code.trim() ? 0.45 : 1 }}
        >
          {t("Add", "添加")}
        </button>
      </div>
  );

  const hiddenList = (
    hidden.length > 0 && (
        <details style={{ marginTop: 22 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "#7c7c7c" }}>
            {t(`Hidden accounts (${hidden.length})`, `已隐藏的科目（${hidden.length}）`)}
          </summary>
          <div style={{ marginTop: 6 }}>
            {hidden.map((a) => (
              <Row key={a.id} style={{ alignItems: "center", color: "#7c7c7c" }}>
                <span style={{ width: 90 }}>{a.code}</span>
                <span style={{ flexGrow: 1, ...clip }} title={a.name}>{a.name}</span>
                <span style={{ width: 110, fontSize: 11, color: "#999999" }}>{kindLabel(a.kind, zh)}</span>
                <span style={{ width: 80, textAlign: "right" }}>
                  <button type="button" disabled={busy} onClick={() => unhide(a)} style={{ ...ghost, height: 22, fontSize: 10.5 }}>
                    {t("show again", "重新显示")}
                  </button>
                </span>
              </Row>
            ))}
          </div>
        </details>
      )
  );

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
        {/* (QA, 2 Oct: the hint said "add them one at a time below" and there was nothing below.) */}
        <Label>{t("Or add an account", "或者逐个添加科目")}</Label>
        {addForm}
        {hiddenList}
        {ask.dialog}
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
          <span style={{ width: 110, fontSize: 11, color: "#999999" }}>{kindLabel(a.kind, zh)}</span>
          <span style={{ width: 60, textAlign: "right" }}>
            <button type="button" disabled={busy} onClick={() => onArchive(a.id)} style={{ ...ghost, height: 22, fontSize: 10.5 }}>
              {t("hide", "隐藏")}
            </button>
          </span>
        </Row>
      ))}

      <Label>{t("Add an account", "添加科目")}</Label>
      {addForm}

      {hiddenList}
      {ask.dialog}
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
  /* A byte-order mark first: without it Excel opens UTF-8 as the local code
     page and every Chinese header and memo is mojibake (QA, 3 Oct). */
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
