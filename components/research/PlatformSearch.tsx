"use client";

import * as React from "react";
import { PlatformMark } from "@/components/ui/PlatformMark";
import { Icon } from "@/components/ui/Icon";
import type { HotRow } from "@/lib/research/platform-catalog";

/**
 * The phrases being compared, on each platform: the top posts for a phrase
 * on YouTube, 抖音, B站 and 小红书, each with its own numbers, as the trends
 * board draws a hot list.
 */
const PLATFORMS = [
  { key: "youtube", zh: "YouTube", en: "YouTube" },
  { key: "douyin", zh: "抖音", en: "Douyin" },
  { key: "bilibili", zh: "B站", en: "Bilibili" },
  { key: "xiaohongshu", zh: "小红书", en: "Rednote" },
] as const;

type Result = { rows: HotRow[]; note: string | null };

export function PlatformSearch({ phrases, zh }: { phrases: string[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [phrase, setPhrase] = React.useState(phrases[0] ?? "");
  const [platform, setPlatform] = React.useState<(typeof PLATFORMS)[number]["key"]>("youtube");
  const [cache, setCache] = React.useState<Record<string, Result>>({});
  const current = phrases.includes(phrase) ? phrase : phrases[0] ?? "";
  const key = `${platform}|${current}`;
  const result = cache[key];

  React.useEffect(() => {
    if (!current || cache[key]) return;
    let live = true;
    void fetch(`/api/research/search?platform=${platform}&q=${encodeURIComponent(current)}`)
      .then((r) => (r.ok ? r.json() : { rows: [], note: null }))
      .then((j: Result) => live && setCache((m) => ({ ...m, [key]: { rows: j.rows ?? [], note: j.note ?? null } })))
      .catch(() => live && setCache((m) => ({ ...m, [key]: { rows: [], note: null } })));
    return () => {
      live = false;
    };
  }, [key, current, platform, cache]);

  if (!phrases.length) return null;
  return (
    <div style={{ marginTop: 18, border: "1px solid #ededed", borderRadius: 12, background: "#fff", padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("各平台上的表现", "On each platform")}</span>
        {phrases.length > 1 ? (
          <select value={current} onChange={(e) => setPhrase(e.target.value)} style={{ height: 28, border: "1px solid #e2e2e2", borderRadius: 8, fontFamily: "inherit", fontSize: 12, padding: "0 8px" }}>
            {phrases.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 12, color: "#999999" }}>「{current}」</span>
        )}
        <span style={{ flexGrow: 1 }} />
        {PLATFORMS.map((p) => {
          const on = p.key === platform;
          return (
            <button key={p.key} type="button" onClick={() => setPlatform(p.key)} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px", borderRadius: 999, border: `1px solid ${on ? "#171717" : "#e2e2e2"}`, background: on ? "#171717" : "#fff", color: on ? "#fff" : "#171717", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>
              <PlatformMark platform={p.key} size={11} mono={on} />
              {zh ? p.zh : p.en}
            </button>
          );
        })}
      </div>
      {!result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk" style={{ height: 44 }} />
          ))}
        </div>
      ) : !result.rows.length ? (
        <div style={{ fontSize: 12.5, color: "#999999", padding: "10px 0" }}>{result.note ?? t("没搜到。", "Nothing found.")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {result.rows.slice(0, 10).map((r, i) => (
            <a key={`${r.url}-${i}`} href={r.url ?? "#"} target="_blank" rel="noopener noreferrer" style={{ display: "grid", gridTemplateColumns: "22px 64px minmax(0,1fr)", gap: 10, alignItems: "center", padding: "7px 0", borderTop: i ? "1px solid #f3f3f3" : "none", textDecoration: "none", color: "#171717" }}>
              <span style={{ fontSize: 11.5, color: i < 3 ? "#171717" : "#999999", fontWeight: i < 3 ? 600 : 400 }}>{i + 1}</span>
              {r.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/img?u=${encodeURIComponent(r.thumbnail)}`} alt="" loading="lazy" style={{ width: 64, height: 38, objectFit: "cover", borderRadius: 6, background: "#f0f0f0" }} />
              ) : (
                <span style={{ width: 64, height: 38, borderRadius: 6, background: "#f5f5f3", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <PlatformMark platform={platform} size={13} />
                </span>
              )}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.phrase}</span>
                <span style={{ display: "flex", gap: 9, fontSize: 11, color: "#7c7c7c", marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden" }}>
                  {r.extra ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{r.extra}</span> : null}
                  {r.stats?.views != null ? <span><Icon name="play" size={10} fill /> {compact(r.stats.views)}</span> : null}
                  {r.stats?.likes != null ? <span><Icon name="heart" size={10} /> {compact(r.stats.likes)}{r.stats.likeRate != null ? ` · ${(r.stats.likeRate * 100).toFixed(1)}%` : ""}</span> : null}
                  {r.stats?.comments != null ? <span><Icon name="comment" size={10} /> {compact(r.stats.comments)}</span> : null}
                  {r.stats?.shares != null ? <span><Icon name="share" size={10} /> {compact(r.stats.shares)}</span> : null}
                  {r.stats?.publishedAt ? <span>{since(r.stats.publishedAt, zh)}</span> : null}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万`;
  return String(Math.round(n));
}

function since(iso: string, zh: boolean): string {
  const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 24) return zh ? `${Math.max(1, Math.round(h))} 小时前` : `${Math.max(1, Math.round(h))}h ago`;
  const d = Math.round(h / 24);
  return zh ? `${d} 天前` : `${d}d ago`;
}
