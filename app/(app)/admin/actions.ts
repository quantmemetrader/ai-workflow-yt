"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { MODULES, type Module } from "@/lib/db/schema";
import { assemblePrompt } from "@/lib/ai/prompt";
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
} from "@/lib/admin/service";

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
  if (!viewer) return { error: "Not allowed" };
  if (!id(userId) || !isModule(module)) return { error: "Not allowed" };

  try {
    await setEntitlement(viewer, userId, module, Boolean(granted));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

export async function setRoleAction(userId: string, role: string) {
  const viewer = await admin();
  if (!viewer) return { error: "Not allowed" };
  if (!id(userId)) return { error: "Not allowed" };
  if (role !== "admin" && role !== "member" && role !== "guest") return { error: "No such role" };

  try {
    await setUserRole(viewer, userId, role);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

export async function setStatusAction(userId: string, status: string) {
  const viewer = await admin();
  if (!viewer) return { error: "Not allowed" };
  if (!id(userId)) return { error: "Not allowed" };
  if (status !== "active" && status !== "suspended") return { error: "No such status" };

  try {
    await setUserStatus(viewer, userId, status);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
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
  if (!viewer) return { error: "Not allowed" };
  if (input.scope !== "tenant" && input.scope !== "user" && input.scope !== "team") {
    return { error: "No such scope" };
  }
  const dollars = Number(input.dollars);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000) {
    return { error: "That is not an amount" };
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
    return { error: err instanceof Error ? err.message : "Could not set that cap" };
  }
}

export async function removeBudgetAction(budgetId: string) {
  const viewer = await admin();
  if (!viewer) return { error: "Not allowed" };
  if (!id(budgetId)) return { error: "Not allowed" };
  try {
    await removeBudget(viewer, budgetId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove that cap" };
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
  if (!viewer) return { error: "Not allowed" };

  const kinds = ["instructions", "style", "skill", "example"] as const;
  const scopes = ["tenant", "module", "role"] as const;
  if (!(kinds as readonly string[]).includes(input.kind)) return { error: "No such kind" };
  if (!(scopes as readonly string[]).includes(input.scope)) return { error: "No such scope" };

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
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function setKnowledgeActiveAction(knowledgeId: string, active: boolean) {
  const viewer = await admin();
  if (!viewer) return { error: "Not allowed" };
  if (!id(knowledgeId)) return { error: "Not allowed" };
  try {
    await setKnowledgeActive(viewer, knowledgeId, Boolean(active));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
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
  if (!viewer) return { error: "Not allowed" };
  if (!id(knowledgeId) || !Number.isInteger(version)) return { error: "Not allowed" };
  try {
    await rollbackKnowledge(viewer, knowledgeId, version);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not roll back" };
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
  if (!viewer) return { error: "Not allowed" as const };

  const scoped = isModule(module) ? module : undefined;
  const { text, parts } = await assemblePrompt(viewer, scoped);
  return {
    text,
    parts: parts.map((p) => ({ id: p.id, title: p.title, kind: p.kind, scope: p.scope })),
  };
}
