"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { MODELS, answeringModel, modelFor } from "@/lib/ai/models";
import { modelChoice, setModelChoice } from "@/lib/ai/choice";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";

/**
 * Choosing the model, from inside the product.
 *
 * It used to be three environment variables on a box, which meant the studio
 * could not see what it was paying for or change it — and the one switch that
 * silently overrode all of them (`AI_PREFER_DEEPSEEK`) was invisible too. This
 * is the same decision, made where the money is spent, by the people who spend
 * it.
 *
 * Only an owner or an administrator may change it: it is one setting for the
 * whole studio and it has a price attached to every turn.
 */
export type ModelOption = {
  id: string;
  label: string;
  use: string;
  inPerM: number;
  outPerM: number;
  tier: "paid" | "free";
  /** True for the one answering right now. */
  current: boolean;
};

export async function modelOptionsAction(): Promise<{
  options?: ModelOption[];
  answering?: string;
  canChoose?: boolean;
  note?: string;
  error?: string;
}> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Not signed in" };

  const chosen = modelFor.assistant();
  const answering = answeringModel();
  const preferDeepseek = modelChoice().preferDeepseek === true;

  const options: ModelOption[] = MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    use: m.use,
    inPerM: m.inPerM,
    outPerM: m.outPerM,
    tier: m.tier,
    current: m.id === chosen && !preferDeepseek,
  }));

  /* DeepSeek is not in the OpenRouter catalogue but it is what answers when
     the studio has told it to, so it belongs in the list rather than being a
     surprise under it. */
  if (env.deepseek.configured) {
    options.push({
      id: "deepseek:direct",
      label: "DeepSeek (direct)",
      use: "The studio's own DeepSeek key, billed by DeepSeek. Cheapest, weakest at multi-step edits.",
      inPerM: 0.28,
      outPerM: 0.42,
      tier: "paid",
      current: preferDeepseek,
    });
  }

  return {
    options,
    answering,
    canChoose: viewer.role === "owner" || viewer.role === "admin",
    note:
      answering !== chosen
        ? `Chosen: ${chosen}. Answering: ${answering}.`
        : undefined,
  };
}

export async function chooseModelAction(id: string) {
  const viewer = await getViewer();
  if (!viewer) return { error: "Not signed in" };
  if (viewer.role !== "owner" && viewer.role !== "admin") {
    return { error: "Only an owner or an administrator changes the studio's model." };
  }
  if (typeof id !== "string" || id.length > 120) return { error: "That is not a model" };

  const current = modelChoice();

  if (id === "deepseek:direct") {
    if (!env.deepseek.configured) return { error: "There is no DeepSeek key on this deployment." };
    await setModelChoice({ ...current, preferDeepseek: true }, viewer.id);
  } else {
    if (!MODELS.some((m) => m.id === id)) return { error: "That model is not in the catalogue." };
    /* Picking a real model also turns the DeepSeek override off — otherwise
       the choice would appear to do nothing, which is the bug this screen
       exists to end. */
    await setModelChoice({ ...current, assistant: id, preferDeepseek: false }, viewer.id);
  }

  await audit(viewer, "admin.model.change", { module: "admin", meta: { model: id } });
  revalidatePath("/", "layout");
  return { model: answeringModel() };
}
