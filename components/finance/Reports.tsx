"use client";

import { useState } from "react";
import type { ReportRow } from "@/lib/finance/reports";
import { Badge, Empty, field, ghost, solid } from "@/components/ui/kit";
import { Markdown } from "@/components/ui/Markdown";

/**
 * The monthly management report — the design's fifth Finance screen.
 *
 * A list of months down the left and the report itself on the right, because
 * the thing people do here is read last month's next to this month's.
 *
 * Two behaviours worth seeing in the screen rather than only in the service:
 *
 *   — **A shared report cannot be edited in place.** Editing one makes a new
 *     draft, and the button says so before you press it. A management report
 *     that can be quietly rewritten after circulation is not a record.
 *   — **Every figure in it came from the ledger at the moment it was
 *     written.** The screen says so, once, under the title — so a number that
 *     disagrees with today's dashboard reads as history rather than as a bug.
 */
export function Reports({
  reports,
  period,
  zh,
  busy,
  generating,
  onGenerate,
  onSave,
  onShare,
}: {
  reports: ReportRow[];
  /** The period the rest of the module is showing, as the default to write. */
  period: string;
  zh: boolean;
  busy: boolean;
  generating: boolean;
  onGenerate: (period: string) => void;
  onSave: (reportId: string, body: string) => void;
  onShare: (reportId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [openId, setOpenId] = useState<string | null>(reports[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const open = reports.find((r) => r.id === openId) ?? reports[0] ?? null;

  // The list can change underneath — a new report, a fork — and the opened one
  // should follow rather than vanish.
  const [seen, setSeen] = useState(reports);
  if (seen !== reports) {
    setSeen(reports);
    if (!reports.some((r) => r.id === openId)) {
      setOpenId(reports[0]?.id ?? null);
      setEditing(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", minHeight: 0 }}>
      {/* ---- the months ---- */}
      <div style={{ width: 232, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Monthly reports", "月度报告")}</span>
        </div>

        <button
          type="button"
          disabled={busy || generating}
          onClick={() => onGenerate(period)}
          style={{ ...solid, width: "100%", marginBottom: 12, opacity: busy || generating ? 0.5 : 1 }}
        >
          {generating ? t("Writing…", "撰写中…") : t(`Write ${period}`, `撰写 ${period}`)}
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {reports.map((r) => {
            const on = r.id === open?.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setOpenId(r.id);
                  setEditing(false);
                }}
                style={{
                  textAlign: "left",
                  border: 0,
                  borderRadius: 8,
                  padding: "8px 10px",
                  cursor: "pointer",
                  background: on ? "#f3f3f3" : "transparent",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ display: "block", fontSize: 12.5, fontWeight: on ? 500 : 400 }}>{r.period}</span>
                <span style={{ display: "block", fontSize: 11, color: "#999999", marginTop: 2 }}>
                  {r.state === "shared"
                    ? `${t("Shared", "已分享")} ${r.sharedAt ? r.sharedAt.toISOString().slice(0, 10) : ""}`
                    : t("Draft · not shared", "草稿 · 未分享")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- the report ---- */}
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        {!open ? (
          <Empty
            title={t("No reports yet", "还没有报告")}
            body={t(
              "Write one and it appears here: a page about the month, from the studio's own figures, for you to edit before anyone reads it.",
              "生成一份后就会出现在这里：基于工作室自己的数据写成的月度说明，你可以先修改再给别人看。",
            )}
          />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{open.title}</span>
              <Badge tone={open.state === "shared" ? "good" : "quiet"}>
                {open.state === "shared" ? t("shared", "已分享") : t("draft", "草稿")}
              </Badge>

              <span style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
                {editing ? (
                  <>
                    <button type="button" onClick={() => setEditing(false)} style={ghost} disabled={busy}>
                      {t("Cancel", "取消")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onSave(open.id, draft);
                        setEditing(false);
                      }}
                      style={solid}
                    >
                      {open.state === "shared"
                        ? t("Save as a new draft", "另存为新草稿")
                        : t("Save", "保存")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy || generating}
                      onClick={() => onGenerate(open.period)}
                      style={ghost}
                      title={t(
                        "Writes a fresh draft for this period from today's figures. The existing one is kept.",
                        "按今天的数据为该期间重新生成草稿，原有的会保留。",
                      )}
                    >
                      {t("Regenerate", "重新生成")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDraft(open.body);
                        setEditing(true);
                      }}
                      style={ghost}
                    >
                      {t("Edit", "编辑")}
                    </button>
                    {open.state !== "shared" ? (
                      <button type="button" disabled={busy} onClick={() => onShare(open.id)} style={solid}>
                        {t("Share", "分享")}
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            </div>

            <p style={{ fontSize: 11, color: "#999999", margin: "0 0 14px", lineHeight: 1.6, maxWidth: 620 }}>
              {t(
                "Every figure here is the figure that was true when this was written. It does not follow the dashboard afterwards — that is what makes it a record.",
                "这里的每个数字都是撰写当时的数字，之后不会随仪表盘变化，这正是它作为记录的意义。",
              )}
            </p>

            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                style={{
                  ...field,
                  width: "100%",
                  minHeight: 460,
                  padding: 14,
                  lineHeight: 1.7,
                  fontSize: 13,
                  resize: "vertical",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              />
            ) : (
              <div
                style={{
                  border: "1px solid #ededed",
                  borderRadius: 12,
                  padding: "18px 22px",
                  maxWidth: 760,
                  fontSize: 13.5,
                  lineHeight: 1.75,
                  color: "#383838",
                }}
              >
                <Markdown text={open.body} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
