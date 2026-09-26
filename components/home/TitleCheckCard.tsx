"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { EvidenceChips, Facts, StartedNotice, Strength, btn, tintBtn } from "@/components/home/TopicRow";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import type { CheckLevel, TitleCheck } from "@/lib/ideas/check-types";

/**
 * 研究员's answer to a topic typed into Home's task box, as a short
 * conversation under the box.
 *
 * The client's gap: a typed title "just goes straight to script generation"
 * with no research on it. So the box sends a new-project topic here first
 * (`/api/ideas/check`, see `lib/ideas/check.ts`), and the card says what
 * 研究员 found: one verdict line with numbers, three titles to pick from, and
 * behind "依据" the angle, the opening, the evidence and the videos on the
 * subject that did well. The person then
 *
 *   - starts the project with the picked title (`startFromTopicAction` on the
 *     stored idea, so 编剧 writes from the researched title, angle and
 *     evidence) and gets the usual stay-or-open notice;
 *   - or answers back ("换个角度", "再短一点") and the card is redone in
 *     place, the last three turns kept as a thin thread;
 *   - or skips it: "直接开项目" starts the project from the words as typed,
 *     the way the box always did (`onDirect`).
 *
 * Not a wall of text: the details are behind one press, and once a project
 * is started the card folds to a single row.
 *
 * Remounted per question (the parent's `key`), so every new topic starts a
 * fresh card; the first check is fired on mount and aborted if the card goes
 * away, the later rounds by the person's own presses.
 */

type Turn = { you: string; reply: string | null; error?: string | null };
type Started = { projectId: string; scriptId: string | null; writing: boolean; existed: boolean; title: string };

export type CheckAsk = {
  /** The box's text as typed, tags and all: what "直接开项目" starts with. */
  original: string;
  /** The topic without the tags, as the thread shows it. */
  text: string;
  nonce: number;
};

/** The quick answers under the card; each one is sent as it reads. */
const QUICK: [string, string][] = [
  ["换个角度", "Another angle"],
  ["再短一点", "Shorter"],
  ["更适合抖音", "Better for Douyin"],
];

/** Verdict pills in the palette's light tints. */
const LEVEL: Record<CheckLevel, { zh: string; en: string; fg: string; bg: string }> = {
  hot: { zh: "热", en: "Hot", fg: "#b3420e", bg: "#fdeee4" },
  warm: { zh: "温", en: "Warm", fg: "#8a5a00", bg: "#fbf2da" },
  cold: { zh: "冷", en: "Cold", fg: "#2d5c9e", bg: "#e9f1fb" },
  crowded: { zh: "扎堆", en: "Crowded", fg: "#6a3fc4", bg: "#efe9fb" },
};

async function postCheck(zh: boolean, body: unknown, signal: AbortSignal): Promise<{ check?: TitleCheck; error?: string }> {
  try {
    const r = await fetch("/api/ideas/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const j = (await r.json().catch(() => ({}))) as { check?: TitleCheck; error?: string };
    if (!r.ok || !j.check) return { error: j.error ?? (zh ? "研究员这次没看完，再试一次。" : "The researcher could not finish this time; try again.") };
    return { check: j.check };
  } catch {
    if (signal.aborted) return {};
    return { error: zh ? "连不上服务器，再试一次。" : "Could not reach the server; try again." };
  }
}

export function TitleCheckCard({
  zh,
  ask,
  canWrite,
  onDirect,
  onClose,
}: {
  zh: boolean;
  ask: CheckAsk;
  /** Whether the viewer holds Script, so the start press can promise a draft. */
  canWrite: boolean;
  /** Start the project from the words as typed; true once it is made. */
  onDirect: (original: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [check, setCheck] = React.useState<TitleCheck | null>(null);
  const [turns, setTurns] = React.useState<Turn[]>([{ you: ask.text, reply: null }]);
  const [busy, setBusy] = React.useState(true);
  const [elapsed, setElapsed] = React.useState(0);
  const [chosen, setChosen] = React.useState(0);
  const [details, setDetails] = React.useState(false);
  const [say, setSay] = React.useState("");
  const [starting, setStarting] = React.useState<"idea" | "direct" | null>(null);
  const [started, setStarted] = React.useState<Started | null>(null);
  const [notice, setNotice] = React.useState(false);
  const [direct, setDirect] = React.useState(false);
  const [unfolded, setUnfolded] = React.useState(false);
  const ctl = React.useRef<AbortController | null>(null);
  const groupName = React.useId();

  /* An answer for turn `at`, unless that request was given up on meanwhile
     (the card closed, the person skipped, another round was asked). */
  const settle = React.useCallback((res: { check?: TitleCheck; error?: string }, at: number, signal: AbortSignal) => {
    if (signal.aborted) return;
    setBusy(false);
    if (res.check) {
      const c = res.check;
      setCheck(c);
      setChosen(0);
      setTurns((list) => list.map((x, i) => (i === at ? { ...x, reply: c.reply, error: null } : x)));
    } else {
      setTurns((list) => list.map((x, i) => (i === at ? { ...x, error: res.error ?? null } : x)));
    }
  }, []);

  /* The first check, once per card. */
  React.useEffect(() => {
    const c = new AbortController();
    ctl.current = c;
    void postCheck(zh, { text: ask.original }, c.signal).then((res) => settle(res, 0, c.signal));
    return () => c.abort();
  }, [ask.original, zh, settle]);

  /* The seconds on the progress line, only while 研究员 is working. */
  React.useEffect(() => {
    if (!busy) return;
    const from = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - from) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  /**
   * Another round, or the same one again after a failure (`retryAt`).
   *
   * Turn 0 is the topic itself; every later turn is a line about the last
   * answer, sent with that answer's idea (which the server reads and
   * rewrites) and the lines said before it.
   */
  function send(line: string, retryAt?: number) {
    if (busy || starting) return;
    const retry = retryAt !== undefined;
    const at = retry ? retryAt : turns.length;
    const words = retry ? (turns[at]?.you ?? "") : line.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!words) return;
    const body =
      at === 0 || !check
        ? { text: ask.original }
        : { text: ask.original, previous: { id: check.idea.id, instructions: turns.slice(1, at).map((x) => x.you), groups: check.groups }, instruction: words };
    if (retry) setTurns((list) => list.map((x, i) => (i === at ? { ...x, error: null } : x)));
    else {
      setTurns((list) => [...list, { you: words, reply: null }]);
      setSay("");
    }
    setBusy(true);
    setElapsed(0);
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    void postCheck(zh, body, c.signal).then((res) => settle(res, at, c.signal));
  }

  async function startIdea() {
    if (!check || starting || busy) return;
    setStarting("idea");
    try {
      const title = check.options[chosen]?.title ?? check.idea.title;
      /* The picked title becomes the idea's own first: the project, its
         script and the draft all read the title from the stored idea. */
      if (title !== check.idea.title) {
        const r = await fetch("/api/ideas/check", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: check.idea.id, title }) }).catch(() => null);
        if (!r?.ok) {
          notify(t("没能换成这个标题，再试一次。", "Could not switch to that title; try again."));
          return;
        }
      }
      const res = await startFromTopicAction({ kind: "idea", id: check.idea.id }, { write: true });
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      if ("projectId" in res && res.projectId) {
        setStarted({ projectId: res.projectId, scriptId: res.scriptId ?? null, writing: Boolean(res.writing), existed: Boolean(res.existed), title });
        setNotice(true);
        setUnfolded(false);
        if (res.note) notify(res.note, "info");
        /* The sidebar's project list, quietly; this card keeps its state. */
        router.refresh();
      }
    } finally {
      setStarting(null);
    }
  }

  async function startDirect() {
    if (starting) return;
    setStarting("direct");
    try {
      const ok = await onDirect(ask.original);
      if (ok) {
        /* No longer waiting on 研究员: the check (if still running) finishes
           on the server and lands in the ideas panel. */
        ctl.current?.abort();
        setBusy(false);
        setDirect(true);
        setUnfolded(false);
      }
    } finally {
      setStarting(null);
    }
  }

  const stage =
    elapsed < 8
      ? t("研究员正在查热榜和对标…", "The researcher is checking the lists and rivals…")
      : elapsed < 18
        ? t("对照本频道的数据和选题储备…", "Checking the channel's numbers and the backlog…")
        : elapsed < 45
          ? t("研究员在比较标题…", "Weighing the titles…")
          : t("快好了，核对证据里的数字…", "Nearly there, checking the numbers…");

  /* ---- folded: one row once a project exists ---- */
  const done = started || direct;
  if (done && !unfolded) {
    return (
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        {started && notice ? (
          <StartedNotice zh={zh} title={started.title} projectId={started.projectId} scriptId={started.scriptId} writing={started.writing} existed={started.existed} onStay={() => setNotice(false)} />
        ) : (
          <div role="status" className="tc-fold">
            <AgentIcon agent="research" size={18} radius={5} />
            <span style={{ minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "#3d3d3d" }}>
              {started ? (
                <>
                  <Icon name="check" size={12} color="#278f5e" /> {t(`已按研究员的标题开项目：《${started.title}》`, `Started with the researcher's title: “${started.title}”`)}
                  {started.writing ? <span style={{ color: "#8a8a8a" }}>{t(" · 编剧在写初稿", " · the writer is drafting")}</span> : null}
                </>
              ) : (
                <span style={{ color: "#7c7c7c" }}>{t(`「${ask.text}」已直接开项目，没用研究员的标题`, `“${ask.text}” started as typed, without the researcher's titles`)}</span>
              )}
            </span>
            {started ? (
              <Link prefetch={false} href={`/projects/${started.projectId}`} className="ip-quiet" style={{ ...tintBtn(), height: 26, padding: "0 10px", textDecoration: "none" }}>
                {t("打开项目", "Open")}
              </Link>
            ) : null}
            {check ? (
              <button type="button" className="tc-link" onClick={() => setUnfolded(true)}>
                {t("看判断", "See the check")}
              </button>
            ) : null}
            <CloseButton zh={zh} onClick={onClose} />
          </div>
        )}
      </div>
    );
  }

  const shownTurns = turns.slice(-3);
  const firstIndex = turns.length - shownTurns.length;
  const lastTurn = turns[turns.length - 1];
  const failed = !busy && Boolean(lastTurn?.error);
  const level = check ? LEVEL[check.verdict.level] : null;
  const disabled = busy || starting !== null || Boolean(done);

  return (
    <section aria-label={t("研究员对你的选题的判断", "The researcher's check on your topic")} className="tc">
      {/* ---- head: who, and how strong ---- */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#f6f9fd", borderBottom: "1px solid #e8eef7" }}>
        <AgentIcon agent="research" size={20} radius={6} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#171717", flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {check ? t("你的选题 · 研究员看过了", "Your topic · checked by the researcher") : failed ? t("你的选题 · 研究员没看完", "Your topic · the check did not finish") : t("你的选题 · 研究员在看", "Your topic · the researcher is on it")}
        </span>
        {check?.idea.strength ? <Strength n={check.idea.strength} title={t("研究员觉得有多强", "How strong the researcher thinks it is")} size={5} /> : null}
        {done ? (
          <button type="button" className="tc-link" onClick={() => setUnfolded(false)}>
            {t("收起", "Fold")}
          </button>
        ) : null}
        <CloseButton zh={zh} onClick={onClose} />
      </div>

      <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* ---- the thread: the person's line, 研究员's short reply ---- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {shownTurns.map((turn, k) => {
            const at = firstIndex + k;
            const working = busy && at === turns.length - 1;
            return (
              <React.Fragment key={at}>
                <div className="tc-line">
                  <span className="tc-who">{t("你", "You")}</span>
                  <span style={{ color: "#171717", minWidth: 0 }}>{turn.you}</span>
                </div>
                <div className="tc-line">
                  <span className="tc-who">
                    <AgentIcon agent="research" size={14} radius={4} />
                  </span>
                  {working ? (
                    <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, color: "#2b343d" }}>
                      <span className="tc-pulse" />
                      <span style={{ minWidth: 0 }}>{stage}</span>
                      <span style={{ fontSize: 11.5, color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>{t(`${elapsed} 秒`, `${elapsed}s`)}</span>
                    </span>
                  ) : turn.error ? (
                    <span style={{ color: "#c42b2b", minWidth: 0 }}>
                      {turn.error}{" "}
                      {at === turns.length - 1 && !done ? (
                        <button type="button" className="tc-link" style={{ color: "#c42b2b" }} onClick={() => send("", at)}>
                          {t("重试", "Retry")}
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <span style={{ color: "#3d4650", minWidth: 0 }}>{turn.reply ?? "—"}</span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {check ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: busy ? 0.55 : 1, transition: "opacity .15s ease" }}>
            {/* ---- the verdict, with its numbers ---- */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              {level ? (
                <span className="tc-pill" style={{ color: level.fg, background: level.bg }}>
                  {zh ? level.zh : level.en}
                </span>
              ) : null}
              <span style={{ fontSize: 12.5, lineHeight: "20px", color: "#2b343d", minWidth: 0 }}>
                {check.verdict.line}
                {check.thin ? <span style={{ color: "#8a8a8a" }}>{t("（存下来的数据少，仅供参考）", " (little stored data; take it as a hint)")}</span> : null}
              </span>
            </div>
            {check.risk ? (
              <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: "18px", color: "#8a5a00" }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "#e0a420", marginTop: 6, flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>{t(`注意：${check.risk}`, `Mind: ${check.risk}`)}</span>
              </div>
            ) : null}

            {/* ---- three titles, one to pick ---- */}
            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} disabled={disabled}>
              <legend style={{ fontSize: 11.5, color: "#a3a3a3", padding: 0, marginBottom: 4 }}>{t("选一个标题", "Pick a title")}</legend>
              <div style={{ display: "flex", flexDirection: "column", border: "1px solid #eeeeee", borderRadius: 10, overflow: "hidden" }}>
                {check.options.map((o, i) => (
                  <label key={i} className={i === chosen ? "tc-opt tc-opt-on" : "tc-opt"} style={{ borderTop: i ? "1px solid #f1f1f1" : "none" }}>
                    <input type="radio" className="tc-radio" name={groupName} checked={i === chosen} onChange={() => setChosen(i)} />
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: "20px", color: "#171717" }}>{o.title}</span>
                      {o.why ? <span style={{ fontSize: 12, lineHeight: "18px", color: "#8a8a8a" }}>{o.why}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ---- what it stands on, behind one press ---- */}
            <div>
              <button type="button" className="tc-link" aria-expanded={details} onClick={() => setDetails((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: details ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>
                  <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                </svg>
                {t("依据", "What it stands on")}
                <span style={{ color: "#a3a3a3" }}>
                  {t(` · 证据 ${check.evidence.length} 条${check.similar.length ? ` · 对标 ${check.similar.length} 个` : ""}`, ` · ${check.evidence.length} evidence${check.similar.length ? ` · ${check.similar.length} similar` : ""}`)}
                </span>
              </button>
              {details ? (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#fafbfd", border: "1px solid #eef1f6", borderRadius: 10 }}>
                  <Facts
                    rows={[
                      [t("角度", "Angle"), check.idea.angle],
                      [t("开头", "Opening"), check.idea.hook ? <span style={{ color: "#525252" }}>{t(`「${check.idea.hook}」`, `“${check.idea.hook}”`)}</span> : null],
                      [t("形式", "Format"), check.idea.format],
                      [t("证据", "Evidence"), check.evidence.length ? <EvidenceChips items={check.evidence} /> : <span style={{ color: "#8a8a8a" }}>{t("存下来的数据里没有直接证据", "No direct evidence in the stored data")}</span>],
                      [t("对标", "Did well"), check.similar.length ? <EvidenceChips items={check.similar} /> : null],
                      [t("检索词", "Searched"), check.terms.length ? <span style={{ color: "#525252" }}>{check.terms.join(" + ")}</span> : null],
                      [
                        t("查了", "Read"),
                        <span key="scan" style={{ color: "#8a8a8a" }}>
                          {t(
                            `存下来的 ${check.scanned.lists} 个榜 ${check.scanned.snapshots} 份快照，直接相关 ${check.scanned.related} 条 · 本频道 ${check.scanned.channel} 条视频 · 晨报 · 选题储备`,
                            `${check.scanned.snapshots} stored snapshots of ${check.scanned.lists} lists, ${check.scanned.related} directly on it · ${check.scanned.channel} channel videos · the brief · the backlog`,
                          )}
                        </span>,
                      ],
                    ]}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ---- the presses: start with the picked title, or as typed ---- */}
        {done ? null : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {check ? (
              <button type="button" onClick={() => void startIdea()} disabled={disabled} style={{ ...btn(true), height: 32, padding: "0 14px", fontSize: 12.5, opacity: disabled && starting !== "idea" ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>
                <Icon name="pen" size={13} />
                {starting === "idea" ? t("正在开项目…", "Starting…") : canWrite ? t("用这个标题开项目并写脚本", "Start with this title and write the script") : t("用这个标题开项目", "Start with this title")}
              </button>
            ) : null}
            <button type="button" className="ip-quiet" onClick={() => void startDirect()} disabled={starting !== null} title={t("不用研究员的标题，按你写的开项目", "Skip the check and start from your words")} style={{ ...tintBtn(), height: 32, cursor: starting ? "default" : "pointer" }}>
              {starting === "direct" ? t("正在开项目…", "Starting…") : busy && !check ? t("不等了，直接开项目", "Don't wait, start as typed") : t("直接开项目", "Start as typed")}
            </button>
          </div>
        )}

        {/* ---- answer back: the card is redone in place ---- */}
        {check && !done ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(say);
            }}
            style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid #f1f1f1" }}
          >
            {QUICK.map(([a, b]) => (
              <button key={a} type="button" className="tc-quick" disabled={busy || starting !== null} onClick={() => send(a)}>
                {zh ? a : b}
              </button>
            ))}
            <input
              value={say}
              onChange={(e) => setSay(e.target.value)}
              disabled={busy || starting !== null}
              maxLength={120}
              aria-label={t("跟研究员说", "Tell the researcher")}
              placeholder={t("换个角度 / 再短一点 / 更适合抖音…", "Another angle / shorter / better for Douyin…")}
              style={{ flex: "1 1 180px", minWidth: 0, height: 30, border: "1px solid #e4e4e4", borderRadius: 8, padding: "0 10px", fontFamily: "inherit", fontSize: 12.5, outline: "none", background: busy ? "#fafafa" : "#fff" }}
            />
            <button type="submit" className="ip-quiet" disabled={busy || starting !== null || !say.trim()} style={{ ...tintBtn(), height: 30, cursor: busy || !say.trim() ? "default" : "pointer" }}>
              {t("发给研究员", "Send")}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function CloseButton({ zh, onClick }: { zh: boolean; onClick: () => void }) {
  return (
    <button type="button" className="tc-x" aria-label={zh ? "关掉" : "Close"} title={zh ? "关掉" : "Close"} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
      </svg>
    </button>
  );
}

/** Drawn once by Home, beside `IDEAS_CSS`. */
export const TITLE_CHECK_CSS = `
.tc { margin-top: 8px; border: 1px solid #dfe6f1; border-radius: 14px; background: #fff; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
.tc-fold { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid #e6ebf2; border-radius: 12px; background: #fbfcfe; min-width: 0; }
.tc-line { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; line-height: 20px; min-width: 0; }
.tc-who { width: 18px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; color: #a3a3a3; }
.tc-pulse { width: 7px; height: 7px; border-radius: 4px; background: #0f5bd5; flex-shrink: 0; animation: auraPulse 1.6s ease-in-out infinite; }
.tc-pill { flex-shrink: 0; font-size: 11.5px; font-weight: 600; line-height: 20px; padding: 0 8px; border-radius: 999px; white-space: nowrap; }
.tc-opt { display: flex; align-items: flex-start; gap: 10px; padding: 8px 11px; cursor: pointer; transition: background-color .15s ease; }
.tc-opt:hover { background: #fafafa; }
.tc-opt-on, .tc-opt-on:hover { background: #f6f9fd; }
fieldset:disabled .tc-opt { cursor: default; }
.tc-radio { appearance: none; -webkit-appearance: none; width: 15px; height: 15px; margin: 3px 0 0; flex-shrink: 0; border: 1.5px solid #c7c7c7; border-radius: 50%; background: #fff; cursor: inherit; transition: border-color .15s ease, box-shadow .15s ease; }
.tc-radio:checked { border-color: #171717; background: #171717; box-shadow: inset 0 0 0 3px #fff; }
.tc-radio:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
.tc-link { border: 0; background: transparent; padding: 0; font: inherit; font-size: 12px; color: #525252; cursor: pointer; white-space: nowrap; }
.tc-link:hover { color: #171717; text-decoration: underline; text-underline-offset: 2px; }
.tc-link:focus-visible { outline: 2px solid #171717; outline-offset: 2px; border-radius: 4px; }
.tc-quick { height: 26px; padding: 0 9px; border: 1px solid #e3e9f3; border-radius: 999px; background: #f6f9fd; font: inherit; font-size: 12px; color: #2b343d; cursor: pointer; white-space: nowrap; transition: background-color .15s ease, border-color .15s ease; }
.tc-quick:hover:not(:disabled) { background: #eaf1fb; border-color: #d0dcee; }
.tc-quick:disabled { opacity: .55; cursor: default; }
.tc-quick:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
.tc-x { width: 24px; height: 24px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: #a3a3a3; cursor: pointer; }
.tc-x:hover { background: #eef1f6; color: #171717; }
.tc-x:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
.hc-hint { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; padding: 0 2px; border: 0; background: transparent; font: inherit; font-size: 12px; color: #525252; cursor: pointer; }
.hc-hint:hover { color: #0f5bd5; }
.hc-hint:focus-visible { outline: 2px solid #171717; outline-offset: 2px; border-radius: 4px; }
@media (prefers-reduced-motion: reduce) { .tc-pulse { animation: none; } }
`;
