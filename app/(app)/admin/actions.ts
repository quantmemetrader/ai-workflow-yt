"use server";

import { emailConfigured, inviteEmail, sendEmail } from "@/lib/email/send";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { getViewer } from "@/lib/auth/dal";
import { db } from "@/lib/db/client";
import { MODULES, users, type Module } from "@/lib/db/schema";
import { assemblePrompt } from "@/lib/ai/prompt";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { canInvite, createInvite, createAccountNow } from "@/lib/invites/service";
import { createTeam, deleteTeam, setTeamMember } from "@/lib/teams/service";
import {
  isAdmin,
  knowledgeHistory,
  removeBudget,
  rollbackKnowledge,
  saveKnowledge,
  setBudget,
  setEntitlement,
  setKnowledgeActive,
  setUserRole,
  setUserStatus,
  setWorkRole,
} from "@/lib/admin/service";
import { isProductionKey } from "@/lib/agents/catalog";

/**
 * Admin, from the screen.
 *
 * Every one of these grants access, changes a cap or rewrites what the agent
 * is told. So each re-reads the viewer and re-checks the role: a server action
 * is a public endpoint whatever the screen around it looked like, and this is
 * the module where that matters most.
 */
async function admin() {
  const viewer = await getViewer();
  if (!viewer || !isAdmin(viewer)) return null;
  return viewer;
}

const refresh = () => revalidatePath("/admin");
const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);
const isModule = (v: unknown): v is Module =>
  typeof v === "string" && (MODULES as readonly string[]).includes(v);

export async function setEntitlementAction(userId: string, module: string, granted: boolean) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(userId) || !isModule(module)) return { error: "没有权限" };

  try {
    await setEntitlement(viewer, userId, module, Boolean(granted));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能改好，稍后再试" };
  }
}

export async function setRoleAction(userId: string, role: string) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(userId)) return { error: "没有权限" };
  if (role !== "admin" && role !== "member" && role !== "guest") return { error: "没有这个角色" };

  try {
    await setUserRole(viewer, userId, role);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能改好，稍后再试" };
  }
}

/** A person's job (岗位), which picks their Home. Empty or null clears it. */
export async function setWorkRoleAction(userId: string, role: string | null) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(userId)) return { error: "没有权限" };
  const next = role === null || role === "" ? null : isProductionKey(role) ? role : undefined;
  if (next === undefined) return { error: "没有这个岗位" };

  try {
    await setWorkRole(viewer, userId, next);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能改好，稍后再试" };
  }
}

export async function setStatusAction(userId: string, status: string) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(userId)) return { error: "没有权限" };
  if (status !== "active" && status !== "suspended") return { error: "没有这个状态" };

  try {
    await setUserStatus(viewer, userId, status);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能改好，稍后再试" };
  }
}

/* --------------------------------------------------------- adding people */

/** What the screen needs back: the link, because nothing sends it. */
export type AddedPerson =
  | { ok: false; error: string }
  | { ok: true; email: string; role: "admin" | "member" | "guest"; expiresAt: string; link: string; emailed?: boolean; emailError?: string | null };

/**
 * The address the person is using right now, for the link they will pass on.
 *
 * `APP_URL` on the box has been the bare IP and port before now, which turned
 * every copied invitation into a link to somewhere the recipient cannot
 * reach. The request already knows the host it arrived on; the env is only
 * the fallback for a call with no host header.
 */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return env.appUrl.replace(/\/$/, "");
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Adding somebody, from the People screen.
 *
 * The invitation itself is `lib/invites/service.ts` — the same one Settings
 * and the chat rail already use, not a second way in, so an account can only
 * ever be born one way. Only the permission check is repeated here, because a
 * server action is a public endpoint whatever the screen around it looked
 * like, and this one creates accounts. `canInvite` rather than `isAdmin`:
 * they are the same two roles today, and the day they stop being the same,
 * inviting should follow the invite rule.
 */
export async function addPersonAction(input: {
  email: string;
  name?: string;
  role?: string;
  modules?: string[];
}): Promise<AddedPerson> {
  const viewer = await getViewer();
  if (!viewer || !canInvite(viewer)) {
    return { ok: false, error: "只有所有者或管理员可以添加成员" };
  }

  const role =
    input.role === "admin" || input.role === "member" || input.role === "guest" ? input.role : "member";
  const modules = (input.modules ?? []).filter(isModule);
  if (!modules.length) return { ok: false, error: "至少选一个对方可以打开的模块" };

  try {
    const { invite, token } = await createInvite(viewer, {
      email: String(input.email ?? ""),
      name: input.name,
      role,
      modules,
    });
    refresh();
    /*
     * No mail provider is configured on this deployment, so nothing is sent.
     * The link goes back to whoever made the invitation, to pass on however
     * they normally would. A screen that said "invitation sent" would be a
     * screen telling a lie.
     */
    const link = `${await origin()}/invite/${token}`;
    /* Emailed when the deployment has a mail service (RESEND_API_KEY or SMTP_URL); the link comes back either way. */
    let emailed = false;
    let emailError: string | null = null;
    if (emailConfigured()) {
      const mail = inviteEmail({ to: invite.email, inviter: viewer.nameLocal || viewer.name, link, expires: invite.expiresAt.toISOString().slice(0, 10) });
      const sent = await sendEmail({ to: invite.email, ...mail });
      emailed = sent.ok;
      if (!sent.ok) {
        emailError = sent.error;
        console.error("[invite] email failed", sent.error);
      }
    }
    return {
      ok: true,
      email: invite.email,
      role,
      expiresAt: invite.expiresAt.toISOString(),
      link,
      emailed,
      emailError,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "没能添加这个人，稍后再试" };
  }
}

/** 直接创建账号: made now, with a generated password to send yourself. */
export async function createAccountAction(input: { email: string; name?: string; role?: string; modules?: string[] }): Promise<{ ok: true; email: string; password: string; loginUrl: string } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer || !canInvite(viewer)) return { ok: false, error: "只有所有者或管理员可以添加成员" };
  const role = input.role === "admin" || input.role === "member" || input.role === "guest" ? input.role : "member";
  const modules = (input.modules ?? []).filter(isModule);
  if (!modules.length) return { ok: false, error: "至少选一个对方可以打开的模块" };
  try {
    const made = await createAccountNow(viewer, { email: String(input.email ?? ""), name: input.name, role, modules });
    refresh();
    return { ok: true, email: made.email, password: made.password, loginUrl: `${await origin()}/login` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "没能添加这个人，稍后再试" };
  }
}

/**
 * A colleague's name and job title, from their row.
 *
 * The twin of `updateProfileAction` in Settings, which says in as many words
 * that renaming somebody else is "a different action, in Admin, and it is
 * audited as one". This is that action.
 *
 * The role rule does not carry over wholesale. Changing your own *role* is
 * refused because it is how an administrator locks the studio; fixing the
 * spelling of your own name is not, and Settings already allows it. What is
 * guarded is the owner's row: only the owner renames the owner.
 */
export async function setProfileAction(
  userId: string,
  input: { name: string; nameLocal: string; title: string },
) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(userId)) return { error: "没有权限" };

  const name = String(input.name ?? "").trim();
  const nameLocal = String(input.nameLocal ?? "").trim();
  const title = String(input.title ?? "").trim();
  if (!name) return { error: "请填写一个大家看得到的名字" };
  if (name.length > 120 || nameLocal.length > 120 || title.length > 120) {
    return { error: "名字太长了" };
  }

  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt)))
    .limit(1);
  if (!target) return { error: "工作室里找不到这个人" };
  if (target.role === "owner" && viewer.role !== "owner") {
    return { error: "所有者的名字只能由所有者自己改" };
  }

  await db
    .update(users)
    .set({ name, nameLocal: nameLocal || null, title: title || null })
    .where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId)));

  await audit(viewer, "admin.user.profile", {
    objectType: "user",
    objectId: userId,
    module: "admin",
    meta: { name },
  });
  /* The name is in the rail and the top bar too, not only in this table. */
  revalidatePath("/", "layout");
  return {};
}

/* ----------------------------------------------------------------- teams */

export async function createTeamAction(input: { name: string; nameLocal?: string }) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  try {
    const teamId = await createTeam(viewer, {
      name: String(input.name ?? "").slice(0, 80),
      nameLocal: String(input.nameLocal ?? "").slice(0, 80),
    });
    refresh();
    return { id: teamId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能新建团队，稍后再试" };
  }
}

export async function setTeamMemberAction(teamId: string, userId: string, member: boolean) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(teamId) || !id(userId)) return { error: "没有权限" };
  try {
    await setTeamMember(viewer, teamId, userId, Boolean(member));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能改好，稍后再试" };
  }
}

export async function deleteTeamAction(teamId: string) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(teamId)) return { error: "没有权限" };
  try {
    await deleteTeam(viewer, teamId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能解散团队，稍后再试" };
  }
}

/** Caps are entered in dollars on screen and stored in millionths. */
export async function setBudgetAction(input: {
  scope: string;
  scopeId: string;
  dollars: number;
  period: string | null;
}) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (input.scope !== "tenant" && input.scope !== "user" && input.scope !== "team") {
    return { error: "没有这个范围" };
  }
  const dollars = Number(input.dollars);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000) {
    return { error: "请填写一个金额" };
  }

  try {
    await setBudget(viewer, {
      scope: input.scope,
      scopeId: String(input.scopeId ?? "").slice(0, 64) || viewer.tenantId,
      capMicros: Math.round(dollars * 1_000_000),
      period: typeof input.period === "string" && /^\d{4}-\d{2}$/.test(input.period) ? input.period : null,
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能设置上限，稍后再试" };
  }
}

export async function removeBudgetAction(budgetId: string) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(budgetId)) return { error: "没有权限" };
  try {
    await removeBudget(viewer, budgetId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能移除上限，稍后再试" };
  }
}

export async function saveKnowledgeAction(input: {
  id?: string | null;
  kind: string;
  scope: string;
  scopeValue: string | null;
  title: string;
  body: string;
}) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };

  const kinds = ["instructions", "style", "skill", "example"] as const;
  const scopes = ["tenant", "module", "role"] as const;
  if (!(kinds as readonly string[]).includes(input.kind)) return { error: "没有这个类型" };
  if (!(scopes as readonly string[]).includes(input.scope)) return { error: "没有这个范围" };

  try {
    const saved = await saveKnowledge(viewer, {
      id: id(input.id),
      kind: input.kind as (typeof kinds)[number],
      scope: input.scope as (typeof scopes)[number],
      scopeValue: input.scope === "tenant" ? null : String(input.scopeValue ?? "").slice(0, 64) || null,
      title: String(input.title ?? "").slice(0, 200),
      body: String(input.body ?? "").slice(0, 40_000),
    });
    refresh();
    return { id: saved };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能保存，稍后再试" };
  }
}

export async function setKnowledgeActiveAction(knowledgeId: string, active: boolean) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(knowledgeId)) return { error: "没有权限" };
  try {
    await setKnowledgeActive(viewer, knowledgeId, Boolean(active));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能改好，稍后再试" };
  }
}

export async function knowledgeHistoryAction(knowledgeId: string) {
  const viewer = await admin();
  if (!viewer) return { versions: [] };
  if (!id(knowledgeId)) return { versions: [] };
  const versions = await knowledgeHistory(viewer, knowledgeId);
  return {
    versions: versions.map((v) => ({
      version: v.version,
      body: v.body,
      note: v.note,
      authorName: v.authorName,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}

export async function rollbackKnowledgeAction(knowledgeId: string, version: number) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" };
  if (!id(knowledgeId) || !Number.isInteger(version)) return { error: "没有权限" };
  try {
    await rollbackKnowledge(viewer, knowledgeId, version);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能回滚，稍后再试" };
  }
}

/**
 * The assembled prompt, for one module, exactly as the agent receives it.
 *
 * Spec §9 has an acceptance criterion for this ("upload a style file scoped to
 * Script, the preview shows it") that could not pass, because the function
 * that builds the prompt was only ever called by the agent itself and nothing
 * rendered its output.
 *
 * It is assembled **for the person asking**, not for an abstract user: scoping
 * is by role and by the modules that person holds, so a preview built as
 * somebody else would be a preview of a prompt that never runs.
 */
export async function previewPromptAction(module: string | null) {
  const viewer = await admin();
  if (!viewer) return { error: "没有权限" as const };

  const scoped = isModule(module) ? module : undefined;
  const { text, parts } = await assemblePrompt(viewer, scoped);
  return {
    text,
    parts: parts.map((p) => ({ id: p.id, title: p.title, kind: p.kind, scope: p.scope })),
  };
}
