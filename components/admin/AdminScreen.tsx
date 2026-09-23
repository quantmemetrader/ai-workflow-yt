"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MODULES, type Module } from "@/lib/db/schema";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { ModuleSidebar, type ScreenItem } from "@/components/shell/ModuleSidebar";
import { Badge, clip, money } from "@/components/ui/kit";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import type {
  AuditRow,
  BudgetRow,
  KeyRow,
  KnowledgeRow,
  PersonRow,
  UsageSlice,
} from "@/lib/admin/service";
import type { TeamRow } from "@/lib/teams/service";
import {
  addPersonAction,
  createTeamAction,
  deleteTeamAction,
  previewPromptAction,
  removeBudgetAction,
  rollbackKnowledgeAction,
  saveKnowledgeAction,
  setBudgetAction,
  setEntitlementAction,
  setKnowledgeActiveAction,
  setProfileAction,
  setRoleAction,
  setStatusAction,
  setTeamMemberAction,
  knowledgeHistoryAction,
  type AddedPerson,
} from "@/app/(app)/admin/actions";
import { notify } from "@/lib/client/notify";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * Admin (spec §4.8, §8), transcribed from the seven `Adm-*` artboards.
 *
 * Seven tabs rather than seven routes, for the reason Publish has four: they
 * are seven views of one studio, and seven routes would be seven copies of
 * the same header.
 *
 * Nothing here invents a number. The entitlement grid is the `entitlements`
 * table, the token dashboard is `ai_usage`, the budgets are the ones the
 * ledger already enforces, the audit log is `audit_log` including an
 * administrator opening somebody's file, and the prompt preview is the exact
 * text the agent is given.
 *
 * Keys are referenced, never displayed. The credentials tab says which
 * variable is set and what it unlocks, and holds no value at all: the data
 * that reaches this component is booleans.
 */
type Tab = "people" | "ent" | "tokens" | "budgets" | "credentials" | "audit" | "knowledge" | "prompt";

export type PendingInvite = { id: string; email: string; role: string; expiresAt: string };

export function AdminScreen({
  people,
  teams,
  invites,
  usage,
  budgets,
  keys,
  connections,
  audit,
  auditActions,
  knowledge,
  viewerId,
  viewerRole,
  locale,
  model,
}: {
  people: PersonRow[];
  teams: TeamRow[];
  /** Invited and not yet joined — they have no `users` row to appear in. */
  invites: PendingInvite[];
  usage: {
    days: number;
    byModule: UsageSlice[];
    byModel: UsageSlice[];
    byPerson: UsageSlice[];
    daily: { day: string; costMicros: number }[];
  };
  budgets: BudgetRow[];
  keys: KeyRow[];
  connections: {
    id: string;
    platform: string;
    name: string;
    status: string;
    scopes: string[];
    canPost: boolean;
    needsReconnect: boolean;
    tokenExpiresAt: Date | null;
    issues: string[];
  }[];
  audit: AuditRow[];
  auditActions: string[];
  knowledge: KnowledgeRow[];
  viewerId: string;
  /** The owner's own row is not administered by an administrator. */
  viewerRole: "owner" | "admin" | "member" | "guest";
  locale: string;
  /** Which model answers in the panel down the right edge. */
  model: string;
}) {
  const zh = locale.startsWith("zh");
  const t = (en: string, cn: string) => (zh ? cn : en);
  const agent = useInlineAgent({ module: "admin" });
  const router = useRouter();
  const [busy, start] = useTransition();
  const [tab, setTab] = useState<Tab>("people");

  const run = (fn: () => Promise<{ error?: string } | void>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) {
        notify(res.error);
        return;
      }
      after?.();
      router.refresh();
    });

  /* The design's own screen list, in the design's order. It draws these down
     a 212px column rather than across the top, the way every other desktop
     artboard in the set does. */
  const SCREENS: ScreenItem<Tab>[] = [
    { key: "people", label: "People", labelZh: "成员", badge: people.length },
    { key: "ent", label: "Entitlements matrix", labelZh: "权限矩阵" },
    { key: "tokens", label: "Token dashboard", labelZh: "用量看板" },
    { key: "budgets", label: "Budgets", labelZh: "预算", badge: budgets.length },
    { key: "credentials", label: "Channels & credentials", labelZh: "渠道与凭据", badge: connections.length },
    { key: "audit", label: "Audit log", labelZh: "审计日志" },
    { key: "knowledge", label: "Knowledge & skills", labelZh: "知识与技能", badge: knowledge.length },
    { key: "prompt", label: "Assembled prompt", labelZh: "拼装提示词" },
  ];

  return (
    /* Admin was the last module with no agent on it, which made it the one
       place you had to leave the screen to ask a question about the screen. */
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", minHeight: 0 }}>
    <ModuleSidebar
      title="Admin"
      titleZh="管理"
      screens={SCREENS}
      active={tab}
      onChange={setTab}
      zh={zh}
      storageKey="admin-sidebar"
      footer={
        /* The artboard puts a usage line here. The honest version of it is the
           studio's spend against its cap — and this screen is not given the
           cap, only the spend, so it shows the period's total rather than a
           percentage of a number nobody passed in. */
        <div style={{ padding: "0 9px 4px" }}>
          <div style={{ fontSize: 11, color: "#999999", marginBottom: 3 }}>
            {t(`Last ${usage.days} days`, `近 ${usage.days} 天`)}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
            {money(usage.byModule.reduce((sum, m) => sum + m.costMicros, 0))}
          </div>
        </div>
      }
    />

    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <header
        style={{
          height: 56,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 22px",
        }}
      >
        {/* The module's name is in the column now, so the header names the
            screen you are on — which is what the artboards do. */}
        <span style={{ fontSize: 15, fontWeight: 600 }}>
          {(() => {
            const here = SCREENS.find((x) => x.key === tab);
            return here ? (zh ? here.labelZh : here.label) : t("Admin", "管理");
          })()}
        </span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t("who is here, what they may open, and what it costs", "谁在这里、可以打开什么、花了多少钱")}
        </span>
      </header>

      <div style={{ flexGrow: 1, minHeight: 0, overflow: "auto", padding: "18px 22px 40px" }}>
        {tab === "people" && (
          <People
            people={people}
            teams={teams}
            invites={invites}
            zh={zh}
            busy={busy}
            viewerId={viewerId}
            viewerRole={viewerRole}
            onRole={(userId, role) => run(() => setRoleAction(userId, role))}
            onStatus={(userId, status) => run(() => setStatusAction(userId, status))}
            onProfile={(userId, profile, after) => run(() => setProfileAction(userId, profile), after)}
            onCreateTeam={(input, after) => run(() => createTeamAction(input), after)}
            onTeamMember={(teamId, userId, member) =>
              run(() => setTeamMemberAction(teamId, userId, member))
            }
            onDeleteTeam={(teamId) => run(() => deleteTeamAction(teamId))}
            /* The invitation is the one call whose *result* is the point — the
               link has to come back to the screen — so it is awaited here
               rather than handed to `run`, which only reports failures. */
            onAdd={async (input) => {
              const res = await addPersonAction(input);
              if (res.ok) router.refresh();
              return res;
            }}
            onOpenEntitlements={() => setTab("ent")}
          />
        )}
        {tab === "ent" && (
          <Entitlements
            people={people}
            zh={zh}
            busy={busy}
            viewerId={viewerId}
            onToggle={(userId, module, granted) => run(() => setEntitlementAction(userId, module, granted))}
            onRole={(userId, role) => run(() => setRoleAction(userId, role))}
            onStatus={(userId, status) => run(() => setStatusAction(userId, status))}
          />
        )}
        {tab === "tokens" && <Tokens usage={usage} zh={zh} />}
        {tab === "budgets" && (
          <Budgets
            budgets={budgets}
            people={people}
            zh={zh}
            busy={busy}
            onSet={(input) => run(() => setBudgetAction(input))}
            onRemove={(budgetId) => run(() => removeBudgetAction(budgetId))}
          />
        )}
        {tab === "credentials" && <Credentials keys={keys} connections={connections} zh={zh} />}
        {tab === "audit" && <Audit rows={audit} actions={auditActions} zh={zh} />}
        {tab === "knowledge" && (
          <Knowledge
            rows={knowledge}
            zh={zh}
            busy={busy}
            onSave={(input, after) => run(() => saveKnowledgeAction(input), after)}
            onActive={(id, active) => run(() => setKnowledgeActiveAction(id, active))}
            onRollback={(id, version) => run(() => rollbackKnowledgeAction(id, version))}
          />
        )}
        {tab === "prompt" && <PromptPreview zh={zh} />}
      </div>
    </div>

    <ResearchAgentPanel
      accent="#007be0"
      zh={zh}
      scope={TAB_SCOPE(tab, zh)}
      note={
        zh
          ? "可以问它谁能打开什么、这个月花在哪里，或某条审计记录是什么意思。"
          : "Ask who can open what, where this month went, or what an audit line means."
      }
      placeholder={zh ? "问管理相关的问题…" : "Ask about admin…"}
      model={model}
      onAsk={(prompt) => void agent.send(prompt)}
      thread={
        <InlineAgentThread
          messages={agent.messages}
          notice={agent.notice}
          conversationId={agent.conversationId}
          zh={zh}
        />
      }
    />
    </div>
  );
}

/** What the agent is looking at, which is whichever tab is open. */
function TAB_SCOPE(tab: string, zh: boolean): string {
  const names: Record<string, [string, string]> = {
    people: ["People & access", "人员与权限"],
    usage: ["Usage & cost", "用量与成本"],
    budgets: ["Budgets", "预算"],
    credentials: ["Credentials", "凭据"],
    audit: ["Audit log", "审计日志"],
    knowledge: ["Knowledge", "知识"],
    prompt: ["System prompt", "系统提示"],
  };
  const pair = names[tab];
  return pair ? (zh ? pair[1] : pair[0]) : tab;
}

/* ---------------------------------------------------------------- people */

/** The roster's column widths, in one place because the header row and every
 * person's row have to agree on them. */
const COLUMNS = "minmax(0,1.6fr) 110px minmax(0,1fr) 120px 120px 140px";

/**
 * Who is here — the design's own People screen.
 *
 * The roster and the entitlement grid were one screen, which made the first
 * thing an administrator sees a wall of a hundred checkboxes. The design has
 * them as two, and it is right: "who works here, and are they active" is a
 * different question from "exactly which modules does each of them hold", and
 * the second is answered a tenth as often.
 *
 * Filters on team and role, because the studio it is designed for has twelve
 * people and the studio it will have has forty.
 *
 * It is also where people are *added*, put on teams and renamed. Until now
 * the only way to do any of the three was a shell on the box: `db:add-user`
 * for a colleague, an `insert` for a team, an `update` for a job title. A
 * screen that can see who is here and cannot add anybody is a reference card,
 * not an admin screen.
 */
function People({
  people,
  teams,
  invites,
  zh,
  busy,
  viewerId,
  viewerRole,
  onRole,
  onStatus,
  onProfile,
  onAdd,
  onCreateTeam,
  onTeamMember,
  onDeleteTeam,
  onOpenEntitlements,
}: {
  people: PersonRow[];
  teams: TeamRow[];
  invites: PendingInvite[];
  zh: boolean;
  busy: boolean;
  viewerId: string;
  viewerRole: "owner" | "admin" | "member" | "guest";
  onRole: (userId: string, role: string) => void;
  onStatus: (userId: string, status: string) => void;
  onProfile: (
    userId: string,
    profile: { name: string; nameLocal: string; title: string },
    after: () => void,
  ) => void;
  onAdd: (input: {
    email: string;
    name: string;
    role: string;
    modules: Module[];
  }) => Promise<AddedPerson>;
  onCreateTeam: (input: { name: string; nameLocal: string }, after: () => void) => void;
  onTeamMember: (teamId: string, userId: string, member: boolean) => void;
  onDeleteTeam: (teamId: string) => void;
  onOpenEntitlements: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [team, setTeam] = useState("all");
  const [role, setRole] = useState("all");
  const [suspending, setSuspending] = useState<PersonRow | null>(null);
  /* One panel open at a time, and neither open by default: the first thing
     this screen answers is still "who is here". */
  const [panel, setPanel] = useState<"add" | "teams" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  /* The filter still reads the names on the people, not the team list, so a
     team nobody is on does not appear as an option that shows nothing. */
  const allTeams = [...new Set(people.flatMap((p) => p.teams))].sort();
  const shown = people.filter(
    (p) => (team === "all" || p.teams.includes(team)) && (role === "all" || p.role === role),
  );

  /** The owner's row is the owner's. Everything else on this screen is admin. */
  const mayEdit = (p: PersonRow) => p.role !== "owner" || viewerRole === "owner";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ ...field, width: 150, height: 30 }}>
          <option value="all">{t("Team: All", "团队：全部")}</option>
          {allTeams.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...field, width: 150, height: 30 }}>
          <option value="all">{t("Role: All", "角色：全部")}</option>
          {["owner", "admin", "member", "guest"].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {shown.length} {shown.length === 1 ? t("person", "人") : t("people", "人")}
        </span>
        <button
          type="button"
          onClick={() => setPanel((p) => (p === "teams" ? null : "teams"))}
          style={{ ...ghost, marginLeft: "auto" }}
        >
          {t("Teams", "团队")}
          {teams.length ? <span style={{ color: "#999999" }}> · {teams.length}</span> : null}
        </button>
        <button type="button" onClick={onOpenEntitlements} style={ghost}>
          {t("Entitlements matrix", "权限矩阵")}
        </button>
        <button
          type="button"
          onClick={() => setPanel((p) => (p === "add" ? null : "add"))}
          style={solid}
        >
          {t("Add person", "添加成员")}
        </button>
      </div>

      {panel === "add" ? <AddPerson zh={zh} onAdd={onAdd} onClose={() => setPanel(null)} /> : null}

      {panel === "teams" ? (
        <Teams
          teams={teams}
          people={people}
          zh={zh}
          busy={busy}
          onCreate={onCreateTeam}
          onMember={onTeamMember}
          onDelete={onDeleteTeam}
        />
      ) : null}

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COLUMNS,
            gap: 10,
            padding: "0 10px 8px",
            fontSize: 10.5,
            color: "#999999",
            borderBottom: "1px solid #ededed",
          }}
        >
          <span>{t("Employee", "成员")}</span>
          <span>{t("Role", "角色")}</span>
          <span>{t("Team", "团队")}</span>
          <span>{t("Status", "状态")}</span>
          <span>{t("Last active", "最近活跃")}</span>
          <span>{t("Modules", "模块")}</span>
        </div>

        {shown.map((p) => {
          const self = p.id === viewerId;

          /* Editing takes the whole row rather than squeezing three fields
             into the name column: the row is 1.6fr wide and a job title is
             not. */
          if (editing === p.id) {
            return (
              <PersonEditor
                key={p.id}
                person={p}
                zh={zh}
                busy={busy}
                onSave={(profile) => onProfile(p.id, profile, () => setEditing(null))}
                onCancel={() => setEditing(null)}
              />
            );
          }

          return (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: COLUMNS,
                gap: 10,
                alignItems: "center",
                padding: "9px 10px",
                borderBottom: "1px solid #f3f3f3",
                fontSize: 12.5,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                {p.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.avatarUrl}
                    alt=""
                    style={{ width: 24, height: 24, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      background: "#f3f3f3",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#7c7c7c",
                      flexShrink: 0,
                    }}
                  >
                    {(zh && p.nameLocal ? p.nameLocal : p.name).slice(0, 2)}
                  </span>
                )}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 500, ...clip }}>
                    {(zh && p.nameLocal) || p.name}
                    {/* The title is edited on this row, so it is shown on it. */}
                    {p.title ? (
                      <span style={{ fontWeight: 400, color: "#7c7c7c" }}> · {p.title}</span>
                    ) : null}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "#999999", ...clip }}>{p.email}</span>
                </span>
              </span>

              {/* The owner's own role is not a dropdown: a studio with no owner
                  is a studio nobody can administer. */}
              {p.role === "owner" || self ? (
                <Badge tone={p.role === "owner" ? "info" : "quiet"}>{p.role}</Badge>
              ) : (
                <select
                  value={p.role}
                  disabled={busy}
                  onChange={(e) => onRole(p.id, e.target.value)}
                  style={{ ...field, height: 26, width: 100, fontSize: 11.5 }}
                >
                  {["admin", "member", "guest"].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}

              <span style={{ fontSize: 11.5, color: "#7c7c7c", ...clip }}>
                {p.teams.length ? p.teams.join(", ") : "—"}
              </span>

              <span>
                <Badge tone={p.status === "active" ? "good" : p.status === "invited" ? "warn" : "bad"}>
                  {p.status}
                </Badge>
              </span>

              <span style={{ fontSize: 11.5, color: "#999999" }}>{ago(p.lastActiveAt, zh)}</span>

              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: "#7c7c7c" }}>{p.modules.length}</span>
                {mayEdit(p) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(p.id)}
                    style={{ ...ghost, height: 24, fontSize: 11, padding: "0 8px" }}
                  >
                    {t("Edit", "编辑")}
                  </button>
                ) : null}
                {!self && p.role !== "owner" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      p.status === "active" ? setSuspending(p) : onStatus(p.id, "active")
                    }
                    style={{ ...ghost, height: 24, fontSize: 11, padding: "0 8px" }}
                  >
                    {p.status === "active" ? t("Suspend", "停用") : t("Restore", "恢复")}
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}

        {shown.length === 0 ? (
          <Empty
            title={t("Nobody matches those filters", "没有符合筛选条件的人")}
            body={t("Clear the team or role filter above.", "请清除上方的团队或角色筛选。")}
          />
        ) : null}
      </div>

      {/* Somebody who has been sent a link has no row above until they use it,
          so without this the roster looks unchanged the moment after you add
          them. The link itself is not here: the token is hashed the second it
          is made and shown once, to whoever made it. */}
      {invites.length ? (
        <div style={{ marginTop: 16, borderTop: "1px solid #ededed", paddingTop: 10 }}>
          <div style={{ fontSize: 10.5, color: "#999999", marginBottom: 5 }}>
            {t("Invited, not joined yet", "已邀请，尚未加入")}
          </div>
          {invites.map((i) => (
            <div
              key={i.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "4px 0",
                fontSize: 11.5,
                color: "#7c7c7c",
              }}
            >
              <span style={{ ...clip }}>{i.email}</span>
              <span style={{ color: "#999999" }}>{i.role}</span>
              <span style={{ marginLeft: "auto", color: "#999999" }}>
                {t(`expires ${i.expiresAt.slice(0, 10)}`, `有效期至 ${i.expiresAt.slice(0, 10)}`)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {suspending ? (
        <ConfirmDialog
          danger
          title={t(`Suspend ${suspending.name}?`, `停用 ${suspending.name}？`)}
          body={t(
            "Their sessions end at once and they cannot sign in. Nothing they made is deleted, and restoring them gives everything back.",
            "其会话会立即结束，且无法再登录。他们创建的内容不会被删除，恢复后一切照旧。",
          )}
          confirm={t("Suspend", "停用")}
          cancel={t("Cancel", "取消")}
          onClose={() => setSuspending(null)}
          onConfirm={() => {
            onStatus(suspending.id, "suspended");
            setSuspending(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * A colleague's name and job title, in place of their row.
 *
 * Three fields, because the studio works in two languages and the table shows
 * whichever one matches the reader's: a person with no `nameLocal` is a person
 * whose Chinese colleagues read a Latin name. The Settings screen has had this
 * form for your own row since the start; this is the same one for somebody
 * else's, and it is audited as `admin.user.profile`.
 */
function PersonEditor({
  person,
  zh,
  busy,
  onSave,
  onCancel,
}: {
  person: PersonRow;
  zh: boolean;
  busy: boolean;
  onSave: (profile: { name: string; nameLocal: string; title: string }) => void;
  onCancel: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [name, setName] = useState(person.name);
  const [nameLocal, setNameLocal] = useState(person.nameLocal ?? "");
  const [title, setTitle] = useState(person.title ?? "");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "9px 10px",
        borderBottom: "1px solid #f3f3f3",
        background: "#fafafa",
      }}
    >
      <span style={{ fontSize: 11, color: "#999999", width: 150, ...clip }}>{person.email}</span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("Name", "英文名")}
        style={{ ...field, height: 28, width: 150, fontSize: 12 }}
      />
      <input
        value={nameLocal}
        onChange={(e) => setNameLocal(e.target.value)}
        placeholder={t("Chinese name", "中文名")}
        style={{ ...field, height: 28, width: 130, fontSize: 12 }}
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("Job title", "职位")}
        style={{ ...field, height: 28, width: 170, fontSize: 12 }}
      />
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={() => onSave({ name: name.trim(), nameLocal: nameLocal.trim(), title: title.trim() })}
        style={{ ...solid, height: 28, marginLeft: "auto", opacity: name.trim() ? 1 : 0.45 }}
      >
        {t("Save", "保存")}
      </button>
      <button type="button" onClick={onCancel} style={{ ...ghost, height: 28 }}>
        {t("Cancel", "取消")}
      </button>
    </div>
  );
}

/**
 * Adding somebody.
 *
 * It creates an invitation, not an account: a password is the one thing an
 * administrator must not choose on somebody else's behalf. No mail provider
 * is configured on this deployment, so the link comes back here to be passed
 * on — the same bargain Settings makes, said in the same words, because a
 * screen that claimed to have sent an email would be a screen telling a lie.
 */
function AddPerson({
  zh,
  onAdd,
  onClose,
}: {
  zh: boolean;
  onAdd: (input: { email: string; name: string; role: string; modules: Module[] }) => Promise<AddedPerson>;
  onClose: () => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [busy, start] = useTransition();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "guest">("member");
  /* What almost everybody needs on day one, and nothing that costs money. */
  const [modules, setModules] = useState<Module[]>(["chat", "files"]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await onAdd({ email: email.trim(), name: name.trim(), role, modules });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent({ email: res.email, link: res.link, expiresAt: res.expiresAt });
      setCopied(false);
      setEmail("");
      setName("");
    });

  const chip = (on: boolean): React.CSSProperties => ({
    height: 26,
    padding: "0 10px",
    borderRadius: 8,
    border: on ? "1px solid #171717" : "1px solid #ededed",
    background: on ? "#171717" : "#fff",
    color: on ? "#fff" : "#525252",
    fontSize: 11.5,
    fontFamily: "inherit",
    letterSpacing: "inherit",
    cursor: "pointer",
  });

  return (
    <div
      style={{
        border: "1px solid #ededed",
        borderRadius: 10,
        padding: 14,
        marginBottom: 14,
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Add person", "添加成员")}</span>
        <button type="button" onClick={onClose} style={{ ...ghost, height: 26, marginLeft: "auto" }}>
          {t("Close", "收起")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("Their email address", "邮箱地址")}
          style={{ ...field, height: 30, width: 240 }}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Their name (optional)", "姓名（可留空）")}
          style={{ ...field, height: 30, width: 190 }}
        />
        <span style={{ display: "flex", gap: 6 }}>
          {(["admin", "member", "guest"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)} style={chip(role === r)}>
              {r}
            </button>
          ))}
        </span>
      </div>

      <span style={{ fontSize: 11.5, color: "#999999" }}>
        {t("What they may open", "他们可以打开的模块")}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {MODULES.map((m) => {
          const on = modules.includes(m);
          return (
            <button
              key={m}
              type="button"
              onClick={() => setModules((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
              style={chip(on)}
            >
              {m}
            </button>
          );
        })}
      </div>

      {error ? <span style={{ fontSize: 11.5, color: "#e03636" }}>{error}</span> : null}

      <button
        type="button"
        disabled={busy || !email.trim() || modules.length === 0}
        onClick={submit}
        style={{
          ...solid,
          alignSelf: "flex-start",
          opacity: busy || !email.trim() || modules.length === 0 ? 0.45 : 1,
        }}
      >
        {busy ? t("Creating…", "创建中…") : t("Create the invitation", "创建邀请链接")}
      </button>

      {sent ? (
        <div style={{ border: "1px solid #ffe0b2", background: "#fff8ec", borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 11.5, color: "#a35f00", lineHeight: 1.6, margin: 0 }}>
            {t(
              `No mail provider is configured on this deployment, so nothing was sent to ${sent.email}. Pass this link on yourself: they open it, type their name, choose their own password and are signed in. It works once and expires on ${sent.expiresAt.slice(0, 10)}.`,
              `这个部署还没有配置邮件服务，所以系统没有向 ${sent.email} 发送任何邮件。请把下面的链接发给对方：打开链接后，他们自己填写姓名并设置密码，随后直接登录。链接只能用一次，有效期至 ${sent.expiresAt.slice(0, 10)}。`,
            )}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                background: "#fff",
                borderRadius: 6,
                padding: "5px 8px",
                fontSize: 11,
                color: "#525252",
                ...clip,
              }}
            >
              {sent.link}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(sent.link);
                setCopied(true);
              }}
              style={{ ...ghost, height: 26, flexShrink: 0 }}
            >
              {copied ? t("Copied", "已复制") : t("Copy", "复制")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Teams, and who is on them.
 *
 * `teams` and `team_members` were in the schema from the first migration and
 * empty, so the Team column read "—" for the whole studio and the filter above
 * it had one option. Membership is the join table, never `users.team_id`: a
 * producer is on the shoot crew *and* the language desk, and the old column
 * could only hold one answer.
 *
 * A person is added or removed one click at a time, like a cell of the
 * entitlement matrix, so two administrators with the screen open do not undo
 * each other.
 */
function Teams({
  teams,
  people,
  zh,
  busy,
  onCreate,
  onMember,
  onDelete,
}: {
  teams: TeamRow[];
  people: PersonRow[];
  zh: boolean;
  busy: boolean;
  onCreate: (input: { name: string; nameLocal: string }, after: () => void) => void;
  onMember: (teamId: string, userId: string, member: boolean) => void;
  onDelete: (teamId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [name, setName] = useState("");
  const [nameLocal, setNameLocal] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [dissolving, setDissolving] = useState<TeamRow | null>(null);

  return (
    <div
      style={{
        border: "1px solid #ededed",
        borderRadius: 10,
        padding: 14,
        marginBottom: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Teams", "团队")}</span>
        <input
          value={nameLocal}
          onChange={(e) => setNameLocal(e.target.value)}
          placeholder={t("Chinese name", "中文名")}
          style={{ ...field, height: 30, width: 140, marginLeft: "auto" }}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Name", "英文名")}
          style={{ ...field, height: 30, width: 160 }}
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            onCreate({ name: name.trim(), nameLocal: nameLocal.trim() }, () => {
              setName("");
              setNameLocal("");
            })
          }
          style={{ ...solid, opacity: busy || !name.trim() ? 0.45 : 1 }}
        >
          {t("Create team", "新建团队")}
        </button>
      </div>

      {teams.length === 0 ? (
        <p style={{ fontSize: 11.5, color: "#999999", lineHeight: 1.6, margin: 0 }}>
          {t(
            "There are no teams yet. Make one above, then open it to put people on it — the Team column and the filter at the top of this screen read the result.",
            "还没有任何团队。请在上方新建一个，然后展开它来添加成员——本页的“团队”列和上方的筛选都会读取结果。",
          )}
        </p>
      ) : null}

      {teams.map((team) => {
        const members = new Set(team.memberIds);
        const expanded = open === team.id;
        return (
          <div key={team.id} style={{ borderTop: "1px solid #f3f3f3", paddingTop: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : team.id)}
                style={{
                  ...ghost,
                  height: 26,
                  border: 0,
                  padding: 0,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "#171717",
                }}
              >
                {(zh && team.nameLocal) || team.name}
                {team.nameLocal && !zh ? (
                  <span style={{ color: "#999999", fontWeight: 400 }}> {team.nameLocal}</span>
                ) : null}
              </button>
              <span style={{ fontSize: 11.5, color: "#999999" }}>
                {team.memberIds.length} {t("on it", "人")}
              </span>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : team.id)}
                style={{ ...ghost, height: 24, fontSize: 11, marginLeft: "auto" }}
              >
                {expanded ? t("Done", "收起") : t("Members", "成员")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDissolving(team)}
                style={{ ...ghost, height: 24, fontSize: 11 }}
              >
                {t("Dissolve", "解散")}
              </button>
            </div>

            {expanded ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "9px 0 3px" }}>
                {people.map((p) => {
                  const on = members.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      aria-pressed={on}
                      onClick={() => onMember(team.id, p.id, !on)}
                      style={{
                        height: 26,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: on ? "1px solid #171717" : "1px solid #ededed",
                        background: on ? "#171717" : "#fff",
                        color: on ? "#fff" : "#525252",
                        fontSize: 11.5,
                        fontFamily: "inherit",
                        letterSpacing: "inherit",
                        cursor: busy ? "default" : "pointer",
                      }}
                    >
                      {(zh && p.nameLocal) || p.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      {dissolving ? (
        <ConfirmDialog
          danger
          title={t(`Dissolve ${dissolving.name}?`, `解散 ${(zh && dissolving.nameLocal) || dissolving.name}？`)}
          body={t(
            "The team disappears and everybody on it stops being on it. Nobody loses their account, their files or a single module — only the grouping goes.",
            "该团队会被删除，成员关系随之解除。没有人会因此失去账号、文件或任何模块权限，消失的只是这个分组。",
          )}
          confirm={t("Dissolve", "解散")}
          cancel={t("Cancel", "取消")}
          onClose={() => setDissolving(null)}
          onConfirm={() => {
            onDelete(dissolving.id);
            setDissolving(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** "2 min ago", "4 d ago" — the design's own wording. */
function ago(at: Date | null, zh: boolean): string {
  if (!at) return zh ? "从未" : "never";
  const mins = Math.round((Date.now() - at.getTime()) / 60_000);
  if (mins < 2) return zh ? "刚刚" : "just now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours} h ago`;
  return zh ? `${Math.round(hours / 24)} 天前` : `${Math.round(hours / 24)} d ago`;
}

function Entitlements({
  people,
  zh,
  busy,
  viewerId,
  onToggle,
  onRole,
  onStatus,
}: {
  people: PersonRow[];
  zh: boolean;
  busy: boolean;
  viewerId: string;
  onToggle: (userId: string, module: Module, granted: boolean) => void;
  onRole: (userId: string, role: string) => void;
  onStatus: (userId: string, status: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [suspending, setSuspending] = useState<PersonRow | null>(null);

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 14px", lineHeight: 1.6 }}>
        {t(
          "Every box is one grant. Changing one takes effect on that person's next page load, and is written to the audit log.",
          "每个方框就是一项授权。修改会在对方下次加载页面时生效，并记入审计日志。",
        )}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 860 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", minWidth: 190 }}>{t("Person", "成员")}</th>
              <th style={{ ...th, minWidth: 86 }}>{t("Role", "角色")}</th>
              <th style={{ ...th, minWidth: 74 }}>{t("Spend", "花费")}</th>
              {MODULES.map((m) => (
                <th key={m} style={{ ...th, width: 52 }}>
                  <span style={{ display: "inline-block", whiteSpace: "nowrap", fontSize: 10.5 }}>{m}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #f3f3f3" }}>
                <td style={{ ...td, textAlign: "left" }}>
                  <span style={{ display: "block", fontWeight: 500 }}>
                    {(zh && p.nameLocal) || p.name}
                    {p.status === "suspended" && (
                      <span style={{ color: "#e03636", fontSize: 10.5, marginLeft: 6 }}>
                        {t("suspended", "已停用")}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "#999999" }}>{p.email}</span>
                </td>
                <td style={td}>
                  {p.role === "owner" ? (
                    <span style={{ fontSize: 11, color: "#7c7c7c" }}>{t("owner", "所有者")}</span>
                  ) : (
                    <select
                      value={p.role}
                      disabled={busy || p.id === viewerId}
                      onChange={(e) => onRole(p.id, e.target.value)}
                      style={{ ...field, height: 26, fontSize: 11.5, width: 84 }}
                    >
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                      <option value="guest">guest</option>
                    </select>
                  )}
                </td>
                <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: "#7c7c7c" }}>
                  {usd(p.spendMicros)}
                </td>
                {MODULES.map((m) => {
                  const on = p.modules.includes(m);
                  return (
                    <td key={m} style={td}>
                      <button
                        type="button"
                        aria-label={`${p.name} · ${m}`}
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() => onToggle(p.id, m, !on)}
                        style={{
                          width: 17,
                          height: 17,
                          borderRadius: 4,
                          border: on ? "1px solid #171717" : "1px solid #999999",
                          background: on ? "#171717" : "#fff",
                          cursor: busy ? "default" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                        }}
                      >
                        {on && (
                          <svg viewBox="0 0 16 16" style={{ width: 11, height: 11, stroke: "#fff", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                            <path d="M3.6 8.3 6.5 11.2 12.4 5.1" />
                          </svg>
                        )}
                      </button>
                    </td>
                  );
                })}
                <td style={td}>
                  {p.role !== "owner" && p.id !== viewerId && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        p.status === "suspended" ? onStatus(p.id, "active") : setSuspending(p)
                      }
                      style={{ ...ghost, height: 24, fontSize: 11 }}
                    >
                      {p.status === "suspended" ? t("restore", "恢复") : t("suspend", "停用")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {suspending && (
        <ConfirmDialog
          danger
          title={t(`Suspend ${suspending.name}?`, `停用 ${suspending.name}？`)}
          body={t(
            "They stay in the studio and keep their files. They cannot sign in until somebody restores them.",
            "该成员仍在工作室内，文件保留，但在恢复前无法登录。",
          )}
          confirm={t("Suspend", "停用")}
          cancel={t("Cancel", "取消")}
          onClose={() => setSuspending(null)}
          onConfirm={() => onStatus(suspending.id, "suspended")}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- tokens */

function Tokens({
  usage,
  zh,
}: {
  usage: {
    days: number;
    byModule: UsageSlice[];
    byModel: UsageSlice[];
    byPerson: UsageSlice[];
    daily: { day: string; costMicros: number }[];
  };
  zh: boolean;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const total = usage.byModule.reduce((n, r) => n + r.costMicros, 0);
  const peak = Math.max(1, ...usage.daily.map((d) => d.costMicros));

  if (!usage.byModule.length) {
    return (
      <Empty
        title={t("Nothing has been spent yet", "还没有产生花费")}
        body={t(
          "Every model call is recorded here as it happens, with the module, the person and the model that answered.",
          "每次模型调用都会即时记录在这里，包含所属模块、使用人和实际回应的模型。",
        )}
      />
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{usd(total)}</span>
        <span style={{ fontSize: 12, color: "#999999" }}>
          {t(`over the last ${usage.days} days`, `最近 ${usage.days} 天`)}
        </span>
      </div>
      <p style={{ fontSize: 11, color: "#c7c7c7", margin: "0 0 18px" }}>
        {t(
          "Recorded when each call returns, so today's figure lags by the length of a turn, not by a day.",
          "在每次调用返回时记录，因此今天的数字只落后一次对话的时间，而不是一天。",
        )}
      </p>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 64, marginBottom: 22 }}>
        {usage.daily.map((d) => (
          <div
            key={d.day}
            title={`${d.day} · ${usd(d.costMicros)}`}
            style={{
              flexGrow: 1,
              minWidth: 3,
              height: `${Math.max(2, Math.round((d.costMicros / peak) * 100))}%`,
              background: "#007be0",
              borderRadius: 2,
              opacity: 0.85,
            }}
          />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 22 }}>
        <Slice title={t("By module", "按模块")} rows={usage.byModule} zh={zh} />
        <Slice title={t("By person", "按成员")} rows={usage.byPerson} zh={zh} />
        <Slice title={t("By model", "按模型")} rows={usage.byModel} zh={zh} />
      </div>
    </>
  );
}

function Slice({ title, rows, zh }: { title: string; rows: UsageSlice[]; zh: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.costMicros));
  return (
    <div>
      <div className="lbl" style={{ padding: 0, marginBottom: 8 }}>
        {title}
      </div>
      {rows.length === 0 && (
        <p style={{ fontSize: 11.5, color: "#c7c7c7", margin: 0 }}>{zh ? "暂无" : "nothing yet"}</p>
      )}
      {rows.map((r) => (
        <div key={r.key} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.label}
            </span>
            <span style={{ marginLeft: "auto", color: "#7c7c7c", fontVariantNumeric: "tabular-nums" }}>
              {usd(r.costMicros)}
            </span>
          </div>
          <div style={{ height: 4, background: "#f3f3f3", borderRadius: 2, marginTop: 4 }}>
            <div
              style={{
                height: "100%",
                width: `${Math.round((r.costMicros / max) * 100)}%`,
                background: "#383838",
                borderRadius: 2,
              }}
            />
          </div>
          <div style={{ fontSize: 10.5, color: "#c7c7c7", marginTop: 2 }}>
            {r.calls} {zh ? "次调用" : "calls"} · {r.tokens.toLocaleString()} {zh ? "个 token" : "tokens"}
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- budgets */

function Budgets({
  budgets,
  people,
  zh,
  busy,
  onSet,
  onRemove,
}: {
  budgets: BudgetRow[];
  people: PersonRow[];
  zh: boolean;
  busy: boolean;
  onSet: (input: { scope: string; scopeId: string; dollars: number; period: string | null }) => void;
  onRemove: (budgetId: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [scope, setScope] = useState<"tenant" | "user">("tenant");
  const [scopeId, setScopeId] = useState("");
  const [dollars, setDollars] = useState("");

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 16px", lineHeight: 1.6 }}>
        {t(
          "The ledger already stops a call that would cross a cap. This is where the caps come from.",
          "账本已经会拦截超出上限的调用。这里就是这些上限的来源。",
        )}
      </p>

      {budgets.map((b) => {
        const pct = b.capMicros > 0 ? Math.min(100, Math.round((b.usedMicros / b.capMicros) * 100)) : 0;
        return (
          <div key={b.id} style={{ borderTop: "1px solid #f3f3f3", padding: "11px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 12.5 }}>
              <span style={{ fontWeight: 500 }}>{b.label}</span>
              <span style={{ fontSize: 11, color: "#999999" }}>
                {b.scope}
                {b.period ? ` · ${b.period}` : ` · ${t("all time", "累计")}`}
              </span>
              <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "#7c7c7c" }}>
                {usd(b.usedMicros)} / {usd(b.capMicros)}
              </span>
              <button type="button" disabled={busy} onClick={() => onRemove(b.id)} style={{ ...ghost, height: 24, fontSize: 11 }}>
                {t("remove", "移除")}
              </button>
            </div>
            <div style={{ height: 4, background: "#f3f3f3", borderRadius: 2, marginTop: 6 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "#e03636" : "#383838", borderRadius: 2 }} />
            </div>
          </div>
        );
      })}

      {!budgets.length && (
        <p style={{ fontSize: 12.5, color: "#999999", margin: "0 0 18px" }}>
          {t("No cap is set. Spending is unlimited.", "尚未设置上限，花费不受限制。")}
        </p>
      )}

      <div className="lbl" style={{ padding: 0, margin: "22px 0 8px" }}>
        {t("Set a cap", "设置上限")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "tenant" | "user")}
          style={{ ...field, width: 150, height: 32 }}
        >
          <option value="tenant">{t("The whole studio", "整个工作室")}</option>
          <option value="user">{t("One person", "单个成员")}</option>
        </select>
        {scope === "user" && (
          <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} style={{ ...field, width: 190, height: 32 }}>
            <option value="">{t("Choose somebody", "选择成员")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {(zh && p.nameLocal) || p.name}
              </option>
            ))}
          </select>
        )}
        <input
          value={dollars}
          onChange={(e) => setDollars(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder={t("US$ per month", "每月美元")}
          inputMode="decimal"
          style={{ ...field, width: 140, height: 32 }}
        />
        <button
          type="button"
          disabled={busy || !dollars || (scope === "user" && !scopeId)}
          onClick={() =>
            onSet({
              scope,
              scopeId: scope === "user" ? scopeId : "",
              dollars: Number(dollars),
              period: new Date().toISOString().slice(0, 7),
            })
          }
          style={{ ...solid, opacity: busy || !dollars ? 0.45 : 1 }}
        >
          {t("Set", "设置")}
        </button>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- credentials */

function Credentials({
  keys,
  connections,
  zh,
}: {
  keys: KeyRow[];
  connections: {
    id: string;
    platform: string;
    name: string;
    status: string;
    scopes: string[];
    canPost: boolean;
    needsReconnect: boolean;
    tokenExpiresAt: Date | null;
    issues: string[];
  }[];
  zh: boolean;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  return (
    <>
      <div className="lbl" style={{ padding: 0, marginBottom: 6 }}>
        {t("Keys this deployment holds", "本部署已配置的密钥")}
      </div>
      <p style={{ fontSize: 11.5, color: "#999999", margin: "0 0 12px", lineHeight: 1.6 }}>
        {t(
          "Referenced, never displayed. Not the value, not a prefix, not the last four characters.",
          "只显示是否配置，绝不展示内容：不显示值，不显示前缀，也不显示末四位。",
        )}
      </p>
      {keys.map((k) => (
        <div key={k.name} style={{ display: "flex", gap: 10, alignItems: "baseline", borderTop: "1px solid #f3f3f3", padding: "9px 0" }}>
          <code style={{ fontSize: 11.5, color: "#383838", minWidth: 190 }}>{k.name}</code>
          <span style={{ fontSize: 11.5, color: "#999999", flexGrow: 1 }}>{k.unlocks}</span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              color: k.set ? "#278f5e" : "#c7c7c7",
              whiteSpace: "nowrap",
            }}
          >
            {k.set ? t("set", "已配置") : t("not set", "未配置")}
          </span>
        </div>
      ))}

      <div className="lbl" style={{ padding: 0, margin: "26px 0 8px" }}>
        {t("Connected channels", "已连接渠道")}
      </div>
      {connections.length === 0 ? (
        <p style={{ fontSize: 12, color: "#999999", margin: 0 }}>{t("None.", "暂无。")}</p>
      ) : (
        connections.map((c) => (
          <div key={c.id} style={{ borderTop: "1px solid #f3f3f3", padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5 }}>
              <span style={{ fontWeight: 500 }}>{c.name}</span>
              <span style={{ fontSize: 11, color: "#999999" }}>{c.platform}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: c.needsReconnect ? "#e03636" : "#278f5e" }}>
                {c.needsReconnect ? t("needs reconnecting", "需重新连接") : c.status}
              </span>
            </div>
            {c.scopes.length > 0 && (
              <p style={{ fontSize: 11, color: "#c7c7c7", margin: "5px 0 0", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                {c.scopes.join(" · ")}
              </p>
            )}
          </div>
        ))
      )}
    </>
  );
}

/* --------------------------------------------------------------- audit */

function Audit({ rows, actions, zh }: { rows: AuditRow[]; actions: string[]; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [filter, setFilter] = useState("");
  /* A grid of posters writes one `file.thumbnail` per picture, and forty of
     them buried everything a person actually did. Hidden unless asked for. */
  const [thumbs, setThumbs] = useState(false);
  const shown = rows.filter((r) => (filter ? r.action === filter : thumbs || r.action !== "file.thumbnail"));

  /* One group per person, closed: the admin opens the one they came for
     instead of reading everybody's activity interleaved. */
  const groups = new Map<string, AuditRow[]>();
  for (const r of shown) {
    const key = r.actorName ?? t("System", "系统");
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...field, width: 240, height: 30 }}>
          <option value="">{t("Every action", "全部操作")}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#7c7c7c" }}>
          <input type="checkbox" checked={thumbs} onChange={(e) => setThumbs(e.target.checked)} />
          {t("Show thumbnail views", "显示缩略图查看记录")}
        </label>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {t(
            "Includes an administrator opening somebody else's file.",
            "包含管理员查看他人文件的记录。",
          )}
        </span>
      </div>

      {[...groups.entries()].map(([name, list]) => (
        <details key={name} style={{ borderTop: "1px solid #ededed" }}>
          <summary style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "11px 0", cursor: "pointer", fontSize: 12.5, listStyle: "none" }}>
            <span style={{ color: "#999999", fontSize: 10 }}>▸</span>
            <span style={{ fontWeight: 500 }}>{name}</span>
            <span style={{ fontSize: 11.5, color: "#999999" }}>
              {list.length} {t(list.length === 1 ? "event" : "events", "条记录")}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#999999" }}>
              {t("last", "最近")} {list[0].at.toISOString().slice(0, 16).replace("T", " ")}
            </span>
          </summary>
          <div style={{ paddingBottom: 8 }}>
            {list.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 12, borderTop: "1px solid #f6f6f6", padding: "8px 0 8px 18px", fontSize: 12 }}>
                <span style={{ width: 128, color: "#999999", fontSize: 11.5, flexShrink: 0 }}>
                  {r.at.toISOString().slice(0, 16).replace("T", " ")}
                </span>
                <code style={{ width: 210, flexShrink: 0, fontSize: 11.5, color: "#383838" }}>{r.action}</code>
                <span style={{ minWidth: 0, color: "#7c7c7c", fontSize: 11.5, overflowWrap: "anywhere" }}>
                  {r.objectType ? `${r.objectType} ${r.objectId ?? ""}` : ""}
                  {Object.keys(r.meta).length ? ` · ${JSON.stringify(r.meta)}` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      ))}

      {!shown.length && (
        <p style={{ fontSize: 12.5, color: "#999999", margin: "12px 0 0" }}>{t("Nothing recorded.", "暂无记录。")}</p>
      )}
    </>
  );
}

/* ------------------------------------------------------------ knowledge */

const KINDS = ["instructions", "style", "skill", "example"] as const;
const SCOPES = ["tenant", "module", "role"] as const;

function Knowledge({
  rows,
  zh,
  busy,
  onSave,
  onActive,
  onRollback,
}: {
  rows: KnowledgeRow[];
  zh: boolean;
  busy: boolean;
  onSave: (
    input: { id?: string | null; kind: string; scope: string; scopeValue: string | null; title: string; body: string },
    after?: () => void,
  ) => void;
  onActive: (id: string, active: boolean) => void;
  onRollback: (id: string, version: number) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [editing, setEditing] = useState<KnowledgeRow | "new" | null>(null);
  const [history, setHistory] = useState<
    { version: number; body: string; note: string | null; authorName: string | null; createdAt: string }[] | null
  >(null);

  const blank = { kind: "instructions", scope: "tenant", scopeValue: null, title: "", body: "" };
  const draftFrom = editing === "new" || editing === null ? blank : editing;

  const [form, setForm] = useState<{
    kind: string;
    scope: string;
    scopeValue: string | null;
    title: string;
    body: string;
  }>(blank);

  function open(row: KnowledgeRow | "new") {
    setEditing(row);
    setHistory(null);
    setForm(
      row === "new"
        ? blank
        : { kind: row.kind, scope: row.scope, scopeValue: row.scopeValue, title: row.title, body: row.body },
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <p style={{ fontSize: 12, color: "#999999", margin: 0, lineHeight: 1.6, flexGrow: 1 }}>
          {t(
            "What the agent is told, before anybody says anything to it. Four kinds, three scopes, with a version history.",
            "在任何人开口之前，助理已经被告知的内容。四种类型、三种范围，带版本历史。",
          )}
        </p>
        <button type="button" onClick={() => open("new")} style={solid}>
          {t("Add", "新增")}
        </button>
      </div>

      {rows.map((r) => (
        <div key={r.id} style={{ borderTop: "1px solid #f3f3f3", padding: "11px 0" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, opacity: r.active ? 1 : 0.5 }}>{r.title}</span>
            <span style={{ fontSize: 10.5, color: "#999999" }}>
              {r.kind} · {r.scope}
              {r.scopeValue ? `:${r.scopeValue}` : ""} · v{r.version}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onActive(r.id, !r.active)}
              style={{ ...ghost, marginLeft: "auto", height: 24, fontSize: 11 }}
            >
              {r.active ? t("switch off", "停用") : t("switch on", "启用")}
            </button>
            <button type="button" onClick={() => open(r)} style={{ ...ghost, height: 24, fontSize: 11 }}>
              {t("edit", "编辑")}
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: "#7c7c7c", margin: "5px 0 0", lineHeight: 1.55 }}>
            {r.body.slice(0, 180)}
            {r.body.length > 180 ? "…" : ""}
          </p>
        </div>
      ))}

      {!rows.length && (
        <p style={{ fontSize: 12.5, color: "#999999" }}>
          {t("Nothing is set. The agent runs on its built-in instructions alone.", "尚未设置。助理只使用内置指令。")}
        </p>
      )}

      {editing !== null && (
        <div
          onMouseDown={() => setEditing(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 210,
            background: "rgba(23,23,23,0.2)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "7vh 18px 18px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
            style={{
              width: "min(680px, 100%)",
              maxHeight: "84vh",
              display: "flex",
              flexDirection: "column",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #e2e2e2",
              boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
              overflow: "hidden",
              animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
            }}
          >
            <div style={{ padding: "17px 18px 0", overflowY: "auto", minHeight: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {editing === "new" ? t("New knowledge", "新增知识") : draftFrom.title}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} style={{ ...field, width: 150, height: 32 }}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <select value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value, scopeValue: null }))} style={{ ...field, width: 130, height: 32 }}>
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {form.scope === "module" && (
                  <select value={form.scopeValue ?? ""} onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))} style={{ ...field, width: 150, height: 32 }}>
                    <option value="">{t("which module", "哪个模块")}</option>
                    {MODULES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                {form.scope === "role" && (
                  <select value={form.scopeValue ?? ""} onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))} style={{ ...field, width: 150, height: 32 }}>
                    <option value="">{t("which role", "哪个角色")}</option>
                    {["owner", "admin", "member", "guest"].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t("A name for it", "名称")}
                style={{ ...field, marginTop: 8 }}
              />
              <textarea
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder={t("What the agent should know or do.", "助理应知道或遵循的内容。")}
                style={{ ...field, marginTop: 8, minHeight: 210, resize: "vertical", lineHeight: 1.65, padding: "10px 12px" }}
              />

              {editing !== "new" && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await knowledgeHistoryAction(editing.id);
                      setHistory(res.versions);
                    }}
                    style={{ ...ghost, marginTop: 12, height: 26, fontSize: 11.5 }}
                  >
                    {t("Version history", "版本历史")}
                  </button>
                  {history?.map((v) => (
                    <div key={v.version} style={{ borderTop: "1px solid #f3f3f3", padding: "8px 0", fontSize: 11.5 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontWeight: 500 }}>v{v.version}</span>
                        <span style={{ color: "#999999" }}>
                          {v.authorName ?? "—"} · {v.createdAt.slice(0, 10)}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onRollback(editing.id, v.version)}
                          style={{ ...ghost, marginLeft: "auto", height: 22, fontSize: 10.5 }}
                        >
                          {t("roll back to this", "回滚到此版本")}
                        </button>
                      </div>
                      <p style={{ color: "#7c7c7c", margin: "4px 0 0", lineHeight: 1.5 }}>
                        {v.body.slice(0, 160)}
                        {v.body.length > 160 ? "…" : ""}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div style={{ flexShrink: 0, display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 18px 14px", borderTop: "1px solid #f3f3f3" }}>
              <button type="button" onClick={() => setEditing(null)} style={ghost}>
                {t("Cancel", "取消")}
              </button>
              <button
                type="button"
                disabled={busy || !form.title.trim() || !form.body.trim()}
                onClick={() =>
                  onSave(
                    { id: editing === "new" ? null : editing.id, ...form },
                    () => setEditing(null),
                  )
                }
                style={{ ...solid, opacity: busy || !form.title.trim() ? 0.45 : 1 }}
              >
                {t("Save", "保存")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------------------------------------- the prompt */

function PromptPreview({ zh }: { zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [module, setModule] = useState<string>("");
  const [result, setResult] = useState<{ text: string; parts: { id: string; title: string; kind: string; scope: string }[] } | null>(null);
  const [busy, start] = useTransition();

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 14px", lineHeight: 1.6, maxWidth: 620 }}>
        {t(
          "Exactly what the agent is given before your first word, assembled for you: your role, and only the modules you hold. Spec §9 asks for this, and until now nothing rendered it.",
          "在你说第一句话之前，助理收到的完整内容，按你的角色和你实际拥有的模块拼装。规格书 §9 要求有这个界面，此前一直没有。",
        )}
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <select value={module} onChange={(e) => setModule(e.target.value)} style={{ ...field, width: 190, height: 32 }}>
          <option value="">{t("No module in particular", "不限定模块")}</option>
          {MODULES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const res = await previewPromptAction(module || null);
              if ("error" in res) {
                notify(res.error ?? "Not allowed");
                return;
              }
              setResult({ text: res.text, parts: res.parts });
            })
          }
          style={solid}
        >
          {busy ? t("Assembling…", "组装中…") : t("Show it", "显示")}
        </button>
      </div>

      {result && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
            {result.parts.length === 0 ? (
              <span style={{ fontSize: 11.5, color: "#999999" }}>
                {t("Nothing of the studio's own is in this prompt yet.", "此提示词中还没有工作室自己的内容。")}
              </span>
            ) : (
              result.parts.map((p) => (
                <span
                  key={p.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 21,
                    padding: "0 9px",
                    borderRadius: 11,
                    background: "#f3f3f3",
                    color: "#525252",
                    fontSize: 11,
                  }}
                >
                  {p.title}
                  <span style={{ color: "#999999", marginLeft: 5 }}>
                    {p.kind}/{p.scope}
                  </span>
                </span>
              ))
            )}
          </div>
          <pre
            style={{
              margin: 0,
              padding: 14,
              border: "1px solid #ededed",
              borderRadius: 10,
              background: "#fcfcfc",
              fontSize: 11.5,
              lineHeight: 1.65,
              color: "#383838",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: "50vh",
              overflowY: "auto",
            }}
          >
            {result.text}
          </pre>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- fragments */

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ maxWidth: 460, padding: "26px 0" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.65, margin: "7px 0 0" }}>{body}</p>
    </div>
  );
}

/** Millionths of a dollar, as money. */
function usd(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return "<$0.01";
  return `$${dollars.toFixed(dollars < 100 ? 2 : 0)}`;
}

const th: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 10.5,
  fontWeight: 500,
  color: "#999999",
  textAlign: "center",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = { padding: "9px 8px", textAlign: "center", verticalAlign: "middle" };

const field: React.CSSProperties = {
  width: "100%",
  height: 34,
  padding: "0 10px",
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  outline: "none",
  background: "#fff",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  color: "#171717",
};

const ghost: React.CSSProperties = {
  height: 30,
  padding: "0 11px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

const solid: React.CSSProperties = {
  height: 30,
  padding: "0 14px",
  borderRadius: 8,
  border: 0,
  background: "#171717",
  color: "#fff",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};
