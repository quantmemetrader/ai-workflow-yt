"use client";

import { PlatformMark as BrandMark } from "@/components/ui/PlatformMark";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { LINE, MUTED, INK, smallButton } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { saveManualAccountAction } from "@/app/(app)/review/actions";
import { fmtNum, STAT_LABEL, type AccountView, type StatKey } from "@/lib/review/types";

/** How long ago, in words ("3 小时前"). */
export function ago(iso: string | null, zh: boolean): string {
  if (!iso) return zh ? "从未" : "never";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return zh ? "刚刚" : "just now";
  if (m < 60) return zh ? `${m} 分钟前` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return zh ? `${h} 小时前` : `${h} h ago`;
  const d = Math.round(h / 24);
  return zh ? `${d} 天前` : `${d} d ago`;
}

/** A small line over time; nothing when there are fewer than two points. */
export function Sparkline({ points, width = 96, height = 28, color = "#1f6feb", label }: { points: { at: string; v: number }[]; width?: number; height?: number; color?: string; label?: string }) {
  if (points.length < 2) return null;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const xy = points.map((p, i) => [i * step, height - 3 - ((p.v - min) / span) * (height - 6)] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.4} fill={color} />
    </svg>
  );
}

/** + or − since the last reading, green or grey. */
export function Delta({ now, before, zh }: { now: number | null; before: number | null; zh: boolean }) {
  if (now === null || before === null || now === before) return null;
  const up = now > before;
  return (
    <span style={{ fontSize: 11.5, fontWeight: 600, color: up ? "#1e7a4f" : "#8a8a8a" }}>
      {up ? "+" : "−"}
      {fmtNum(Math.abs(now - before), zh)}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: MUTED }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 18, fontWeight: 600, color: INK, fontVariantNumeric: "tabular-nums" }}>
        {value}
        {sub}
      </div>
    </div>
  );
}

export const inputStyle: React.CSSProperties = { height: 32, border: `1px solid #d6d5d0`, borderRadius: 8, padding: "0 10px", fontSize: 13, fontFamily: "inherit", minWidth: 0, background: "#fff" };

/** A row of number boxes and a save button, for numbers somebody reads off the app. */
export function NumbersForm({ fields, zh, onSave, onCancel }: { fields: { key: string; label: string }[]; zh: boolean; onSave: (v: Record<string, string>) => Promise<boolean>; onCancel: () => void }) {
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          if (await onSave(vals)) onCancel();
        });
      }}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 8, padding: 10, borderRadius: 10, background: "#fafaf8", border: `1px solid ${LINE}` }}
    >
      {fields.map((f) => (
        <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: MUTED }}>
          {f.label}
          <input inputMode="decimal" value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={zh ? "如 1.2万" : "e.g. 1200"} style={{ ...inputStyle, width: 96 }} />
        </label>
      ))}
      <button type="submit" disabled={pending} style={smallButton(true)}>
        {pending ? (zh ? "保存中…" : "Saving…") : zh ? "保存" : "Save"}
      </button>
      <button type="button" onClick={onCancel} style={smallButton(false)}>
        {zh ? "取消" : "Cancel"}
      </button>
    </form>
  );
}

const ACCOUNT_FIELDS = (zh: boolean) => [
  { key: "followers", label: zh ? "粉丝" : "Followers" },
  { key: "likes", label: zh ? "获赞" : "Likes" },
  { key: "works", label: zh ? "作品数" : "Posts" },
];

/**
 * The accounts as equal tiles: followers (and the change since the
 * last reading, and a line when there are readings to draw), likes, works,
 * and the three latest posts with their numbers.
 */
export function AccountTiles({ accounts, zh, canWork }: { accounts: AccountView[]; zh: boolean; canWork: boolean }) {
  const router = useRouter();
  const [typing, setTyping] = React.useState<string | null>(null);
  return (
    <div className="rv-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
      {accounts.map((a) => {
        const s = a.stats;
        const lead: StatKey = a.platform === "bilibili" || a.platform === "youtube" || a.connected ? "plays" : "likes";
        const followLabel = a.platform === "youtube" ? (zh ? "订阅" : "Subscribers") : a.connected ? (zh ? "关注者" : "Followers") : zh ? "粉丝" : "Followers";
        const viewsFirst = a.platform === "bilibili" || a.connected;
        return (
          <div key={`${a.platform}-${a.accountId}`} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <PlatformMark platform={a.platform} size={34} />
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{zh ? a.zh : a.en}</div>
                <div style={{ fontSize: 11.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
              </div>
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" title={zh ? "打开主页" : "Open profile"} style={{ color: MUTED, display: "inline-flex" }}>
                  <Icon name="external" size={14} />
                </a>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
              <Stat label={followLabel} value={fmtNum(s?.followers ?? null, zh)} sub={<Delta now={s?.followers ?? null} before={a.prevFollowers} zh={zh} />} />
              <Sparkline points={a.followersSeries} label={zh ? "粉丝变化" : "Followers over time"} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Stat label={a.platform === "xiaohongshu" ? (zh ? "赞与收藏" : "Likes & saves") : zh ? "获赞" : "Likes"} value={<span style={{ fontSize: 15 }}>{fmtNum(s?.likes ?? null, zh)}</span>} />
              <Stat label={viewsFirst ? (zh ? "总播放" : "Plays") : zh ? "作品" : "Posts"} value={<span style={{ fontSize: 15 }}>{fmtNum(viewsFirst ? (s?.views ?? null) : (s?.works ?? null), zh)}</span>} />
            </div>
            {a.posts.length ? (
              <div style={{ borderTop: `1px solid #f0efeb`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontSize: 11.5, color: MUTED }}>{zh ? "最近作品" : "Latest posts"}</div>
                {a.posts.slice(0, 3).map((p) => (
                  <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noreferrer" style={{ display: "flex", gap: 8, fontSize: 12, color: "#333", textDecoration: "none", minWidth: 0 }}>
                    <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                    <span style={{ color: MUTED, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {zh ? STAT_LABEL[lead].zh : STAT_LABEL[lead].en} {fmtNum(p.stats[lead] ?? p.stats.likes, zh)}
                    </span>
                  </a>
                ))}
              </div>
            ) : null}
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11.5, color: MUTED }}>
              {a.manualOnly ? <span>{zh ? "暂时无法自动读取，数字手动填写" : "Can't be read automatically; type the numbers in"}</span> : a.error ? <span style={{ color: "#b45309" }}>{a.error}</span> : null}
              <span>
                {a.connected ? (zh ? "已连接 · " : "Connected · ") : a.source === "manual" ? (zh ? "手动 · " : "Typed · ") : ""}
                {zh ? "更新于 " : "Updated "}
                {ago(a.at, zh)}
              </span>
              {canWork && !a.connected ? (
                <button type="button" onClick={() => setTyping(typing === a.platform ? null : a.platform)} style={{ border: 0, background: "none", padding: 0, color: "#1f5fbf", cursor: "pointer", fontSize: 11.5, fontFamily: "inherit" }}>
                  {zh ? "手动填写" : "Type in"}
                </button>
              ) : null}
            </div>
            {typing === a.platform ? (
              <NumbersForm
                zh={zh}
                fields={ACCOUNT_FIELDS(zh)}
                onCancel={() => setTyping(null)}
                onSave={async (v) => {
                  const r = await saveManualAccountAction(a.platform, v);
                  if (r.error) {
                    notify(r.error);
                    return false;
                  }
                  router.refresh();
                  return true;
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const MARK: Record<string, { bg: string; fg: string; t: string }> = {
  douyin: { bg: "#111", fg: "#fff", t: "抖" },
  xiaohongshu: { bg: "#ff2442", fg: "#fff", t: "红" },
  wechat_channels: { bg: "#fa9d3b", fg: "#fff", t: "视" },
  shipinhao: { bg: "#fa9d3b", fg: "#fff", t: "视" },
  bilibili: { bg: "#00a1d6", fg: "#fff", t: "B" },
  youtube: { bg: "#ff0000", fg: "#fff", t: "Y" },
  tiktok: { bg: "#111", fg: "#fff", t: "T" },
  linkedin: { bg: "#0a66c2", fg: "#fff", t: "in" },
  weibo: { bg: "#e6162d", fg: "#fff", t: "微" },
};

/** The platform's own logo on a white tile (the brand marks in components/ui/PlatformMark). */
export function PlatformMark({ platform, size = 26 }: { platform: string; size?: number }) {
  const key = platform === "wechat_channels" ? "shipinhao" : platform;
  void MARK;
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: "#fff", border: "1px solid #ececea", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <BrandMark platform={key} size={Math.round(size * 0.62)} />
    </span>
  );
}
