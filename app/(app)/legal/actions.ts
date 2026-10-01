"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import {
  acknowledgeFinding,
  draftContract,
  isContractState,
  listFindings,
  reviewContract,
  saveRun,
  saveTemplate,
  seedChecklist,
  seedTemplates,
  updateContract,
} from "@/lib/legal/service";

async function lawyer() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("legal")) return null;
  return viewer;
}

const refresh = () => revalidatePath("/legal");
const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function seedTemplatesAction() {
  const viewer = await lawyer();
  if (!viewer) return { error: "你没有权限这样做" };
  await seedTemplates(viewer);
  await seedChecklist(viewer);
  refresh();
  return {};
}

export async function saveTemplateAction(input: {
  id?: string | null;
  name: string;
  kind: string;
  body: string;
  fields: { key: string; label: string }[];
}) {
  const viewer = await lawyer();
  if (!viewer) return { error: "你没有权限这样做" };
  try {
    await saveTemplate(viewer, {
      id: id(input.id),
      name: String(input.name ?? "").slice(0, 200),
      kind: String(input.kind ?? "agreement").slice(0, 40),
      body: String(input.body ?? "").slice(0, 200_000),
      fields: Array.isArray(input.fields)
        ? input.fields
            .filter((f) => f && typeof f.key === "string" && f.key.trim())
            .map((f) => ({ key: String(f.key).slice(0, 40), label: String(f.label ?? f.key).slice(0, 120) }))
            .slice(0, 40)
        : [],
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能保存，请再试一次" };
  }
}

export async function draftContractAction(input: {
  templateId: string;
  title: string;
  counterparty: string;
  values: Record<string, string>;
}) {
  const viewer = await lawyer();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(input.templateId)) return { error: "请先选一个模板" };

  const [studio] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, viewer.tenantId))
    .limit(1);

  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.values ?? {})) {
    if (typeof k === "string" && typeof v === "string") values[k.slice(0, 40)] = v.slice(0, 2000);
  }

  try {
    const contractId = await draftContract(viewer, {
      templateId: input.templateId,
      title: String(input.title ?? "").slice(0, 300),
      counterparty: String(input.counterparty ?? "").slice(0, 200) || null,
      values,
      studio: studio?.name ?? "the Studio",
    });
    refresh();
    return { id: contractId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能起草，请再试一次" };
  }
}

export async function updateContractAction(
  contractId: string,
  input: { title?: string; body?: string; counterparty?: string; state?: string; signedOn?: string; expiresOn?: string },
) {
  const viewer = await lawyer();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(contractId)) return { error: "找不到这一项" };
  if (input.state !== undefined && !isContractState(input.state)) return { error: "没有这个状态" };

  try {
    await updateContract(viewer, contractId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.counterparty !== undefined ? { counterparty: input.counterparty.slice(0, 200) || null } : {}),
      ...(input.state !== undefined && isContractState(input.state) ? { state: input.state } : {}),
      ...(input.signedOn !== undefined ? { signedOn: day(input.signedOn) } : {}),
      ...(input.expiresOn !== undefined ? { expiresOn: day(input.expiresOn) } : {}),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能保存，请再试一次" };
  }
}

export async function reviewContractAction(contractId: string) {
  const viewer = await lawyer();
  if (!viewer) return { error: "你没有权限这样做" as const };
  if (!id(contractId)) return { error: "找不到这一项" as const };
  try {
    const found = await reviewContract(viewer, contractId);
    refresh();
    return { found };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能核对，请再试一次" };
  }
}

export async function findingsAction(contractId: string) {
  const viewer = await lawyer();
  if (!viewer) return { findings: [] };
  if (!id(contractId)) return { findings: [] };
  const findings = await listFindings(viewer, contractId);
  return {
    findings: findings.map((f) => ({
      id: f.id,
      clause: f.clause,
      templateText: f.templateText,
      contractText: f.contractText,
      explanation: f.explanation,
      departure: f.departure,
      acknowledgedByName: f.acknowledgedByName,
      acknowledged: f.acknowledgedAt !== null,
    })),
  };
}

export async function acknowledgeFindingAction(findingId: string) {
  const viewer = await lawyer();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(findingId)) return { error: "找不到这一项" };
  await acknowledgeFinding(viewer, findingId);
  refresh();
  return {};
}

export async function saveRunAction(input: {
  id?: string | null;
  checklistId: string;
  subject: string;
  answers: Record<string, { value: string; note?: string }>;
  complete: boolean;
}) {
  const viewer = await lawyer();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(input.checklistId)) return { error: "找不到这一项" };

  const answers: Record<string, { value: string; note?: string }> = {};
  for (const [k, v] of Object.entries(input.answers ?? {})) {
    if (typeof k !== "string" || !v || typeof v.value !== "string") continue;
    if (!["yes", "no", "na"].includes(v.value)) continue;
    answers[k.slice(0, 40)] = { value: v.value, note: typeof v.note === "string" ? v.note.slice(0, 500) : undefined };
  }

  try {
    await saveRun(viewer, {
      id: id(input.id),
      checklistId: input.checklistId,
      subject: String(input.subject ?? "").slice(0, 300),
      answers,
      complete: Boolean(input.complete),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能保存，请再试一次" };
  }
}
