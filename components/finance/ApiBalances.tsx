"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Balances, ProviderBalance } from "@/lib/finance/providers";
import { refreshBalancesAction } from "@/app/(app)/finance/actions";
import { Icon } from "@/components/ui/Icon";

/**
 * What is left on each paid service, above every Finance tab: the dollars
 * left, what was put in and used where the provider says, this month's spend
 * by our own ledger, and a top-up link — amber under $2, red when empty.
 * "Keep showing how much $ of what credits are left."
 */
const TONE: Record<ProviderBalance["state"], { ink: string; bg: string; line: string; bar: string; zh: string; en: string } | null> = {
  ok: null,
  low: { ink: "#95590a", bg: "#fff4df", line: "#f0c987", bar: "#f0a53a", zh: "余额不足", en: "Running low" },
  empty: { ink: "#b42318", bg: "#fdecea", line: "#f5b8b1", bar: "#d92d20", zh: "已用完", en: "Empty" },
  error: { ink: "#5f5f5f", bg: "#f3f3f1", line: "#e2e2e2", bar: "#c4c4c0", zh: "查不到", en: "Could not read" },
  off: { ink: "#8a8a8a", bg: "#f7f7f5", line: "#ececea", bar: "#d9d9d9", zh: "未配置", en: "Not set up" },
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ApiBalances({ balances, zh }: { balances: Balances; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [pending, start] = useTransition();
  const at = new Date(balances.at);
  const low = balances.rows.filter((r) => r.state === "low" || r.state === "empty");
  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("API balances", "API 余额与用量")}</span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t("read from each service", "各服务自己的数字")} · {at.toLocaleTimeString(zh ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })}
        </span>
        {low.length ? (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#95590a" }}>
            {t(`${low.length} need topping up`, `${low.length} 个需要充值`)}
          </span>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await refreshBalancesAction();
              router.refresh();
            })
          }
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", border: "1px solid #e2e2e2", borderRadius: 7, background: "#fff", color: "#525252", fontFamily: "inherit", fontSize: 12, cursor: pending ? "default" : "pointer" }}
        >
          <Icon name="undo" size={11} />
          {pending ? t("Reading…", "正在刷新…") : t("Refresh", "刷新")}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
        {balances.rows.map((r) => (
          <Card key={r.key} r={r} zh={zh} />
        ))}
      </div>
    </section>
  );
}

function Card({ r, zh }: { r: ProviderBalance; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const tone = TONE[r.state];
  const share = r.leftUsd !== null && r.totalUsd ? Math.max(0, Math.min(1, r.leftUsd / r.totalUsd)) : null;
  const big = r.leftUsd !== null ? usd(r.leftUsd) : r.key === "r2" && r.monthUsd !== null ? `${usd(r.monthUsd)}${t("/mo", "/月")}` : "—";
  const bigLabel = r.leftUsd !== null ? t("left", "剩余") : r.key === "r2" ? t("storage", "存储费") : "";
  return (
    <div style={{ border: `1px solid ${tone?.line ?? "#e6e6e6"}`, borderRadius: 12, background: "#fff", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{zh ? r.nameZh : r.name}</span>
        {tone ? <span style={{ fontSize: 10.5, fontWeight: 600, lineHeight: "17px", padding: "0 7px", borderRadius: 999, color: tone.ink, background: tone.bg, whiteSpace: "nowrap" }}>{zh ? tone.zh : tone.en}</span> : null}
        {r.topUp && r.state !== "off" ? (
          <a href={r.topUp} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 11.5, color: "#1f5fbf", textDecoration: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3 }}>
            {r.key === "r2" ? t("Dashboard", "控制台") : t("Top up", "充值")} <Icon name="external" size={10} />
          </a>
        ) : null}
      </div>
      <div style={{ fontSize: 11, color: "#999999", lineHeight: 1.4 }}>{zh ? r.whatZh : r.what}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 22, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: r.state === "empty" ? "#b42318" : r.state === "low" ? "#95590a" : "#171717" }}>{big}</span>
        <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{bigLabel}</span>
      </div>
      {share !== null ? (
        <div style={{ height: 5, borderRadius: 3, background: "#f0f0ee", overflow: "hidden" }}>
          <div style={{ width: `${Math.round(share * 100)}%`, height: "100%", borderRadius: 3, background: tone?.bar ?? "#278f5e" }} />
        </div>
      ) : null}
      <div style={{ fontSize: 11.5, color: "#6b6b6b", lineHeight: 1.5, fontVariantNumeric: "tabular-nums" }}>
        {[
          r.totalUsd !== null && r.usedUsd !== null ? t(`${usd(r.usedUsd)} used of ${usd(r.totalUsd)}`, `共 ${usd(r.totalUsd)} · 已用 ${usd(r.usedUsd)}`) : null,
          r.monthUsd !== null && r.key !== "r2" ? t(`this month ${usd(r.monthUsd)} (our ledger)`, `本月 ${usd(r.monthUsd)}（账本）`) : null,
          zh ? r.noteZh : r.note,
          r.state === "error" && r.error ? t(`Could not read: ${r.error}`, `查不到：${r.error}`) : null,
          r.state === "off" ? t("No key on this deployment", "本部署没有配置 key") : null,
        ]
          .filter(Boolean)
          .map((line, i) => (
            <div key={i}>{line}</div>
          ))}
      </div>
    </div>
  );
}
