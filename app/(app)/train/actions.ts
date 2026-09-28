"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import {
  TrainError,
  addExample,
  deleteExample,
  isTrainKey,
  restoreTraining,
  saveTrainingText,
  setExampleActive,
  trainingHistory,
  updateExample,
} from "@/lib/agents/training";
import { extractExampleText, tryTraining } from "@/lib/agents/train-try";

/**
 * AI 训练, from the page. Each action re-reads the viewer: a server action
 * is a public endpoint whatever screen it was pressed on.
 */

type Result = { ok: true } | { error: string };

const id = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null);

async function wrap(key: string | null, fn: (viewer: NonNullable<Awaited<ReturnType<typeof getViewer>>>) => Promise<unknown>): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  try {
    await fn(viewer);
  } catch (err) {
    if (err instanceof TrainError) return { error: err.message };
    console.error("[train]", err);
    return { error: "没有保存成功，请再试一次" };
  }
  revalidatePath("/train");
  if (key) revalidatePath(`/train/${key}`);
  return { ok: true };
}

export async function saveTrainingTextAction(key: string, kind: "instructions" | "style", body: string): Promise<Result> {
  if (!isTrainKey(key) || (kind !== "instructions" && kind !== "style") || typeof body !== "string") return { error: "Not allowed" };
  return wrap(key, (v) => saveTrainingText(v, key, kind, body));
}

export async function trainingHistoryAction(rowId: string) {
  const viewer = await getViewer();
  if (!viewer || !id(rowId)) return { versions: [] };
  try {
    return { versions: await trainingHistory(viewer, rowId) };
  } catch {
    return { versions: [] };
  }
}

export async function restoreTrainingAction(key: string, rowId: string, version: number): Promise<Result> {
  if (!isTrainKey(key) || !id(rowId) || !Number.isInteger(version)) return { error: "Not allowed" };
  return wrap(key, (v) => restoreTraining(v, rowId, version));
}

export async function addExampleAction(key: string, title: string, body: string): Promise<Result> {
  if (!isTrainKey(key) || typeof title !== "string" || typeof body !== "string") return { error: "Not allowed" };
  return wrap(key, (v) => addExample(v, key, title, body));
}

/** Each uploaded file becomes one example, titled by its name. */
export async function addExampleFilesAction(key: string, form: FormData): Promise<{ added: number; errors: string[] }> {
  const viewer = await getViewer();
  if (!viewer || !isTrainKey(key)) return { added: 0, errors: ["Not allowed"] };
  const list = form.getAll("file").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  let added = 0;
  const errors: string[] = [];
  for (const file of list.slice(0, 10)) {
    if (file.size > 1_800_000) {
      errors.push(`${file.name}：文件太大（上限约 1.8 MB），请粘贴文字`);
      continue;
    }
    const read = await extractExampleText(file.name, new Uint8Array(await file.arrayBuffer()));
    if ("error" in read) {
      errors.push(`${file.name}：${read.error}`);
      continue;
    }
    try {
      await addExample(viewer, key, file.name.replace(/\.[^.]+$/, ""), read.text);
      added += 1;
    } catch (err) {
      errors.push(`${file.name}：${err instanceof TrainError ? err.message : "没有保存成功"}`);
    }
  }
  revalidatePath("/train");
  revalidatePath(`/train/${key}`);
  return { added, errors };
}

export async function updateExampleAction(key: string, rowId: string, title: string, body: string): Promise<Result> {
  if (!isTrainKey(key) || !id(rowId) || typeof title !== "string" || typeof body !== "string") return { error: "Not allowed" };
  return wrap(key, (v) => updateExample(v, rowId, title, body));
}

export async function setExampleActiveAction(key: string, rowId: string, active: boolean): Promise<Result> {
  if (!isTrainKey(key) || !id(rowId)) return { error: "Not allowed" };
  return wrap(key, (v) => setExampleActive(v, rowId, Boolean(active)));
}

export async function deleteExampleAction(key: string, rowId: string): Promise<Result> {
  if (!isTrainKey(key) || !id(rowId)) return { error: "Not allowed" };
  return wrap(key, (v) => deleteExample(v, rowId));
}

export async function tryTrainingAction(key: string, ask: string): Promise<{ text: string } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer || !isTrainKey(key) || typeof ask !== "string") return { error: "Not allowed" };
  try {
    return await tryTraining(viewer, key, ask);
  } catch (err) {
    console.error("[train] try", err);
    return { error: "这次没有生成出来，请再试一次" };
  }
}
