import "server-only";
import { and, asc, desc, eq, inArray, isNull, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { entitlements, files, folders, knowledge, relationTuples, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { newId } from "@/lib/ids";
import { createFolder } from "@/lib/files/service";

/**
 * A back-office module's own file library (法务资料库, 财务资料库 …): one
 * top-level folder per module, open to everyone who holds that module and
 * to admins, where its contracts, invoices and records are uploaded,
 * searched and cleaned up — and read by AI on arrival (`files.text`), so the
 * module's assistant can answer from them (Ryan, 30 Sep: "legal and finance
 * need a full database themselves and should upload and manage their files
 * easier"). A file can also be switched on as a training example for the
 * module's AI employee, and the page says which ones are.
 */
export const LIBRARIES = {
  legal: { zh: "法务资料库", en: "Legal library", train: "legal" },
  finance: { zh: "财务资料库", en: "Finance library", train: "finance" },
  accounting: { zh: "账务资料库", en: "Accounting library", train: "finance" },
  hr: { zh: "人事资料库", en: "HR library", train: "assistant" },
} as const;
export type LibModule = keyof typeof LIBRARIES;
export const isLibModule = (v: unknown): v is LibModule => typeof v === "string" && v in LIBRARIES;

export type LibraryFile = { id: string; name: string; kind: string; sizeBytes: number; createdAt: string; ownerName: string; read: boolean; training: boolean };

/** The module's folder, made on first use; everyone holding the module may add to it. */
export async function libraryFolder(viewer: Viewer, m: LibModule): Promise<string> {
  const name = LIBRARIES[m].zh;
  const [existing] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.tenantId, viewer.tenantId), isNull(folders.parentId), eq(folders.name, name), isNull(folders.deletedAt)))
    .orderBy(asc(folders.createdAt))
    .limit(1);
  const id = existing?.id ?? (await createFolder(viewer, { name })).id;
  const holders = await db
    .select({ userId: entitlements.userId })
    .from(entitlements)
    .innerJoin(users, eq(users.id, entitlements.userId))
    .where(and(eq(entitlements.module, m), eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt)));
  if (holders.length)
    await db
      .insert(relationTuples)
      .values(holders.map((h) => ({ id: newId("tup"), objectType: "folder", objectId: id, relation: "editor" as const, subjectType: "user", subjectId: h.userId, grantedBy: viewer.id })))
      .onConflictDoNothing();
  return id;
}

/** The marker a training example made from a file carries in its title. */
export const trainTag = (fileId: string) => `〔${fileId}〕`;

export async function libraryFiles(viewer: Viewer, m: LibModule): Promise<{ folderId: string; files: LibraryFile[] }> {
  const folderId = await libraryFolder(viewer, m);
  const rows = await db
    .select({ id: files.id, name: files.name, kind: files.kind, sizeBytes: files.sizeBytes, createdAt: files.createdAt, hasText: files.text, ownerName: users.name, ownerLocal: users.nameLocal })
    .from(files)
    .leftJoin(users, eq(users.id, files.ownerId))
    .where(and(eq(files.folderId, folderId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt))
    .limit(500);
  const examples = await db
    .select({ title: knowledge.title })
    .from(knowledge)
    .where(and(eq(knowledge.tenantId, viewer.tenantId), eq(knowledge.kind, "example"), eq(knowledge.scope, "role"), eq(knowledge.scopeValue, LIBRARIES[m].train), eq(knowledge.active, true), like(knowledge.title, "%〔fil_%")));
  const trained = new Set(examples.map((e) => /〔(fil_[0-9a-z]+)〕/i.exec(e.title)?.[1]).filter(Boolean) as string[]);
  return {
    folderId,
    files: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      sizeBytes: Number(r.sizeBytes ?? 0),
      createdAt: r.createdAt.toISOString(),
      ownerName: (viewer.locale ?? "zh").startsWith("zh") ? r.ownerLocal || r.ownerName || "" : r.ownerName || "",
      read: Boolean(r.hasText && r.hasText.trim()),
      training: trained.has(r.id),
    })),
  };
}

/** The example rows made from this file, for turning training off. */
export async function examplesFromFile(tenantId: string, trainKey: string, fileId: string) {
  return db
    .select({ id: knowledge.id })
    .from(knowledge)
    .where(and(eq(knowledge.tenantId, tenantId), eq(knowledge.kind, "example"), eq(knowledge.scope, "role"), eq(knowledge.scopeValue, trainKey), like(knowledge.title, `%${trainTag(fileId)}%`)));
}
void inArray;
