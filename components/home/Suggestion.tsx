"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Fold } from "@/components/ui/Fold";
import { Icon } from "@/components/ui/Icon";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { EvidenceChips, Facts, StartedNotice, TopicRow, smallBtn } from "@/components/home/TopicRow";
import { DetailLink } from "@/components/home/DetailLink";
import { notify } from "@/lib/client/notify";

export type TodaySuggestion = {
  title: string;
  why: string | null;
  hook: string | null;
  strength: number | null;
  evidence: { label: string; url: string | null; numbers: string }[];
  /** Which brief and which of its signals, so the server reads the right one (an old card must not open today's). */
  signal?: { date: string; index: number } | null;
};

/**
 * Today's suggested video, from the morning brief: one or two topics with
 * the reason and the evidence, and the presses that turn one into work.
 *
 * Drawn like the ideas above it (`TopicRow` in a `Fold`): a row each with
 * the strength, the title, one grey line of why, how much evidence, and the
 * two presses; the full why, the opening and the evidence open in place.
 *
 * Both presses go through `startFromTopicAction` with the signal (its
 * brief's date and place, or its title in the latest brief), so the project
 * gets the brief's why, hook, angle and evidence rather than a chat command,
 * and the same signal pressed twice opens the same project. Then the card
 * asks where to go (the script being written, the project) or to stay:
 * Home is where the person was working.
 */
export function SuggestionCard({ items, zh, canResearch = false }: { items: TodaySuggestion[]; zh: boolean; canResearch?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);
  const [started, setStarted] = React.useState<Record<number, { projectId: string; scriptId: string | null; writing: boolean; existed: boolean }>>({});
  if (!items.length) return null;
  const go = (s: TodaySuggestion, i: number, withScript: boolean) => {
    if (busy) return;
    setBusy(`${i}:${withScript ? "w" : "c"}`);
    void (async () => {
      try {
        const r = await startFromTopicAction({ kind: "signal", date: s.signal?.date ?? null, index: s.signal?.index ?? i, title: s.title }, { write: withScript });
        if ("error" in r && r.error) {
          notify(r.error);
          return;
        }
        if ("projectId" in r && r.projectId) {
          setStarted((m) => ({ ...m, [i]: { projectId: r.projectId, scriptId: r.scriptId ?? null, writing: Boolean(r.writing), existed: Boolean(r.existed) } }));
          if (r.note) notify(r.note, "info");
          /* The sidebar's project list, quietly; the card keeps its state. */
          router.refresh();
        }
      } finally {
        setBusy(null);
      }
    })();
  };
  return (
    <Fold
      id="home-suggestion"
      title={t("今天建议拍", "Suggested for today")}
      sub={t("来自研究员的晨报", "from the researcher's morning brief")}
      icon={<AgentIcon agent="research" size={18} radius={5} />}
      resizable={false}
      flush
      right={canResearch ? <DetailLink zh={zh} href="/research" label="查看研究" labelEn="See the research" /> : null}
    >
      {items.map((s, i) => {
        const done = started[i];
        const hasMore = Boolean(s.why || s.hook || s.evidence.length);
        return (
          <TopicRow
            key={i}
            first={i === 0}
            open={open === i}
            onToggle={hasMore ? () => setOpen((cur) => (cur === i ? null : i)) : undefined}
            strength={s.strength}
            strengthTitle={t("信号强度", "Signal strength")}
            title={s.title}
            /* How much evidence leads the grey line rather than sitting as
               a tag beside the two presses: at 1280 the tag cost the title
               its last words. */
            line={
              s.why || s.evidence.length ? (
                <>
                  {s.evidence.length ? (
                    <span title={s.evidence.map((e) => `${e.label} ${e.numbers}`.trim()).join(" · ")} style={{ color: "#6b6b6b" }}>
                      {t(`${s.evidence.length} 条证据`, `${s.evidence.length} sources`)}
                      {s.why ? " · " : ""}
                    </span>
                  ) : null}
                  {s.why}
                </>
              ) : null
            }
            action={
              done ? null : (
                <>
                  {/* 编剧's tint, as on the ideas: the start press, without
                      another black block in a column that already has 开工. */}
                  <button type="button" className="ip-go" disabled={busy !== null} onClick={() => go(s, i, true)} title={t("做成项目并写脚本", "Make it a project, write the script")} style={{ ...smallBtn(), opacity: busy === `${i}:w` ? 0.6 : 1 }}>
                    <Icon name="pen" size={12} /> {busy === `${i}:w` ? t("开项目…", "Starting…") : t("开项目", "Start")}
                  </button>
                  <button type="button" className="ip-quiet" disabled={busy !== null} onClick={() => go(s, i, false)} title={t("做成项目，上传素材", "Make it a project, upload clips")} style={{ ...smallBtn(), opacity: busy === `${i}:c` ? 0.6 : 1 }}>
                    <Icon name="upload" size={12} /> {busy === `${i}:c` ? t("开项目…", "Starting…") : t("传素材", "Upload")}
                  </button>
                </>
              )
            }
            notice={
              done ? (
                <StartedNotice
                  zh={zh}
                  title={s.title}
                  projectId={done.projectId}
                  scriptId={done.scriptId}
                  writing={done.writing}
                  existed={done.existed}
                  onStay={() =>
                    setStarted((m) => {
                      const next = { ...m };
                      delete next[i];
                      return next;
                    })
                  }
                />
              ) : null
            }
          >
            <Facts
              rows={[
                [t("理由", "Why now"), s.why ? <span style={{ color: "#525252" }}>{s.why}</span> : null],
                [t("开头", "Opening"), s.hook ? <span style={{ color: "#525252" }}>{t(`「${s.hook}」`, `“${s.hook}”`)}</span> : null],
                [t("证据", "Evidence"), s.evidence.length ? <EvidenceChips items={s.evidence} /> : null],
              ]}
            />
          </TopicRow>
        );
      })}
    </Fold>
  );
}
