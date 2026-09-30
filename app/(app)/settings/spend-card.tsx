import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { formatUsd } from "@/lib/ai/ledger";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { trainName } from "@/components/train/names";

/**
 * AI 支出 for admins: the whole studio this month, who spent it (people and
 * AI employees), and the viewer's own share. It showed only the viewer's own
 * number under 「团队」, which read as the studio's (the owner, 30 Sep:
 * "US$0.11 — is this correct?").
 */
export async function SpendCard({ tenantId, zh, ownMicros, capMicros, stopped }: { tenantId: string; zh: boolean; ownMicros: number; capMicros: number | null; stopped: boolean }) {
  const { rows } = await db
    .execute<{ email: string | null; name: string | null; local: string | null; micros: string }>(sql`
      select u.email, u.name, u.name_local as local, sum(a.cost_micros)::bigint as micros
        from ai_usage a
        left join users u on u.id = a.user_id
       where a.tenant_id = ${tenantId} and a.created_at >= date_trunc('month', now() at time zone 'UTC')
       group by u.email, u.name, u.name_local
       order by micros desc
    `)
    .catch(() => ({ rows: [] as { email: string | null; name: string | null; local: string | null; micros: string }[] }));
  const total = rows.reduce((n, r) => n + Number(r.micros ?? 0), 0);
  const label = (r: (typeof rows)[number]) => {
    const agent = r.email ? agentKeyFromEmail(r.email) : null;
    if (agent) return { name: `${trainName(agent, zh)}${zh ? "（AI）" : " (AI)"}`, ai: true };
    return { name: (zh ? r.local || r.name : r.name || r.local) || (zh ? "系统" : "System"), ai: false };
  };
  const top = rows.filter((r) => Number(r.micros) > 0).slice(0, 8);
  const month = new Date().toISOString().slice(0, 7);
  return (
    <section className="rounded-xl border border-outline-gray-1" style={{ padding: "18px 18px 16px" }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650, color: "#171717" }}>{zh ? "AI 支出" : "AI spend"}</h2>
      <p style={{ margin: "4px 0 14px", fontSize: 12.5, color: "#7a7a76" }}>{zh ? `${month} 本月，全工作室（人和 AI 同事一起）` : `${month}, the whole studio (people and AI employees)`}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28, fontWeight: 650, color: "#171717", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{formatUsd(total)}</span>
        <span style={{ fontSize: 12.5, color: "#7a7a76" }}>
          {zh ? "你自己 " : "You "}
          <b style={{ color: "#404040", fontWeight: 600 }}>{formatUsd(ownMicros)}</b>
          {" · "}
          {capMicros === null ? (zh ? "没有设上限" : "no cap") : zh ? `你的上限 ${formatUsd(capMicros)}` : `your cap ${formatUsd(capMicros)}`}
        </span>
      </div>
      {top.length ? (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {top.map((r, i) => {
            const l = label(r);
            const pct = total ? Math.max(2, Math.round((Number(r.micros) / total) * 100)) : 0;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr) 64px", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12.5, color: l.ai ? "#5f5f5b" : "#262626", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                <span style={{ height: 6, borderRadius: 99, background: "#f1f1ee", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${pct}%`, borderRadius: 99, background: l.ai ? "#8fb0e0" : "#1f5fbf" }} />
                </span>
                <span style={{ fontSize: 12.5, color: "#404040", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatUsd(Number(r.micros))}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {stopped ? (
        <p style={{ margin: "12px 0 0", padding: "8px 12px", borderRadius: 8, border: "1px solid #f3c7c0", background: "#fdf3f1", fontSize: 12.5, color: "#a4331f" }}>{zh ? "你的预算用完了，助理已暂停" : "Budget reached — the assistant has stopped"}</p>
      ) : null}
    </section>
  );
}
