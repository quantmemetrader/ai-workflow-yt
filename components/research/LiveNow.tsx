"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useLocalPreference } from "@/lib/client/preference";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS } from "@/lib/agents/catalog";
import { PLATFORMS, type HotRow, type PlatformKey } from "@/lib/research/platform-catalog";
import { judgeHotAction, platformHotAction } from "@/app/(app)/research/platform-actions";
import { startProposalAction } from "@/app/(app)/home/actions";
import type { Judged } from "@/lib/research/judge";
import { notify } from "@/lib/client/notify";

/**
 * What is hot right now, on whichever platform, read by 研究员.
 *
 * Three things, top to bottom:
 *
 *   1. The platform switch — Google + YouTube for the region, then each of
 *      抖音, 小红书, 微博, B站 and TikTok on its own tab (metered, read when
 *      picked, cached half an hour). WeChat has no public list and says so.
 *   2. What 研究员 picked this morning, with the two presses that follow:
 *      write the script, or watch the topic.
 *   3. The platform's own list as a table: cover, title, the platform's own
 *      heat, and — the column that makes it research rather than a feed —
 *      研究员's mark on the rows that are this channel's business, with the
 *      reason on the side when a row is picked.
 *
 * Every number is the platform's; every mark cites the channel's own data.
 */
export type LiveSearch = { phrase: string; traffic: string | null; headline: string | null; region?: string };
export type LiveVideo = { id: string; title: string; channelTitle: string; thumbnail: string | null; views: number };
export type Pick = { text: string; why: string | null; source: "digest" | "plan" | "backlog" | "audience" };

const KEY = "aura:research:livenow";
const PLATFORM_KEY = "aura:research:platform";

type Tab = "live" | PlatformKey;
const TABS: readonly Tab[] = ["live", ...PLATFORMS.filter((p) => p.key !== "google" && p.key !== "youtube").map((p) => p.key)];

/** Pictures come through this app, not straight from the platform: the CDNs
 *  are unreachable from mainland China and a fair number of office networks. */
export const throughUs = (url: string | null) => (url ? `/api/img?u=${encodeURIComponent(url)}` : null);

type Loaded = { rows: HotRow[]; note: string | null };

export function LiveNow({
  searches,
  videos,
  region,
  zh,
  onWatch,
  note,
  picks,
  canWriteScripts,
}: {
  searches: LiveSearch[];
  videos: LiveVideo[];
  region: string;
  zh: boolean;
  onWatch: (phrase: string) => void;
  note?: string | null;
  /** What 研究员 and 策划 already proposed, from the brief and the plan. */
  picks: Pick[];
  canWriteScripts: boolean;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [, start] = React.useTransition();
  const [state, setState] = useLocalPreference<"open" | "shut">(KEY, ["open", "shut"], "open");
  const open = state === "open";
  const [tab, setTab] = useLocalPreference<Tab>(PLATFORM_KEY, TABS, "live");

  const [loaded, setLoaded] = React.useState<Partial<Record<PlatformKey, Loaded>>>({});
  const [judged, setJudged] = React.useState<Partial<Record<Tab, Judged>>>({});
  const [selected, setSelected] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState<string | null>(null);

  /* The list first, then 研究员's reading of it. */
  /* One read per platform per visit. "Loading" is derived — a tab that is
     open and has nothing loaded is loading — rather than set from the effect. */
  const loading: PlatformKey | null = open && tab !== "live" && !loaded[tab] ? tab : null;
  React.useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    const key = loading;
    void platformHotAction(key).then((res) => {
      if (cancelled) return;
      setLoaded((m) => ({ ...m, [key]: "error" in res ? { rows: [], note: res.error } : { rows: res.rows, note: res.note } }));
    });
    return () => {
      cancelled = true;
    };
  }, [loading]);

  const rowsReady = tab === "live" ? videos.length > 0 : Boolean(loaded[tab]?.rows.length);
  /* Same shape for the reading: it is being made whenever rows are on
     screen and no judgement has landed for them. */
  const judging: Tab | null = open && rowsReady && !judged[tab] ? tab : null;
  React.useEffect(() => {
    if (!judging) return;
    let cancelled = false;
    const key = judging;
    void judgeHotAction(key === "live" ? "youtube" : key).then((res) => {
      if (cancelled) return;
      setJudged((m) => ({ ...m, [key]: "error" in res ? {} : res.judged }));
    });
    return () => {
      cancelled = true;
    };
  }, [judging]);

  if (searches.length === 0 && videos.length === 0 && !note && tab === "live" && picks.length === 0) return null;

  const meta = tab === "live" ? null : (PLATFORMS.find((p) => p.key === tab) ?? null);
  const rows: HotRow[] =
    tab === "live"
      ? videos.map((v) => ({
          phrase: v.title,
          heat: v.views,
          heatLabel: null,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail: v.thumbnail,
          extra: v.channelTitle,
        }))
      : (loaded[tab]?.rows ?? []);
  const marks = judged[tab] ?? {};
  const maxHeat = rows.reduce((m, r) => Math.max(m, r.heat ?? 0), 0);
  const platformName = tab === "live" ? "YouTube" : zh ? meta!.zh : meta!.label;
  const picked = selected ? (rows.find((r) => r.phrase === selected) ?? null) : null;
  const marked = rows.filter((r) => marks[r.phrase]).length;
  const narrow = picked !== null;
  const cols = narrow ? COLS_COMPACT : COLS;

  function writeScript(text: string, id: string) {
    if (sending) return;
    setSending(id);
    start(async () => {
      const res = await startProposalAction("script", text);
      setSending(null);
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      notify(t("Handed to the Writer; it answers in #制作", "已交给编剧，在 #制作 里回复"), "ok");
      router.refresh();
    });
  }

  return (
    <div style={{ flexShrink: 0, borderBottom: "1px solid #ededed", background: "#fcfcfc" }}>
      {/* ---- the switch ------------------------------------------------ */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 20px 0", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setState(open ? "shut" : "open")}
          aria-expanded={open}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, border: 0, background: "transparent", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "#7c7c7c", fontFamily: "inherit" }}
        >
          <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, fill: "none", stroke: "#7c7c7c", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s linear" }}>
            <path d="m9 5 7 7-7 7" />
          </svg>
          {t("Right now", "此刻")}
        </button>

        {open ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {TABS.map((key) => {
              const p = key === "live" ? null : PLATFORMS.find((x) => x.key === key)!;
              const on = tab === key;
              const off = p?.unavailable ?? false;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTab(key);
                    setSelected(null);
                  }}
                  aria-pressed={on}
                  title={off ? t("No public list", "没有公开热榜") : undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 26,
                    padding: "0 10px",
                    borderRadius: 999,
                    border: `1px ${off ? "dashed" : "solid"} ${on ? "#171717" : "#dddddd"}`,
                    background: on ? "#171717" : "#ffffff",
                    color: on ? "#ffffff" : off ? "#b3b3b3" : "#525252",
                    fontSize: 11.5,
                    fontWeight: on ? 500 : 400,
                    fontFamily: "inherit",
                    letterSpacing: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {p ? <PlatformMark platform={p.key} size={11} mono={on} /> : null}
                  {key === "live" ? `${region} · Google + YouTube` : zh ? p!.zh : p!.label}
                  {off ? <span style={{ fontSize: 10.5 }}>· {t("no list", "无公开热榜")}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <span style={{ flexGrow: 1 }} />
        {open ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#7c7c7c" }}>
            <AgentIcon agent="research" size={14} radius={4} />
            {judging === tab
              ? t("Researcher is reading this list…", "研究员正在读这份榜…")
              : judged[tab]
                ? marked
                  ? t(`Researcher marked ${marked} for this channel`, `研究员标了 ${marked} 条跟频道有关的`)
                  : t("Researcher found nothing for this channel here", "研究员没看到跟频道有关的")
                : ""}
          </span>
        ) : null}
      </div>

      {!open ? <div style={{ height: 8 }} /> : null}

      {open ? (
        <div style={{ padding: "10px 20px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* ---- what was picked this morning --------------------------- */}
          {picks.length ? (
            <div style={{ border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "10px 14px 4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                <AgentIcon agent="research" size={18} radius={5} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("Picked for today", "今天挑出来的选题")}</span>
                <span style={{ fontSize: 11.5, color: "#999999" }}>{t("from the brief and the plan", "来自晨报和今日计划")}</span>
                <span style={{ flexGrow: 1 }} />
                {canWriteScripts && picks.length > 1 ? (
                  <button
                    type="button"
                    disabled={sending !== null}
                    onClick={() => {
                      for (const [i, p] of picks.entries()) writeScript(p.text, `all${i}`);
                    }}
                    style={smallBtn(true)}
                  >
                    {t("Send all to the Writer", "全部派给编剧")}
                  </button>
                ) : null}
              </div>
              {picks.map((p, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "8px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid #f3f3f3" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: p.source === "plan" ? AGENT_COLORS.planning : AGENT_COLORS.research }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.text}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0 }}>
                      <span style={tinyChip}>
                        {p.source === "digest" ? t("morning brief", "今早晨报") : p.source === "plan" ? t("today's plan", "今日计划") : p.source === "backlog" ? t("backlog", "选题储备") : t("viewer question", "观众提问")}
                      </span>
                      {p.why ? <span style={{ fontSize: 11.5, color: "#7c7c7c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.why}</span> : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {canWriteScripts ? (
                      <button type="button" disabled={sending !== null} onClick={() => writeScript(p.text, `pick${i}`)} style={{ ...smallBtn(true), opacity: sending === `pick${i}` ? 0.55 : 1 }}>
                        {t("Write script", "写脚本")}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => onWatch(p.text.replace(/^写《|》.*$/g, "").replace(/[？?。！!—–-].*$/, "").slice(0, 40))} style={smallBtn(false)}>
                      {t("Watch", "加入关注")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* ---- the list, and the reading of it ------------------------ */}
          <div style={{ display: "flex", gap: 12, alignItems: "stretch", minWidth: 0 }}>
            <div style={{ flexGrow: 1, minWidth: 0, border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "10px 14px 8px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, minWidth: 0 }}>
                {tab === "live" ? <PlatformMark platform="youtube" size={12} /> : <PlatformMark platform={meta!.key} size={12} />}
                <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {tab === "live" ? t("Most watched on YouTube", "YouTube 播放最多") : `${platformName} · ${meta!.kind === "video" ? t("pushing now", "此刻在推") : meta!.kind === "note" ? t("creator inspiration", "给创作者的热点灵感") : t("hot search", "热搜榜")}`}
                </span>
                <span style={{ fontSize: 11.5, color: "#999999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {rows.length ? `${rows.length} ${t("items", "条")}` : ""}
                  {tab !== "live" && loaded[tab]?.note && rows.length ? ` · ${loaded[tab]!.note}` : ""}
                </span>
                <span style={{ flexGrow: 1 }} />
                <span style={{ fontSize: 11, color: "#b3b3b3", whiteSpace: "nowrap" }}>{t("Heat is the platform's own number", "热度是平台自己的说法")}</span>
              </div>

              {/* Google's searches, as a strip: no covers, no heat unit, one press to watch. */}
              {tab === "live" && searches.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "4px 0 8px", borderBottom: "1px solid #f3f3f3", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#999999", alignSelf: "center", marginRight: 2 }}>{t("Searching", "热搜")}</span>
                  {searches.slice(0, 12).map((s) => (
                    <button key={s.phrase} type="button" onClick={() => onWatch(s.phrase)} title={s.headline ?? undefined} style={{ ...smallBtn(false), height: 22, fontSize: 11, gap: 5 }}>
                      {s.phrase}
                      {s.traffic ? <span style={{ color: "#999999" }}>{s.traffic}</span> : null}
                      {s.region && s.region !== region ? <span style={{ color: "#b3b3b3" }}>{s.region}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {loading === tab && !rows.length ? (
                <div style={{ fontSize: 11.5, color: "#999999", padding: "8px 0" }}>{t("Reading…", "正在读取…")}</div>
              ) : !rows.length ? (
                <div style={{ fontSize: 11.5, color: "#a35f00", lineHeight: 1.5, padding: "8px 0" }}>{(tab === "live" ? note : loaded[tab]?.note) ?? t("Nothing came back.", "刚才没有返回内容。")}</div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "4px 0 3px", fontSize: 10.5, color: "#999999", letterSpacing: ".03em" }}>
                    <span>#</span>
                    <span />
                    <span>{t("Title", "标题")}</span>
                    <span style={{ textAlign: "right" }}>{t("Heat", "热度")}</span>
                    {narrow ? null : <span>{t("Researcher", "研究员判断")}</span>}
                    {narrow ? null : <span />}
                    <span />
                  </div>
                  <div style={{ maxHeight: 336, overflowY: "auto", margin: "0 -8px", padding: "0 8px" }}>
                    {rows.map((r, i) => {
                      const mark = marks[r.phrase];
                      const on = selected === r.phrase;
                      const pct = r.heat && maxHeat ? Math.max(6, Math.round((100 * r.heat) / maxHeat)) : null;
                      return (
                        <div
                          key={`${r.url ?? r.phrase}-${i}`}
                          onClick={() => setSelected(on ? null : r.phrase)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: cols,
                            gap: 10,
                            alignItems: "center",
                            padding: "5px 8px",
                            margin: "0 -8px",
                            borderTop: "1px solid #f3f3f3",
                            background: on ? "#f7f7f5" : mark ? "#fbfcff" : "transparent",
                            boxShadow: on ? "inset 2px 0 0 #0f5bd5" : undefined,
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: i < 3 ? "#171717" : "#999999", fontWeight: i < 3 ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
                            {i + 1}
                            {narrow && mark ? <span title={mark.fit} style={{ width: 5, height: 5, borderRadius: 3, background: "#0b7a63" }} /> : null}
                          </span>
                          <Cover src={throughUs(r.thumbnail)} />
                          <div style={{ minWidth: 0 }}>
                            <a
                              href={r.url ?? "#"}
                              target={r.url ? "_blank" : undefined}
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontSize: 12.5, color: "#171717", textDecoration: "none", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            >
                              {r.phrase}
                            </a>
                            {r.extra ? <div style={{ fontSize: 10.5, color: "#999999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.extra}</div> : null}
                          </div>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, fontSize: 11.5, color: "#525252", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            {pct !== null && !narrow ? (
                              <span style={{ width: 54, height: 4, background: "#ededed", borderRadius: 2, position: "relative", flexShrink: 0 }}>
                                <span style={{ position: "absolute", left: 0, top: 0, height: 4, width: `${pct}%`, background: i < 3 ? "#171717" : "#a9a6a0", borderRadius: 2 }} />
                              </span>
                            ) : null}
                            {r.heatLabel ?? (r.heat ? compact(r.heat) : "—")}
                          </span>
                          {narrow ? null : (
                            <span style={{ minWidth: 0 }}>
                              {mark ? (
                                <span style={pill}>{mark.fit}</span>
                              ) : judging === tab ? (
                                <span style={{ fontSize: 10.5, color: "#c7c7c7" }}>…</span>
                              ) : (
                                <span style={{ fontSize: 11, color: "#c7c7c7" }}>—</span>
                              )}
                            </span>
                          )}
                          {narrow ? null : (
                            <button type="button" onClick={(e) => { e.stopPropagation(); onWatch(r.phrase.slice(0, 40)); }} style={{ ...smallBtn(false), height: 22, padding: "0 8px", fontSize: 11 }}>
                              {t("Watch", "关注")}
                            </button>
                          )}
                          <span style={{ color: "#c7c7c7", fontSize: 12 }}>›</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ---- the row somebody picked -------------------------------- */}
            {picked ? (
              <aside style={{ width: 250, flexShrink: 0, border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10.5, color: "#999999", letterSpacing: ".04em", textTransform: "uppercase" }}>{t("Selected", "选中的热点")}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45 }}>{picked.phrase}</div>
                {marks[picked.phrase] ? <span style={{ ...pill, alignSelf: "flex-start" }}>{marks[picked.phrase].fit}</span> : null}
                <div style={{ fontSize: 12 }}>
                  <Kv k={t("Platform", "平台")} v={platformName} />
                  <Kv k={t("Heat", "热度")} v={picked.heatLabel ?? (picked.heat ? compact(picked.heat) : "—")} strong />
                  {picked.extra ? <Kv k={tab === "live" || meta?.kind === "video" ? t("Channel", "账号") : t("Note", "备注")} v={picked.extra} /> : null}
                </div>
                <div style={{ padding: "8px 10px", borderLeft: `2px solid ${AGENT_COLORS.research}`, background: "#fafafa", fontSize: 12, lineHeight: 1.55 }}>
                  <span style={{ fontWeight: 600, color: AGENT_COLORS.research }}>{t("Researcher", "研究员")}</span>{" "}
                  {marks[picked.phrase]?.why ?? (judging === tab ? t("is reading this list…", "正在读这份榜…") : t("could not tie this to the channel's own data.", "在频道数据里没找到跟它相关的依据。"))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
                  {canWriteScripts ? (
                    <button
                      type="button"
                      disabled={sending !== null}
                      onClick={() =>
                        writeScript(
                          `写《${picked.phrase.slice(0, 60)}》的脚本。来源：${platformName}热榜${picked.extra ? `（${picked.extra}）` : ""}${marks[picked.phrase] ? `。研究员的判断：${marks[picked.phrase].why}` : ""}`,
                          "picked",
                        )
                      }
                      style={{ ...smallBtn(true), height: 30, justifyContent: "center" }}
                    >
                      {t("Have the Writer script it", "让编剧写脚本")}
                    </button>
                  ) : null}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => onWatch(picked.phrase.slice(0, 40))} style={{ ...smallBtn(false), flexGrow: 1, justifyContent: "center" }}>
                      {t("Watch", "加入关注")}
                    </button>
                    {picked.url ? (
                      <a href={picked.url} target="_blank" rel="noopener noreferrer" style={{ ...smallBtn(false), flexGrow: 1, justifyContent: "center", textDecoration: "none" }}>
                        {t("Open", "打开原帖")}
                      </a>
                    ) : null}
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const COLS = "20px 48px minmax(0, 1fr) 118px 112px 46px 10px";
/* With the side panel open the table is half as wide: the bar, the mark
   pill and the watch button move into the panel, the number stays. */
const COLS_COMPACT = "20px 48px minmax(0, 1fr) 76px 10px";

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  padding: "0 8px",
  borderRadius: 999,
  background: "#e6f4ec",
  color: "#0b7a63",
  fontSize: 11,
  fontWeight: 500,
  whiteSpace: "nowrap",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const tinyChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 6px",
  border: "1px solid #ededed",
  borderRadius: 5,
  background: "#fafafa",
  fontSize: 10.5,
  color: "#525252",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

function smallBtn(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 26,
    padding: "0 10px",
    borderRadius: 8,
    border: `1px solid ${primary ? "#171717" : "#e2e2e2"}`,
    background: primary ? "#171717" : "#ffffff",
    color: primary ? "#ffffff" : "#383838",
    fontSize: 11.5,
    fontWeight: 500,
    fontFamily: "inherit",
    letterSpacing: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function Kv({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderTop: "1px solid #f3f3f3" }}>
      <span style={{ color: "#7c7c7c", flexShrink: 0 }}>{k}</span>
      <span style={{ fontWeight: strong ? 600 : 400, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}

/** The cover, or a quiet grey square when the platform gave none. */
function Cover({ src }: { src: string | null }) {
  const [broken, setBroken] = React.useState(false);
  if (!src || broken) return <span style={{ width: 48, height: 30, borderRadius: 4, background: "#f0f0f0", display: "block" }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: 48, height: 30, objectFit: "cover", borderRadius: 4, display: "block", background: "#f0f0f0" }} />
  );
}

function compact(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
