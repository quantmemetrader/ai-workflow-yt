"use client";

import { useState } from "react";
import type { BeatChannel } from "@/lib/research/youtube";
import { discoverChannelsAction } from "@/app/(app)/research/youtube-actions";
import { addCompetitorAction } from "@/app/(app)/research/competitor-actions";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { throughUs } from "@/components/research/LiveNow";
import { notify } from "@/lib/client/notify";
import { beginWork } from "@/lib/client/busy";
import { field, ghost, solid, useAction } from "@/components/ui/kit";

/**
 * Who is making videos about this, and how big are they.
 *
 * The competitor board could only show channels somebody had already typed a
 * `UC…` id into a form for, which asks the studio to know the answer before it
 * asks the question. This asks YouTube: the phrase, the last thirty days,
 * ranked by what those videos actually earned rather than by subscriber count
 * — a channel with sixteen million subscribers whose video on the subject did
 * nothing is not who you are competing with on this subject.
 *
 * One press is one search (100 of the key's 10,000 daily units), so it runs
 * when somebody asks and never on a schedule.
 */
export function DiscoverChannels({
  zh,
  watching,
  suggestion,
}: {
  zh: boolean;
  /** Channel ids already on the watch list, so they are not offered twice. */
  watching: string[];
  /** What to look for if nobody types anything — usually the hottest topic. */
  suggestion?: string | null;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { busy, run } = useAction();
  const [phrase, setPhrase] = useState("");
  const [rows, setRows] = useState<BeatChannel[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const held = new Set([...watching, ...added]);

  const look = async (q: string) => {
    const query = q.trim();
    if (!query || looking) return;
    setLooking(true);
    const done = beginWork(zh ? `在 YouTube 上找“${query}”` : `Looking up “${query}” on YouTube`);
    try {
      const res = await discoverChannelsAction(query, { days: 30 });
      if ("error" in res) {
        notify(res.error);
        return;
      }
      setRows(res.channels);
      if (res.channels.length === 0) {
        notify(t("Nobody has posted about that in the last month.", "过去一个月没有人发过相关内容。"));
      }
    } finally {
      done();
      setLooking(false);
    }
  };

  return (
    <section style={{ padding: "16px 20px 20px", borderTop: "1px solid #ededed" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 500 }}>{t("Who is making this", "谁在做这个选题")}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t(
            "the last 30 days on YouTube, ranked by what those videos earned",
            "YouTube 近 30 天，按这些视频的实际播放排序",
          )}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "11px 0 0", flexWrap: "wrap" }}>
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void look(phrase);
            }
          }}
          placeholder={
            suggestion
              ? t(`A subject, for example “${suggestion}”`, `一个主题，例如“${suggestion}”`)
              : t("A subject to look up", "要查的主题")
          }
          aria-label={t("A subject to look up", "要查的主题")}
          style={{ ...field, width: 300, height: 32 }}
        />
        <button
          type="button"
          disabled={looking || phrase.trim().length < 2}
          onClick={() => void look(phrase)}
          style={{ ...solid, opacity: looking || phrase.trim().length < 2 ? 0.45 : 1 }}
        >
          {looking ? t("Looking…", "查找中…") : t("Look up", "查找")}
        </button>
        {suggestion && !phrase ? (
          <button
            type="button"
            disabled={looking}
            onClick={() => {
              setPhrase(suggestion);
              void look(suggestion);
            }}
            style={ghost}
          >
            {t(`Try “${suggestion}”`, `试试“${suggestion}”`)}
          </button>
        ) : null}
      </div>

      {rows === null ? null : rows.length === 0 ? (
        <p style={{ fontSize: 12, color: "#999999", margin: "14px 0 0" }}>
          {t("Nothing came back for that phrase.", "这个词没有查到内容。")}
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))",
            gap: 10,
            marginTop: 14,
          }}
        >
          {rows.map((c) => {
            const on = held.has(c.id);
            return (
              <div
                key={c.id}
                style={{
                  border: "1px solid #ededed",
                  borderRadius: 11,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                  minWidth: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <span style={{ position: "relative", width: 26, height: 26, flexShrink: 0 }}>
                    {c.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        /* Through this app: Google's avatar CDN is blocked on
                           the networks half this studio works from. */
                        src={throughUs(c.thumbnail) ?? ""}
                        alt=""
                        loading="lazy"
                        style={{ width: 26, height: 26, borderRadius: 13, objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          background: "#f3f3f3",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <PlatformMark platform="youtube" size={13} />
                      </span>
                    )}
                    <span
                      style={{
                        position: "absolute",
                        right: -3,
                        bottom: -3,
                        background: "#fff",
                        borderRadius: 6,
                        boxShadow: "0 0 0 1.5px #fff",
                        display: "flex",
                      }}
                    >
                      <PlatformMark platform="youtube" size={11} />
                    </span>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <a
                      href={`https://www.youtube.com/channel/${c.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: "#171717",
                        textDecoration: "none",
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.title}
                    </a>
                    <span style={{ fontSize: 11, color: "#999999" }}>
                      {compact(c.subscribers)} {t("subscribers", "订阅数")}
                      {c.country ? ` · ${c.country}` : ""}
                    </span>
                  </span>
                </div>

                <div style={{ fontSize: 11.5, color: "#525252", lineHeight: 1.5 }}>
                  {compact(c.viewsHere)} {t("views from", "播放，来自")} {c.videosHere}{" "}
                  {c.videosHere === 1 ? t("video", "个视频") : t("videos", "个视频")}
                </div>

                {c.topVideo ? (
                  <a
                    href={`https://www.youtube.com/watch?v=${c.topVideo.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11.5,
                      color: "#7c7c7c",
                      textDecoration: "none",
                      lineHeight: 1.45,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                    title={c.topVideo.title}
                  >
                    {c.topVideo.title}
                  </a>
                ) : null}

                <button
                  type="button"
                  disabled={busy || on}
                  onClick={() =>
                    run(
                      () =>
                        addCompetitorAction({
                          platform: "youtube",
                          externalId: c.id,
                          handle: c.handle ?? "",
                          displayName: c.title,
                          note: "",
                        }),
                      () => setAdded((cur) => [...cur, c.id]),
                    )
                  }
                  style={{ ...ghost, marginTop: "auto", opacity: on ? 0.5 : 1 }}
                >
                  {on ? t("Watching", "已关注") : t("Watch this channel", "关注这个频道")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** 1,240,000 reads as 1.24M in a card this size. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}
