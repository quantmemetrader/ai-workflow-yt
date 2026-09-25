"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { Fold } from "@/components/ui/Fold";
import { DetailLink } from "@/components/home/DetailLink";
import { HOME_ROLES, ROLE_LABELS, type HomeRole } from "@/lib/home/roles";
import type { RoleExtra } from "@/lib/home/service";
import { setMyWorkRoleAction } from "@/app/(app)/home/role-actions";
import { notify } from "@/lib/client/notify";

/**
 * The pieces of Home that exist because Home is per job.
 *
 * `RoleTabs`: one tab per job under the greeting. Each is a plain link to
 * `/home?view=…` — anybody may look at any job's Home, since every project
 * is visible to the whole studio anyway — and the person's own default is
 * marked, with a press to make the one they are looking at their default.
 *
 * `RoleExtraPanel`: the panel only one job has (`roleExtra` on the server).
 */
export function RoleTabs({ zh, role, defaultRole, canSetDefault }: { zh: boolean; role: HomeRole; defaultRole: HomeRole; canSetDefault: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  /* Shown at once; the refresh that follows brings the server's word. */
  const [saved, setSaved] = React.useState<HomeRole | null>(null);
  const mine = saved ?? defaultRole;

  function makeDefault() {
    start(async () => {
      const res = await setMyWorkRoleAction(role === "overview" ? null : role);
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      setSaved(role);
      router.refresh();
    });
  }

  return (
    <nav aria-label={t("按岗位查看首页", "Home by job")} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
      {HOME_ROLES.map((r) => {
        const on = r === role;
        const label = zh ? ROLE_LABELS[r].zh : ROLE_LABELS[r].en;
        return (
          <Link
            key={r}
            href={`/home?view=${r}`}
            prefetch={false}
            aria-current={on ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: r === "overview" ? "0 12px" : "0 12px 0 6px",
              borderRadius: 999,
              border: `1px solid ${on ? "#171717" : "#e4e3df"}`,
              background: on ? "#171717" : "#ffffff",
              color: on ? "#ffffff" : "#3d3d3d",
              fontSize: 12.5,
              fontWeight: on ? 600 : 500,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {r !== "overview" ? <AgentIcon agent={r} size={20} radius={999} /> : null}
            {label}
            {r === mine ? (
              <span style={{ fontSize: 10.5, fontWeight: 500, color: on ? "#d4d4d4" : "#9a9a9a", marginLeft: 1 }}>{t("· 我的默认", "· my default")}</span>
            ) : null}
          </Link>
        );
      })}
      {canSetDefault && role !== mine ? (
        <button
          type="button"
          disabled={pending}
          onClick={makeDefault}
          style={{ height: 30, padding: "0 11px", borderRadius: 999, border: "1px dashed #cfcfcb", background: "transparent", color: "#525252", fontFamily: "inherit", fontSize: 12, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <Icon name="check" size={12} />
          {t("设为我的默认", "Make this my default")}
        </button>
      ) : null}
    </nav>
  );
}

/* ------------------------------------------------------------- role extras */

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  border: "1px solid #efefed",
  borderRadius: 10,
  background: "#ffffff",
  textDecoration: "none",
  color: "#171717",
  minWidth: 0,
};

const QUIET: React.CSSProperties = { fontSize: 12.5, color: "#999999", padding: "4px 0" };

function Pill({ tone, children }: { tone: "warn" | "bad" | "info" | "quiet"; children: React.ReactNode }) {
  const [color, bg] =
    tone === "bad" ? ["#b42318", "#fdecea"] : tone === "warn" ? ["#95590a", "#fff4df"] : tone === "info" ? ["#1f5fbf", "#e9f2fe"] : ["#5f5f5f", "#f3f3f1"];
  return <span style={{ fontSize: 11, fontWeight: 500, color, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>{children}</span>;
}

export function RoleExtraPanel({ extra, zh }: { extra: RoleExtra; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);

  if (extra.kind === "approvals") {
    return (
      <Fold
        id="home-extra-approvals"
        title={t("等你批准的脚本", "Scripts awaiting your OK")}
        sub={String(extra.total)}
        icon={<AgentIcon agent="script" size={18} radius={5} />}
        resizable={false}
        right={<DetailLink zh={zh} href={extra.total ? "/script?status=awaiting_approval" : "/script"} />}
      >
        {extra.items.length === 0 ? (
          <div style={QUIET}>{t("没有等你批准的脚本。", "No script is waiting on you.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {extra.items.map((a) => (
              <Link key={a.id} href={`/script/${a.scriptId}`} prefetch={false} style={ROW}>
                <Icon name="pen" size={14} color="#b3420e" />
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                <span style={{ fontSize: 11.5, color: "#999999", whiteSpace: "nowrap" }}>
                  {a.version !== null ? t(`第 ${a.version} 版`, `v${a.version}`) : ""}
                  {a.version !== null && a.who ? " · " : ""}
                  {a.who ?? ""}
                </span>
                <Pill tone="warn">{t("等你批准", "Needs your OK")}</Pill>
              </Link>
            ))}
          </div>
        )}
      </Fold>
    );
  }

  if (extra.kind === "renders") {
    return (
      <Fold
        id="home-extra-renders"
        title={t("渲染", "Renders")}
        sub={extra.total ? t(`${extra.total} 个在排队、在渲染或失败`, `${extra.total} queued, rendering or failed`) : undefined}
        icon={<AgentIcon agent="video" size={18} radius={5} />}
        resizable={false}
        right={<DetailLink zh={zh} href="/video" />}
      >
        {extra.items.length === 0 ? (
          <div style={QUIET}>{t("最近两周没有在排队、在渲染或失败的渲染。", "Nothing queued, rendering or failed in the last two weeks.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {extra.items.map((r) => {
              const pct = Math.round((r.progress ?? 0) * (r.progress > 1 ? 1 : 100));
              return (
                <Link key={r.id} href={`/video?project=${encodeURIComponent(r.projectId)}`} prefetch={false} style={{ ...ROW, alignItems: "flex-start" }}>
                  <Icon name="film" size={14} color={r.state === "failed" ? "#b42318" : "#0b7a63"} style={{ marginTop: 2 }} />
                  <span style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                    {r.state === "failed" && r.error ? <span style={{ fontSize: 11.5, color: "#7c7c7c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error}</span> : null}
                  </span>
                  {r.state === "failed" ? (
                    <Pill tone="bad">{t("渲染失败", "Failed")}</Pill>
                  ) : r.state === "rendering" ? (
                    <Pill tone="info">{t(`渲染中 ${pct}%`, `Rendering ${pct}%`)}</Pill>
                  ) : (
                    <Pill tone="quiet">{t("排队中", "Queued")}</Pill>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Fold>
    );
  }

  if (extra.kind === "posts") {
    const stateLabel = (s: string) =>
      s === "draft" ? t("草稿", "Draft") : s === "awaiting_approval" ? t("待审批", "Awaiting approval") : s === "failed" ? t("发送失败", "Failed") : s;
    return (
      <Fold
        id="home-extra-posts"
        title={t("还没发出去的", "Not out yet")}
        sub={String(extra.total)}
        icon={<AgentIcon agent="article" size={18} radius={5} />}
        resizable={false}
        right={<DetailLink zh={zh} href="/publish" />}
      >
        {extra.items.length === 0 ? (
          <div style={QUIET}>{t("没有草稿，也没有发失败的。", "No drafts, and nothing failed to send.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {extra.items.map((p) => (
              <Link key={p.id} href="/publish" prefetch={false} style={ROW}>
                <Icon name="share" size={14} color="#9d1d52" />
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || t("（无标题）", "(untitled)")}</span>
                <Pill tone={p.state === "failed" ? "bad" : p.state === "awaiting_approval" ? "warn" : "quiet"}>{stateLabel(p.state)}</Pill>
              </Link>
            ))}
          </div>
        )}
      </Fold>
    );
  }

  /* research: two numbers, each the way into its page. */
  const tile = (href: string, n: number, label: string, hint: string) => (
    <Link href={href} prefetch={false} style={{ ...ROW, flexDirection: "column", alignItems: "flex-start", gap: 3, padding: "10px 12px", flex: "1 1 0" }}>
      <span style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#0f5bd5" }}>{n}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: "#999999" }}>{hint}</span>
    </Link>
  );
  return (
    <Fold
      id="home-extra-research"
      title={t("研究台", "Research desk")}
      icon={<AgentIcon agent="research" size={18} radius={5} />}
      resizable={false}
      right={<DetailLink zh={zh} href="/research/backlog" />}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {tile("/research/backlog", extra.backlog, t("选题储备", "Topic backlog"), t("已采纳、已收藏的选题", "Adopted and saved topics"))}
        {tile("/research/inbox", extra.inbox, t("评论待回", "Comments to answer"), t("各平台还没处理的评论", "Open comments across platforms"))}
      </div>
    </Fold>
  );
}
