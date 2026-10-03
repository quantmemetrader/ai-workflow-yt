"use client";

import { Ago } from "@/components/ui/Ago";
import { useEffect, useRef, useState, useTransition } from "react";
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
  createAccountAction,
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
  setWorkRoleAction,
  knowledgeHistoryAction,
  type AddedPerson,
} from "@/app/(app)/admin/actions";
import { inviteAction, revokeInviteAction } from "@/app/(app)/chat/invite-actions";
import { isTrainKey } from "@/lib/agents/train-keys";
import { trainName } from "@/components/train/names";
import { notify } from "@/lib/client/notify";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PRODUCTION_KEYS } from "@/lib/agents/catalog";
import { ROLE_LABELS } from "@/lib/home/roles";
import { PersonAvatar } from "@/components/ui/PersonAvatar";

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

export type PendingInvite = { id: string; email: string; role: string; modules: string[]; expiresAt: string };

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
      <ModuleSidebar
      title="Manage employees"
      titleZh="员工管理"
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
            onWorkRole={(userId, role) => run(() => setWorkRoleAction(userId, role || null))}
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
            onWorkRole={(userId, role) => run(() => setWorkRoleAction(userId, role || null))}
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
      attach
          onAsk={(prompt, files) => void agent.send(prompt, files)}
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
    /* (QA, 2 Oct: the pill read 「ent」 and 「tokens」, the tab keys.) */
    ent: ["Entitlements matrix", "权限矩阵"],
    tokens: ["Token dashboard", "用量看板"],
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
const COLUMNS = "minmax(200px,1.6fr) 110px 120px minmax(70px,1fr) 100px 110px minmax(190px,auto)";
/* Below this the roster scrolls sideways instead of squeezing: with the
   assistant panel open the name column was crushed to nothing, the faces
   to slivers, and the headers ran into each other ("memRoler"). */
const ROSTER_MIN = 1000;

/**
 * 岗位: which job a person does, and so which Home they land on.
 *
 * Beside the role select and deliberately not merged with it: `role` is what
 * somebody may do (admin, member, guest), this is what they do (research,
 * script, the edit). "—" means not set — owners and admins then get the
 * overview, members a Home read from their modules. Setting one also grants
 * the chat module, because Home lives behind it.
 */
function WorkRoleSelect({
  value,
  zh,
  disabled,
  onChange,
  width = 108,
}: {
  value: string | null;
  zh: boolean;
  disabled: boolean;
  onChange: (role: string) => void;
  width?: number;
}) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={zh ? "岗位" : "Job"}
      title={zh ? "岗位决定这个人打开首页时看到的版面" : "The job decides which Home this person lands on"}
      style={{ ...field, height: 26, width, fontSize: 11.5 }}
    >
      <option value="">{zh ? "未设" : "Not set"}</option>
      {/* The production line's jobs only: 法务 and 财务 have no Home of
          their own to land on (`HOME_ROLES`). */}
      {PRODUCTION_KEYS.map((k) => (
        <option key={k} value={k}>
          {zh ? ROLE_LABELS[k].zh : ROLE_LABELS[k].en}
        </option>
      ))}
    </select>
  );
}

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
  onWorkRole,
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
  onWorkRole: (userId: string, role: string) => void;
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
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label={t("Team", "团队")} style={{ ...field, width: 150, height: 30 }}>
          <option value="all">{t("Team: All", "团队：全部")}</option>
          {allTeams.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label={t("Role", "角色")} style={{ ...field, width: 150, height: 30 }}>
          <option value="all">{t("Role: All", "角色：全部")}</option>
          {["owner", "admin", "member", "guest"].map((x) => (
            <option key={x} value={x}>
              {roleName(x, zh)}
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

      <div style={{ display: "flex", flexDirection: "column", overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COLUMNS,
            minWidth: ROSTER_MIN,
            gap: 10,
            padding: "0 10px 8px",
            fontSize: 10.5,
            color: "#999999",
            borderBottom: "1px solid #ededed",
          }}
        >
          <span style={clip}>{t("Employee", "成员")}</span>
          <span style={clip}>{t("Role", "角色")}</span>
          <span style={clip}>{t("Job", "岗位")}</span>
          <span style={clip}>{t("Team", "团队")}</span>
          <span style={clip}>{t("Status", "状态")}</span>
          <span style={clip}>{t("Last active", "最近活跃")}</span>
          <span style={clip}>{t("Modules", "模块")}</span>
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
                minWidth: ROSTER_MIN,
                gap: 10,
                alignItems: "center",
                padding: "9px 10px",
                borderBottom: "1px solid #f3f3f3",
                fontSize: 12.5,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <span style={{ display: "flex", flexShrink: 0 }}>
                  <PersonAvatar id={p.id} url={p.avatarUrl} name={(zh && p.nameLocal) || p.name} size={28} />
                </span>
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
                /* Not changeable here — the owner's role, or your own: drawn as
                   a disabled field the size of the dropdowns beside it, grey
                   and centred, with why on hover. A coloured pill read as a
                   fault ("show it disabled, greyish, so it doesn't look like an error"). */
                <span
                  aria-disabled="true"
                  title={p.role === "owner" ? t("The owner's role cannot be changed", "所有者的角色不能在这里修改") : t("You cannot change your own role", "不能修改自己的角色")}
                  style={{ ...field, height: 26, width: 100, fontSize: 11.5, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", background: "#f5f5f4", color: "#9a9a9a", borderColor: "#ececea", cursor: "not-allowed", userSelect: "none" }}
                >
                  {roleName(p.role, zh)}
                </span>
              ) : (
                <select
                  value={p.role}
                  disabled={busy}
                  onChange={(e) => onRole(p.id, e.target.value)}
                  aria-label={t("Role", "角色")}
                  style={{ ...field, height: 26, width: 100, fontSize: 11.5 }}
                >
                  {["admin", "member", "guest"].map((r) => (
                    <option key={r} value={r}>
                      {roleName(r, zh)}
                    </option>
                  ))}
                </select>
              )}

              <WorkRoleSelect value={p.workRole} zh={zh} disabled={busy || !mayEdit(p)} onChange={(r) => onWorkRole(p.id, r)} />

              <span style={{ fontSize: 11.5, color: "#7c7c7c", ...clip }}>
                {p.teams.length ? p.teams.join(", ") : "—"}
              </span>

              <span>
                <Badge tone={p.status === "active" ? "good" : p.status === "invited" ? "warn" : "bad"}>
                  {statusName(p.status, zh)}
                </Badge>
              </span>

              <span style={{ fontSize: 11.5, color: "#999999" }}><Ago iso={p.lastActiveAt} zh={zh} /></span>

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
      {invites.length ? <PendingInvites invites={invites} zh={zh} /> : null}

      {suspending ? (
        <ConfirmDialog
          danger
          title={t(`Suspend ${suspending.name}?`, `停用 ${suspending.nameLocal || suspending.name}？`)}
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
  const [sent, setSent] = useState<{ email: string; link: string; expiresAt: string; emailed?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [made, setMade] = useState<{ email: string; password: string; loginUrl: string } | null>(null);
  const router = useRouter();

  const makeNow = () =>
    start(async () => {
      setError(null);
      const res = await createAccountAction({ email: email.trim(), name: name.trim(), role, modules });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMade({ email: res.email, password: res.password, loginUrl: res.loginUrl });
      setSent(null);
      setCopied(false);
      setEmail("");
      setName("");
      router.refresh();
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await onAdd({ email: email.trim(), name: name.trim(), role, modules });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent({ email: res.email, link: res.link, expiresAt: res.expiresAt, emailed: Boolean((res as { emailed?: boolean }).emailed) });
      setMade(null);
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
          aria-label={t("Email", "邮箱")}
          style={{ ...field, height: 30, width: 240 }}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Their name (optional)", "姓名（可留空）")}
          aria-label={t("Name", "姓名")}
          style={{ ...field, height: 30, width: 190 }}
        />
        <span style={{ display: "flex", gap: 6 }}>
          {(["admin", "member", "guest"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)} style={chip(role === r)}>
              {roleName(r, zh)}
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
              {moduleName(m, zh)}
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
        {busy ? t("Sending…", "发送中…") : t("Send the invitation", "发送邀请")}
      </button>
      <button
        type="button"
        disabled={busy || !email.trim() || modules.length === 0}
        onClick={makeNow}
        style={{ ...ghost, alignSelf: "flex-start", opacity: busy || !email.trim() || modules.length === 0 ? 0.45 : 1 }}
      >
        {t("Or create the account now (password generated)", "或者直接创建账号（自动生成密码）")}
      </button>

      {made ? (
        <div style={{ border: "1px solid #c8e6c9", background: "#f1f8f2", borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 12, color: "#1e7a4f", lineHeight: 1.6, margin: 0 }}>
            {t("Account created. Send these to them (WeChat, in person); they can change the password in Settings.", "账号已创建。把下面的登录信息发给对方（微信或当面），登录后可以在「设置」里改密码。")}
          </p>
          <code style={{ display: "block", marginTop: 8, background: "#fff", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#262626", whiteSpace: "pre-wrap" }}>
            {`${t("Login", "登录网址")}: ${made.loginUrl}\n${t("Email", "邮箱")}: ${made.email}\n${t("Password", "密码")}: ${made.password}`}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(`${t("Login", "登录网址")}: ${made.loginUrl}\n${t("Email", "邮箱")}: ${made.email}\n${t("Password", "密码")}: ${made.password}`);
              setCopied(true);
            }}
            style={{ ...ghost, height: 28, marginTop: 8 }}
          >
            {copied ? t("Copied", "已复制") : t("Copy all", "全部复制")}
          </button>
        </div>
      ) : null}

      {sent ? (
        <div style={{ border: "1px solid #c8e6c9", background: "#f1f8f2", borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 12, color: "#1e7a4f", lineHeight: 1.6, margin: 0 }}>
            {t(
              sent.emailed
                ? `The invitation email is on its way to ${sent.email}. They open it, set their name and password, and are signed in. You can also send the link yourself. It works once, until ${sent.expiresAt.slice(0, 10)}.`
                : `Invitation link for ${sent.email} is ready. Send it to them (WeChat, in person): they open it, set their name and password, and are signed in. It works once, until ${sent.expiresAt.slice(0, 10)}.`,
              sent.emailed
                ? `邀请邮件已发送到 ${sent.email}。对方打开邮件里的按钮，填写姓名、设置密码就能登录。也可以把下面的链接直接发给对方。链接只能用一次，有效期至 ${sent.expiresAt.slice(0, 10)}。`
                : `${sent.email} 的邀请链接已生成。把链接发给对方（微信或当面）：打开后自己填写姓名、设置密码就能登录。链接只能用一次，有效期至 ${sent.expiresAt.slice(0, 10)}。`,
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
            "There are no teams yet. Make one above, then open it to put people on it. The Team column and the filter at the top follow it.",
            "还没有团队。先在上方新建一个，再展开它添加成员，本页的「团队」列和筛选会跟着更新。",
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

function Entitlements({
  people,
  zh,
  busy,
  viewerId,
  onToggle,
  onRole,
  onWorkRole,
  onStatus,
}: {
  people: PersonRow[];
  zh: boolean;
  busy: boolean;
  viewerId: string;
  onToggle: (userId: string, module: Module, granted: boolean) => void;
  onRole: (userId: string, role: string) => void;
  onWorkRole: (userId: string, role: string) => void;
  onStatus: (userId: string, status: string) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [suspending, setSuspending] = useState<PersonRow | null>(null);
  /* (QA, 2 Oct: at 1280px only 6 of 11 module columns showed and the sideways
     scroll had no visible cue.) Columns are narrower now, the name column
     stays put while scrolling, and when the table is still wider than the
     pane a line says so and the right edge fades. */
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<{ more: boolean; atEnd: boolean }>({ more: false, atEnd: true });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOverflow({ more: el.scrollWidth > el.clientWidth + 2, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    check();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, []);
  const sticky: React.CSSProperties = { position: "sticky", left: 0, background: "#fff", zIndex: 1 };

  return (
    <>
      <p style={{ fontSize: 12, color: "#999999", margin: "0 0 14px", lineHeight: 1.6 }}>
        {t(
          "Every box is one grant. Changing one takes effect on that person's next page load, and is written to the audit log.",
          "每个方框就是一项授权。修改会在对方下次加载页面时生效，并记入审计日志。",
        )}
      </p>

      {overflow.more ? (
        <p style={{ fontSize: 11.5, color: "#7c7c7c", margin: "0 0 8px" }}>
          {t("The table is wider than the pane: scroll sideways for the rest of the modules.", "表格比窗口宽，左右滑动可以看到其余模块。")}
        </p>
      ) : null}
      <div style={{ position: "relative" }}>
      <div ref={scroller} style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...th, ...sticky, textAlign: "left", minWidth: 150 }}>{t("Person", "成员")}</th>
              <th style={{ ...th, minWidth: 76 }}>{t("Role", "角色")}</th>
              <th style={{ ...th, minWidth: 92 }}>{t("Job", "岗位")}</th>
              <th style={{ ...th, minWidth: 54 }}>{t("Spend", "花费")}</th>
              {MODULES.map((m) => (
                <th key={m} title={moduleName(m, zh)} style={{ ...th, width: zh ? 36 : 52, padding: "6px 2px" }}>
                  <span style={{ display: "inline-block", whiteSpace: "nowrap", fontSize: 10.5 }}>{moduleShort(m, zh)}</span>
                </th>
              ))}
              <th style={{ ...th, minWidth: 44 }}>
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t("Actions", "操作")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #f3f3f3" }}>
                <td style={{ ...td, ...sticky, textAlign: "left", maxWidth: 190 }}>
                  <span style={{ display: "block", fontWeight: 500, ...clip }}>
                    {(zh && p.nameLocal) || p.name}
                    {p.status === "suspended" && (
                      <span style={{ color: "#e03636", fontSize: 10.5, marginLeft: 6 }}>
                        {t("suspended", "已停用")}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "#999999", ...clip }}>{p.email}</span>
                </td>
                <td style={td}>
                  {p.role === "owner" ? (
                    <span style={{ fontSize: 11, color: "#7c7c7c" }}>{t("owner", "所有者")}</span>
                  ) : (
                    <select
                      value={p.role}
                      disabled={busy || p.id === viewerId}
                      onChange={(e) => onRole(p.id, e.target.value)}
                      aria-label={t("Role", "角色")}
                      style={{ ...field, height: 26, fontSize: 11.5, width: 72, padding: "0 4px" }}
                    >
                      {["admin", "member", "guest"].map((r) => (
                        <option key={r} value={r}>
                          {roleName(r, zh)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={td}>
                  {/* The owner's row is the owner's, as on the People screen;
                      this matrix is not told who is looking, so an owner's
                      job is set from People. */}
                  {p.role === "owner" ? (
                    <span style={{ fontSize: 11, color: "#7c7c7c" }}>
                      {p.workRole ? (zh ? ROLE_LABELS[p.workRole].zh : ROLE_LABELS[p.workRole].en) : "—"}
                    </span>
                  ) : (
                    <WorkRoleSelect value={p.workRole} zh={zh} disabled={busy} onChange={(r) => onWorkRole(p.id, r)} width={86} />
                  )}
                </td>
                <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: "#7c7c7c" }}>
                  {usd(p.spendMicros)}
                </td>
                {MODULES.map((m) => {
                  const on = p.modules.includes(m);
                  return (
                    <td key={m} style={{ ...td, padding: "9px 2px" }}>
                      <button
                        type="button"
                        aria-label={`${(zh && p.nameLocal) || p.name} · ${moduleName(m, zh)}`}
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
      {overflow.more && !overflow.atEnd ? (
        <div aria-hidden style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 36, pointerEvents: "none", background: "linear-gradient(to right, rgba(255,255,255,0), #fff)" }} />
      ) : null}
      </div>

      {suspending && (
        <ConfirmDialog
          danger
          title={t(`Suspend ${suspending.name}?`, `停用 ${suspending.nameLocal || suspending.name}？`)}
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
        {/* (QA, 2 Oct: module keys and English account names showed raw.) */}
        <Slice title={t("By module", "按模块")} rows={usage.byModule.map((r) => ({ ...r, label: r.key === "unassigned" ? t("Unassigned", "未归类") : moduleName(r.key, zh) }))} zh={zh} />
        <Slice title={t("By person", "按成员")} rows={usage.byPerson.map((r) => ({ ...r, label: (zh && r.labelLocal) || r.label || t("System", "系统") }))} zh={zh} />
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
              <span style={{ fontWeight: 500 }}>{b.scope === "tenant" ? t("The whole studio", "整个工作室") : b.label}</span>
              <span style={{ fontSize: 11, color: "#999999" }}>
                {({ tenant: t("Studio", "工作室"), user: t("Person", "个人"), team: t("Team", "团队") } as Record<string, string>)[b.scope] ?? b.scope}
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
          <span style={{ fontSize: 11.5, color: "#999999", flexGrow: 1 }}>{zh ? k.unlocksZh : k.unlocks}</span>
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
              <span style={{ fontWeight: 500 }}>{zh ? cjkNameOrder(c.name) : c.name}</span>
              <span style={{ fontSize: 11, color: "#999999" }}>{PLATFORM[c.platform] ?? c.platform}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: c.needsReconnect ? "#e03636" : "#278f5e" }}>
                {c.needsReconnect ? t("needs reconnecting", "需重新连接") : channelStatus(c.status, zh)}
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
    const key = (zh && r.actorNameLocal) || r.actorName || t("System", "系统");
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Action", "操作")} style={{ ...field, width: 240, height: 30 }}>
          <option value="">{t("Every action", "全部操作")}</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {auditPhrase(a, zh)}
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
            <span aria-hidden style={{ color: "#999999", fontSize: 10 }}>▸</span>
            <span style={{ fontWeight: 500 }}>{name}</span>
            <span style={{ fontSize: 11.5, color: "#999999" }}>
              {list.length} {t(list.length === 1 ? "event" : "events", "条记录")}
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#999999" }}>
              {t("last", "最近")} {hkTime(list[0].at)}
            </span>
          </summary>
          <div style={{ paddingBottom: 8 }}>
            {list.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 12, borderTop: "1px solid #f6f6f6", padding: "8px 0 8px 18px", fontSize: 12 }}>
                <span style={{ width: 128, color: "#999999", fontSize: 11.5, flexShrink: 0 }}>
                  {hkTime(r.at)}
                </span>
                {/* (QA, 2 Oct: raw action keys, object ids and JSON.) A phrase,
                    and the few details a person reads; the key stays on hover. */}
                <span title={r.action} style={{ width: 170, flexShrink: 0, fontSize: 12, color: "#383838" }}>{auditPhrase(r.action, zh)}</span>
                <span style={{ minWidth: 0, color: "#7c7c7c", fontSize: 11.5, overflowWrap: "anywhere" }}>
                  {metaText(r.meta, zh)}
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
            {/* (QA, 2 Oct: read 「instructions · module:research · v1」.) */}
            <span style={{ fontSize: 10.5, color: "#999999" }}>
              {kindName(r.kind, zh)} · {scopeText(r.scope, r.scopeValue, zh)} · {zh ? `第 ${r.version} 版` : `v${r.version}`}
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
                <select value={form.kind} aria-label={t("Kind", "类型")} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} style={{ ...field, width: 150, height: 32 }}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindName(k, zh)}
                    </option>
                  ))}
                </select>
                <select value={form.scope} aria-label={t("Scope", "范围")} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value, scopeValue: null }))} style={{ ...field, width: 130, height: 32 }}>
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {scopeName(s, zh)}
                    </option>
                  ))}
                </select>
                {form.scope === "module" && (
                  <select value={form.scopeValue ?? ""} aria-label={t("Module", "模块")} onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))} style={{ ...field, width: 150, height: 32 }}>
                    <option value="">{t("which module", "哪个模块")}</option>
                    {MODULES.map((m) => (
                      <option key={m} value={m}>
                        {moduleName(m, zh)}
                      </option>
                    ))}
                  </select>
                )}
                {form.scope === "role" && (
                  <select value={form.scopeValue ?? ""} aria-label={t("Role", "角色")} onChange={(e) => setForm((f) => ({ ...f, scopeValue: e.target.value }))} style={{ ...field, width: 150, height: 32 }}>
                    <option value="">{t("which role", "哪个角色")}</option>
                    {["owner", "admin", "member", "guest"].map((r) => (
                      <option key={r} value={r}>
                        {roleName(r, zh)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t("A name for it", "名称")}
                aria-label={t("Name", "名称")}
                style={{ ...field, marginTop: 8 }}
              />
              <textarea
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder={t("What the agent should know or do.", "助理应知道或遵循的内容。")}
                aria-label={t("Content", "内容")}
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
          "Exactly what the agent is given before your first word, assembled for your role and only the modules you hold.",
          "你开口之前，助理先收到的全部内容。按你的角色和你能打开的模块拼起来。",
        )}
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <select value={module} onChange={(e) => setModule(e.target.value)} aria-label={t("Module", "模块")} style={{ ...field, width: 190, height: 32 }}>
          <option value="">{t("No module in particular", "不限定模块")}</option>
          {MODULES.map((m) => (
            <option key={m} value={m}>
              {moduleName(m, zh)}
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
                notify(res.error ?? t("Not allowed", "没有权限"));
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
                    {kindName(p.kind, zh)} · {scopeName(p.scope, zh)}
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

/* ---------------------------------------------------- invites, still open */

/**
 * Invited and not joined yet, with the same two moves /settings has: send a
 * fresh link by email, or take the invitation back (QA, 2 Oct: the list here
 * had neither, and showed the role as 「member」).
 */
function PendingInvites({ invites, zh }: { invites: PendingInvite[]; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [sent, setSent] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const linkBtn: React.CSSProperties = { border: 0, background: "none", padding: 0, fontSize: 11.5, color: "#7c7c7c", cursor: "pointer", fontFamily: "inherit" };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #ededed", paddingTop: 10 }}>
      <div style={{ fontSize: 10.5, color: "#999999", marginBottom: 5 }}>{t("Invited, not joined yet", "已邀请，尚未加入")}</div>
      {invites.map((i) => (
        <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0", fontSize: 11.5, color: "#7c7c7c" }}>
          <span style={{ ...clip }}>{i.email}</span>
          <span style={{ color: "#999999" }}>{roleName(i.role, zh)}</span>
          <span style={{ marginLeft: "auto", color: "#999999" }}>
            {t(`expires ${i.expiresAt.slice(0, 10)}`, `有效期至 ${i.expiresAt.slice(0, 10)}`)}
          </span>
          <button
            type="button"
            disabled={busy}
            title={t("Send a fresh link by email", "换一个新链接，再发一次邀请邮件")}
            onClick={() =>
              start(async () => {
                const res = await inviteAction({ email: i.email, role: i.role, modules: i.modules });
                if (!res.ok) {
                  notify(res.error);
                  return;
                }
                setSent({ email: res.email, link: res.link, emailed: res.emailed });
                setCopied(false);
                notify(res.emailed ? t("Invitation sent again", "邀请邮件已重新发送") : t("New link ready", "新链接已生成"), "ok");
                router.refresh();
              })
            }
            style={linkBtn}
          >
            {t("Resend", "重发邮件")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const res = await revokeInviteAction(i.id);
                if (res && "error" in res && res.error) {
                  notify(t(res.error, "没能撤销这个邀请，稍后再试"));
                  return;
                }
                notify(t("Invitation revoked", "邀请已撤销"), "ok");
                router.refresh();
              })
            }
            style={{ ...linkBtn, color: "#b42318" }}
          >
            {t("Revoke", "撤销")}
          </button>
        </div>
      ))}
      {sent ? (
        <div style={{ marginTop: 8, border: "1px solid #c8e6c9", background: "#f1f8f2", borderRadius: 8, padding: 10 }}>
          <p style={{ fontSize: 12, color: "#1e7a4f", lineHeight: 1.6, margin: 0 }}>
            {sent.emailed
              ? t(`A fresh invitation went to ${sent.email}. You can also pass on this link.`, `新的邀请邮件已发到 ${sent.email}，也可以把下面的链接直接发给对方。`)
              : t(`A fresh link for ${sent.email}. Send it to them yourself.`, `${sent.email} 的新链接已生成，请把它发给对方（微信或当面）。`)}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <code style={{ flex: 1, minWidth: 0, background: "#fff", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "#525252", ...clip }}>{sent.link}</code>
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

/* ------------------------------------------------------- words, not keys */

/* (QA, 2 Oct: /admin showed module keys, role keys and audit keys as they are
   stored.) Everything below turns a stored value into what a person reads. */
const MODULE_ZH: Record<string, string> = {
  chat: "聊天",
  files: "文件",
  research: "选题",
  script: "脚本",
  video: "视频",
  publish: "发布",
  accounting: "账务",
  finance: "财务",
  legal: "法务",
  hr: "人事",
  admin: "后台",
};
const MODULE_EN: Record<string, string> = {
  chat: "Chat",
  files: "Files",
  research: "Research",
  script: "Script",
  video: "Video",
  publish: "Publish",
  accounting: "Accounting",
  finance: "Finance",
  legal: "Legal",
  hr: "HR",
  admin: "Admin",
};
function moduleName(m: string, zh: boolean): string {
  return (zh ? MODULE_ZH[m] : MODULE_EN[m]) ?? m;
}
/** The matrix header: the Chinese names are already two characters; English is cut to fit, with the full name on hover. */
function moduleShort(m: string, zh: boolean): string {
  if (zh) return MODULE_ZH[m] ?? m;
  const en = MODULE_EN[m] ?? m;
  return en.length > 6 ? `${en.slice(0, 5)}.` : en;
}

const PLATFORM: Record<string, string> = { youtube: "YouTube", linkedin: "LinkedIn", tiktok: "TikTok", douyin: "抖音", instagram: "Instagram", facebook: "Facebook", x: "X", twitter: "X", bilibili: "哔哩哔哩", xiaohongshu: "小红书" };

function channelStatus(status: string, zh: boolean): string {
  const map: Record<string, [string, string]> = { healthy: ["Healthy", "正常"], active: ["Active", "正常"], expired: ["Expired", "已过期"], error: ["Error", "出错"], disconnected: ["Disconnected", "已断开"], pending: ["Pending", "连接中"] };
  const pair = map[status];
  return pair ? (zh ? pair[1] : pair[0]) : status;
}

/** A Chinese name written given-name first, the way LinkedIn sends it
 * ("亚芳 谢"), back in Chinese order (谢亚芳). Only when both parts are CJK. */
function cjkNameOrder(name: string): string {
  const m = /^([一-鿿]{1,3}) ([一-鿿]{1,2})$/.exec(name.trim());
  return m ? `${m[2]}${m[1]}` : name;
}

/** Studio time (Hong Kong, no daylight saving), the same on server and browser. */
function hkTime(at: Date): string {
  return new Date(new Date(at).getTime() + 8 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

function kindName(kind: string, zh: boolean): string {
  const map: Record<string, [string, string]> = { instructions: ["Instructions", "工作说明"], style: ["Style", "风格"], skill: ["Skill", "技能"], example: ["Example", "示例"] };
  const pair = map[kind];
  return pair ? (zh ? pair[1] : pair[0]) : kind;
}
function scopeName(scope: string, zh: boolean): string {
  const map: Record<string, [string, string]> = { tenant: ["Whole studio", "全工作室"], module: ["One module", "某个模块"], role: ["One role", "某个角色"] };
  const pair = map[scope];
  return pair ? (zh ? pair[1] : pair[0]) : scope;
}
function scopeText(scope: string, value: string | null, zh: boolean): string {
  if (scope === "tenant" || !value) return scopeName(scope, zh);
  if (scope === "module") return zh ? `${moduleName(value, zh)}模块` : `${moduleName(value, zh)} module`;
  const who = isTrainKey(value) ? trainName(value, zh) : roleName(value, zh);
  return zh ? `只给${who}` : `For ${who}`;
}

const AUDIT_ZH: Record<string, string> = {
  "auth.login": "登录",
  "auth.fail": "登录失败",
  "auth.password.change": "修改密码",
  "auth.2fa.begin": "开始设置两步验证",
  "auth.2fa.enable": "开启两步验证",
  "auth.2fa.disable": "关闭两步验证",
  "auth.2fa.challenge": "两步验证",
  "auth.2fa.fail": "两步验证失败",
  "auth.2fa.device.forget": "移除信任设备",
  "auth.2fa.recovery.reissue": "重新生成恢复码",
  "file.thumbnail": "查看缩略图",
  "file.open": "打开文件",
  "file.view": "查看文件",
  "file.open.admin_override": "管理员查看他人文件",
  "file.import": "导入文件",
  "file.upload": "上传文件",
  "file.create": "新建文件",
  "file.edit": "编辑文件",
  "file.delete": "删除文件",
  "file.restore": "恢复文件",
  "file.rename": "重命名文件",
  "file.share": "共享文件",
  "file.unshare": "取消共享",
  "file.access": "修改文件可见范围",
  "file.abandon": "取消上传",
  "file.export": "导出文件",
  "folder.create": "新建文件夹",
  "folder.delete": "删除文件夹",
  "folder.rename": "重命名文件夹",
  "folder.restore": "恢复文件夹",
  "agent.answer": "助理回答",
  "agent.mention.reply": "AI 同事回复",
  "agent.chat.read": "助理读聊天",
  "agent.chat.send": "助理发消息",
  "agent.search": "助理搜索",
  "agent.read": "助理读文件",
  "agent.video": "助理改视频",
  "agent.handoff": "AI 同事交接",
  "agent.assign": "派活",
  "agent.proposal.start": "开始执行提议",
  "agent.research.discover": "研究员找选题",
  "cron.sweep": "每晚清理",
  search: "搜索",
  "chat.channel.create": "新建频道",
  "chat.channel.members.add": "频道加人",
  "chat.channel.members.remove": "频道移除成员",
  "video.project.create": "新建视频项目",
  "video.project.delete": "删除视频项目",
  "video.project.share": "共享视频项目",
  "video.project.unshare": "取消共享视频项目",
  "video.direct.request": "请导演剪辑",
  "video.direct": "导演剪辑完成",
  "video.autoedit": "自动粗剪",
  "video.autoedit.request": "请求自动粗剪",
  "video.transcribe.auto": "自动转写",
  "video.transcribe.request": "请求转写",
  "video.export.request": "导出视频",
  "video.split": "切分片段",
  "video.look": "设置画面风格",
  "video.graphic.add": "添加图形",
  "video.graphic.remove": "移除图形",
  "video.captions.from_voiceover": "按配音生成字幕",
  "video.captions.split": "拆分字幕",
  "video.voiceover.request": "请求配音",
  "script.write": "AI 写稿",
  "script.generate": "AI 生成脚本",
  "script.create": "新建脚本",
  "script.export": "导出脚本",
  "script.restore": "恢复脚本版本",
  "script.unlock": "解锁脚本",
  "script.version.saved": "保存脚本版本",
  "script.share": "共享脚本",
  "script.delete": "删除脚本",
  "script.import": "导入到脚本",
  "script.approval.request": "提交脚本审批",
  "script.approval.approved": "脚本审批通过",
  "research.watch": "关注话题",
  "research.unwatch": "取消关注话题",
  "research.adopt": "采用选题",
  "research.reject": "放弃选题",
  "research.save": "保存选题",
  "research.stage": "选题换阶段",
  "research.plan": "排选题计划",
  "research.export": "导出选题",
  "research.competitor.add": "添加对标频道",
  "research.competitor.remove": "移除对标频道",
  "research.youtube.discover": "在 YouTube 找选题",
  "topic.angles": "生成切入角度",
  "project.create": "新建项目",
  "project.delete": "删除项目",
  "project.access": "修改项目可见范围",
  "project.cut.start": "开始剪辑",
  "project.publish": "发布项目",
  "project.unpublish": "撤下项目",
  "project.publish.place": "登记发布位置",
  "project.unpublish.place": "撤下发布位置",
  "project.from_chat": "从聊天建项目",
  "admin.invite.create": "发出邀请",
  "admin.invite.accept": "接受邀请",
  "admin.invite.revoke": "撤销邀请",
  "admin.model.change": "更换默认模型",
  "admin.model.agent": "更换 AI 同事的模型",
  "admin.entitlement.grant": "修改模块权限",
  "admin.user.role": "修改角色",
  "admin.user.profile": "修改成员资料",
  "admin.team.create": "新建团队",
  "admin.team.delete": "解散团队",
  "admin.budget.set": "设置预算",
  "admin.budget.remove": "移除预算",
  "admin.knowledge.create": "新增知识",
  "admin.knowledge.update": "修改知识",
  "user.avatar.change": "更换头像",
  "user.workRole": "设置岗位",
  "user.profile.change": "修改个人资料",
  "automation.set": "修改自动任务",
  "train.create": "新建训练",
  "train.update": "更新训练",
  "train.restore": "恢复训练版本",
  "train.example.add": "添加训练示例",
  "train.example.update": "修改训练示例",
  "train.example.delete": "删除训练示例",
  "train.example.off": "停用训练示例",
  "publish.post.create": "新建发布",
  "publish.channels.sync": "同步频道",
  "publish.approval.request": "提交发布审批",
  "publish.approval.approve": "发布审批通过",
  "publish.approval.reject": "发布审批退回",
  "publish.retry": "重试发布",
  "channel.connect.start": "开始连接频道",
  "comment.reply.send": "回复评论",
  "comment.reply.fail": "回复评论失败",
  "finance.report.generate": "生成财务报告",
  "finance.spend.raise": "发起用款申请",
  "finance.spend.paid": "用款已付",
  "legal.contract.draft": "起草合同",
  "legal.contract.review": "审阅合同",
  "legal.contract.update": "修改合同",
  "legal.templates.seed": "载入合同模板",
  "legal.checklist.seed": "载入核对清单",
  "legal.checklist.run": "核对条款",
  "hr.balances.seed": "初始化假期余额",
  "hr.leave.request": "申请休假",
  "hr.leave.approved": "批准休假",
  "hr.leave.cancel": "取消休假",
  "hr.entitlement.set": "设置假期额度",
};
const AUDIT_AREA_ZH: Record<string, string> = { file: "文件", folder: "文件夹", video: "视频", script: "脚本", research: "选题", topic: "选题", project: "项目", publish: "发布", finance: "财务", legal: "法务", hr: "人事", accounting: "账务", admin: "后台", train: "训练", agent: "助理", auth: "登录", chat: "聊天", article: "文章", user: "账号", comment: "评论", channel: "频道", automation: "自动任务", cron: "定时任务" };
const AUDIT_VERB_ZH: Record<string, string> = { create: "新建", add: "添加", delete: "删除", remove: "移除", update: "修改", edit: "编辑", set: "设置", save: "保存", request: "申请", approve: "通过", approved: "通过", reject: "退回", share: "共享", unshare: "取消共享", restore: "恢复", export: "导出", import: "导入", generate: "生成", fork: "另存", view: "查看", open: "打开", rename: "重命名", seed: "初始化", publish: "发布", retract: "撤回", cancel: "取消", fail: "失败", archive: "归档", post: "过账", void: "作废", stage: "换阶段", state: "改状态", tick: "勾选", run: "运行", acknowledge: "确认", paid: "已付" };

/** An audit key as a short phrase: the common ones by name, the rest as area and verb. */
function auditPhrase(action: string, zh: boolean): string {
  if (!zh) return action;
  if (AUDIT_ZH[action]) return AUDIT_ZH[action];
  const parts = action.split(".");
  const area = AUDIT_AREA_ZH[parts[0]];
  const verb = AUDIT_VERB_ZH[parts[parts.length - 1]];
  if (area && verb) return `${area}：${verb}`;
  return area ? `${area}操作` : action;
}

const META_LABEL: Record<string, string> = {
  name: "名称",
  title: "标题",
  query: "搜索",
  phrase: "搜索",
  subject: "话题",
  model: "模型",
  relation: "权限",
  role: "角色",
  email: "邮箱",
  format: "格式",
  files: "文件数",
  platform: "平台",
  period: "期间",
  days: "天数",
  year: "年份",
  people: "人数",
  bytes: "大小",
  hits: "结果",
  found: "找到",
  agent: "AI 同事",
  workRole: "岗位",
  versionNo: "版本",
  version: "版本",
  language: "语言",
  aspect: "画幅",
  findings: "问题",
  lines: "行数",
  cuts: "剪切",
  stage: "阶段",
  choice: "可见范围",
  mode: "方式",
  error: "错误",
};
const RELATION_ZH: Record<string, string> = { owner: "所有者", editor: "可编辑", commenter: "可评论", viewer: "可查看" };
const MODE_ZH: Record<string, string> = { private: "仅自己", everyone: "全工作室", groups: "按分组", people: "指定的人", full: "完整流程" };
const ID_LIKE = /\b[a-z]{2,5}_[0-9a-z]{20,}\b/;

/** The few details of an audit line a person reads, without ids or JSON. */
function metaText(meta: Record<string, unknown>, zh: boolean): string {
  const out: string[] = [];
  for (const [k, raw] of Object.entries(meta ?? {})) {
    if (out.length >= 4) break;
    let v: unknown = raw;
    if (k === "choice" && v && typeof v === "object") v = (v as { mode?: unknown }).mode;
    if (v === null || v === undefined || v === "" || typeof v === "boolean" || typeof v === "object") continue;
    let text = String(v);
    if (ID_LIKE.test(text) || /^https?:\/\//.test(text)) continue;
    if (k === "relation") text = zh ? (RELATION_ZH[text] ?? text) : text;
    else if (k === "role") text = roleName(text, zh);
    else if (k === "mode" || k === "choice") text = zh ? (MODE_ZH[text] ?? text) : text;
    else if ((k === "agent" || k === "workRole") && isTrainKey(text)) text = trainName(text, zh);
    else if (k === "bytes" && typeof v === "number") text = v < 1024 ? `${v} B` : v < 1048576 ? `${(v / 1024).toFixed(1)} KB` : `${(v / 1048576).toFixed(1)} MB`;
    if (text.length > 40) text = `${text.slice(0, 40)}…`;
    const label = zh ? META_LABEL[k] : k;
    if (!label) continue;
    out.push(`${label}${zh ? "：" : ": "}${text}`);
  }
  return out.join(" · ");
}

/* Roles and states in words, not the database's values ("owner", "active"). */
function roleName(role: string, zh: boolean): string {
  const zhName: Record<string, string> = { owner: "所有者", admin: "管理员", member: "成员", guest: "访客" };
  const en: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
  return (zh ? zhName[role] : en[role]) ?? role;
}

function statusName(status: string, zh: boolean): string {
  const zhName: Record<string, string> = { active: "在用", invited: "已邀请", suspended: "已停用" };
  const en: Record<string, string> = { active: "Active", invited: "Invited", suspended: "Suspended" };
  return (zh ? zhName[status] : en[status]) ?? status;
}
