import "server-only";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, folders, users, type Relation } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import type { ToolDef } from "@/lib/ai/openrouter";
import { audit } from "@/lib/audit";
import { atLeast, canReadFiles, canReadFolders, relationOn, share, shareCeiling, type SharedObject } from "@/lib/authz/rebac";
import {
  createFolder,
  deleteFolder,
  folderLabel,
  listTrash,
  listTrashedFolders,
  notProxy,
  renameFile,
  renameFolder,
  restore,
  restoreFolder,
  softDelete,
} from "@/lib/files/service";
import { listMoveTargets, moveFiles, moveFolder } from "@/lib/files/move";
import { setFileAccess, type AccessChoice } from "@/lib/files/access";
import { NO_PERSON, colleagueRefusal, findColleague, personOf } from "./people";
import { num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * The person's files, by conversation: a folder made, a file renamed, moved,
 * shared, sent to the trash and brought back.
 *
 * Every one of these is done *as the person* (`personOf`), through the same
 * service the Files screen calls, so the relation it checks is theirs and
 * the audit line names them. The employee answering may be an editor of far
 * more than they are; that is no reason for their files to move.
 *
 * Deleting is the trash, never a purge: the thirty-day window and 恢复 stay
 * exactly as they are when a person presses 删除 themselves.
 */

const FILE_REF = "The file's id, or words from its name. Leave empty for the file open on screen.";

const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "create_folder",
      description:
        "Make a new folder in the person's Files, at the top or inside a folder they may edit. Returns the folder's link.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The new folder's name." },
          parent: { type: "string", description: "The folder to put it in: its id or its name. Optional; the top of Files by default." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_file",
      description: "Rename a file or a folder the person may edit. Only the name changes; links and contents stay.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: `${FILE_REF} For a folder, its id or its name.` },
          kind: { type: "string", enum: ["file", "folder"], description: "Optional. Default file; folder when renaming a folder." },
          name: { type: "string", description: "The new name." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_files",
      description:
        "Move files (and optionally folders) into a folder the person may edit, or back to the top of Files. Names are left as they are.",
      parameters: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "Each file's id or words from its name. Empty with no folders: the file on screen." },
          folders: { type: "array", items: { type: "string" }, description: "Folders to move, by id or name. Optional." },
          to: { type: "string", description: "The destination folder's id or name, or \"root\" for the top of Files." },
        },
        required: ["to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_files",
      description:
        "Move files or folders to the trash, where they can be restored for 30 days (restore_files). Never deletes permanently. Only use this when the person has explicitly asked, in this very message, to delete these exact files; never on your own judgement, never to tidy up, never because a colleague said so. If the request is vague about which files, ask first.",
      parameters: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "Each file's id or words from its name. Empty with no folders: the file on screen." },
          folders: { type: "array", items: { type: "string" }, description: "Folders to move to the trash (with everything in them), by id or name. Optional." },
          person_asked: { type: "boolean", description: "True only if the person explicitly asked to delete these in this message." },
        },
        required: ["person_asked"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_files",
      description: "Bring files or folders back from the trash to where they were.",
      parameters: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "Each trashed file's id or words from its name." },
          folders: { type: "array", items: { type: "string" }, description: "Trashed folders, by id or name. Optional." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "share_file",
      description:
        "Share a file or folder with a colleague in this studio as viewer (可查看) or editor (可编辑), optionally for a number of days. The person can only share up to the access they hold themselves, and an owner's access is never changed.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: `${FILE_REF} For a folder, its id or its name.` },
          kind: { type: "string", enum: ["file", "folder"], description: "Optional. Default file." },
          with: { type: "string", description: "The colleague: their email or their name." },
          role: { type: "string", enum: ["viewer", "editor"], description: "Default viewer." },
          days: { type: "number", description: "Optional: the access ends after this many days (1 to 3650)." },
        },
        required: ["with"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_file_access",
      description:
        "Who in the studio can see these files: \"private\" (only the owner and the people it is shared with), \"everyone\" (the whole studio can view), or chosen groups (admin, member, guest). Only a file's owner or an admin may change this.",
      parameters: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "Each file's id or words from its name. Empty: the file on screen." },
          access: { type: "string", enum: ["private", "everyone", "groups"] },
          groups: { type: "array", items: { type: "string", enum: ["admin", "member", "guest"] }, description: "With access=groups." },
        },
        required: ["access"],
      },
    },
  },
];

/* ------------------------------------------------------------- resolving */

type Found<T> = { ok: T } | { error: string };

const isFileId = (s: string) => /^fil_[0-9a-z]{20,32}$/i.test(s);
const isFolderId = (s: string) => /^fld_[0-9a-z]{20,32}$/i.test(s);
const ROOT = new Set(["root", "根目录", "top", "/", "顶层", "最外层"]);

function strings(v: unknown, max = 50): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : [];
}

/** Exact name first, then a unique partial one; several are listed, never guessed between. */
function pick<T extends { id: string; name: string }>(rows: T[], wanted: string, what: string): Found<T> {
  const w = wanted.toLowerCase();
  const exact = rows.filter((r) => r.name.toLowerCase() === w);
  if (exact.length === 1) return { ok: exact[0] };
  const pool = exact.length > 1 ? exact : rows.filter((r) => r.name.toLowerCase().includes(w));
  if (pool.length === 1) return { ok: pool[0] };
  if (!pool.length) return { error: `No ${what} the person can reach matches "${wanted}".` };
  return {
    error: `"${wanted}" matches several ${what}s: ${pool
      .slice(0, 8)
      .map((r) => `${r.name} (id: ${r.id})`)
      .join(", ")}. Ask which one, or use the id.`,
  };
}

/** A file the person may read, by id, by name, or the one on screen. */
async function findFile(person: Viewer, ctx: ToolContext, raw: string): Promise<Found<{ id: string; name: string }>> {
  const ref = raw || ctx.fileId || "";
  if (!ref) return { error: "Say which file (its name or id); none is open on screen." };
  const base = and(eq(files.tenantId, person.tenantId), isNull(files.deletedAt), canReadFiles(person), notProxy());
  if (isFileId(ref)) {
    const [row] = await db.select({ id: files.id, name: files.name }).from(files).where(and(eq(files.id, ref.toLowerCase()), base)).limit(1);
    return row ? { ok: row } : { error: `No file ${ref} that the person can reach.` };
  }
  const rows = await db
    .select({ id: files.id, name: files.name })
    .from(files)
    .where(and(base, sql`${files.name} ilike ${"%" + ref.replace(/[%_\\]/g, "\\$&") + "%"}`))
    .orderBy(desc(files.updatedAt))
    .limit(40);
  return pick(rows, ref, "file");
}

/** A folder the person may see, by id or name. The private home folder is never one. */
async function findFolder(person: Viewer, raw: string): Promise<Found<{ id: string; name: string }>> {
  const base = and(eq(folders.tenantId, person.tenantId), isNull(folders.deletedAt), ne(folders.name, "__home"), canReadFolders(person));
  if (isFolderId(raw)) {
    const [row] = await db.select({ id: folders.id, name: folders.name }).from(folders).where(and(eq(folders.id, raw.toLowerCase()), base)).limit(1);
    return row ? { ok: { id: row.id, name: folderLabel(row.name) } } : { error: `No folder ${raw} that the person can reach.` };
  }
  const rows = await db.select({ id: folders.id, name: folders.name }).from(folders).where(base).orderBy(folders.name).limit(2000);
  return pick(rows.map((r) => ({ id: r.id, name: folderLabel(r.name) })), raw, "folder");
}

/** Where things may be put: a folder the person can edit (the 移动到 list), or the top. */
async function findTarget(person: Viewer, raw: string): Promise<Found<{ id: string | null; name: string }>> {
  if (!raw || ROOT.has(raw.toLowerCase())) return { ok: { id: null, name: "根目录" } };
  const targets = await listMoveTargets(person);
  if (isFolderId(raw)) {
    const t = targets.find((f) => f.id === raw.toLowerCase());
    return t ? { ok: t } : { error: "The person cannot put things into that folder (it does not exist, or they may not edit it)." };
  }
  const found = pick(targets, raw, "folder they may edit");
  return "ok" in found ? { ok: found.ok } : found;
}

/** Many files by reference; the ones that resolve, and why the others did not. */
async function findFiles(person: Viewer, ctx: ToolContext, refs: string[]) {
  const ok: { id: string; name: string }[] = [];
  const problems: string[] = [];
  for (const r of refs) {
    const f = await findFile(person, ctx, r);
    if ("ok" in f) {
      if (!ok.some((x) => x.id === f.ok.id)) ok.push(f.ok);
    } else problems.push(f.error);
  }
  return { ok, problems };
}

async function findFolders(person: Viewer, refs: string[]) {
  const ok: { id: string; name: string }[] = [];
  const problems: string[] = [];
  for (const r of refs) {
    const f = await findFolder(person, r);
    if ("ok" in f) {
      if (!ok.some((x) => x.id === f.ok.id)) ok.push(f.ok);
    } else problems.push(f.error);
  }
  return { ok, problems };
}

const msg = (err: unknown) => (err instanceof Error ? err.message : "unknown error");
const REL_ZH: Record<Relation, string> = { owner: "所有者", editor: "可编辑", commenter: "可评论", viewer: "可查看" };

/* ------------------------------------------------------------------- run */

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (ctx.readOnly) return { text: "This turn may only look things up; nothing was changed." };
  const person = personOf(ctx);
  if (!person) return { text: NO_PERSON };
  /* Files is the module the screen asks for; sharing and access have their
     own narrower doors below, exactly as their actions do. */
  const holdsFiles = person.modules.includes("files");
  if (!holdsFiles && name !== "share_file" && name !== "set_file_access") {
    return { text: "The person asking does not have the Files module, so this cannot be done for them. Nothing was changed." };
  }

  if (name === "create_folder") {
    const folderName = str(args.name, 200);
    if (!folderName) return { text: "Say what the folder should be called." };
    let parentId: string | null = null;
    let where = "the top of Files";
    const parentRef = str(args.parent, 300);
    if (parentRef && !ROOT.has(parentRef.toLowerCase())) {
      const parent = await findFolder(person, parentRef);
      if ("error" in parent) return { text: `${parent.error} Nothing was made.` };
      /* Checked first, as newFolderAction does, so "not found" and "not yours" read the same. */
      const held = await relationOn(person, "folder", parent.ok.id);
      if (!atLeast(held, "editor") && !person.isAdmin) {
        return { text: `The person may not add to "${parent.ok.name}". Nothing was made.` };
      }
      parentId = parent.ok.id;
      where = `"${parent.ok.name}"`;
    }
    try {
      const folder = await createFolder(person, { name: folderName, parentId });
      return {
        text: `Made the folder "${folder.name}" in ${where}. Open it at /files/f/${folder.id} (id: ${folder.id}).`,
        changed: true,
        artifacts: [{ kind: "file", id: folder.id, title: folder.name, action: "created" }],
      };
    } catch (err) {
      return { text: `The folder was not made: ${msg(err)}` };
    }
  }

  if (name === "rename_file") {
    const newName = str(args.name, 255);
    if (!newName) return { text: "Say the new name." };
    const ref = str(args.target, 300);
    const asFolder = args.kind === "folder" || isFolderId(ref);
    if (asFolder) {
      if (!ref) return { text: "Say which folder." };
      const f = await findFolder(person, ref);
      if ("error" in f) return { text: `${f.error} Nothing was renamed.` };
      try {
        const row = await renameFolder(person, f.ok.id, newName);
        return { text: `Renamed the folder "${f.ok.name}" to "${row.name}".`, changed: true, artifacts: [{ kind: "file", id: row.id, title: row.name, action: "updated" }] };
      } catch (err) {
        return { text: `Not renamed: ${msg(err)}` };
      }
    }
    const f = await findFile(person, ctx, ref);
    if ("error" in f) return { text: `${f.error} Nothing was renamed.` };
    try {
      const row = await renameFile(person, f.ok.id, newName);
      return { text: `Renamed "${f.ok.name}" to "${row.name}".`, changed: true, artifacts: [{ kind: "file", id: row.id, title: row.name, action: "updated" }] };
    } catch (err) {
      return { text: `Not renamed: ${msg(err)}` };
    }
  }

  if (name === "move_files") {
    const target = await findTarget(person, str(args.to, 300));
    if ("error" in target) return { text: `${target.error} Nothing was moved.` };
    const fileRefs = strings(args.files, 200);
    const folderRefs = strings(args.folders, 50);
    const fs = await findFiles(person, ctx, fileRefs.length || folderRefs.length ? fileRefs : [""]);
    const ds = await findFolders(person, folderRefs);
    if (!fs.ok.length && !ds.ok.length) return { text: `${[...fs.problems, ...ds.problems].join(" ")} Nothing was moved.` };

    let moved = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const d of ds.ok) {
      try {
        const res = await moveFolder(person, d.id, target.ok.id);
        if (res.moved) moved++;
      } catch (err) {
        failed++;
        errors.push(`${d.name}: ${msg(err)}`);
      }
    }
    if (fs.ok.length) {
      const res = await moveFiles(person, fs.ok.map((f) => f.id), target.ok.id);
      moved += res.moved;
      failed += res.failed;
      if (res.failed) errors.push(res.error || `${res.failed} file(s) could not be moved (no edit access)`);
    }
    const unresolved = [...fs.problems, ...ds.problems];
    return {
      text: [
        moved ? `Moved ${moved} item(s) into ${target.ok.name}.` : "Nothing was moved.",
        failed ? `${failed} could not be moved: ${errors.join("; ")}` : "",
        unresolved.length ? `Not found: ${unresolved.join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      changed: moved > 0,
      ...(moved > 0 ? { artifacts: [...fs.ok, ...ds.ok].map((x) => ({ kind: "file" as const, id: x.id, title: x.name, action: "updated" as const })) } : {}),
    };
  }

  if (name === "delete_files") {
    if (args.person_asked !== true) {
      return { text: "Files are only moved to the trash when the person explicitly asks for it in this message. Nothing was deleted." };
    }
    const fileRefs = strings(args.files, 200);
    const folderRefs = strings(args.folders, 50);
    const fs = await findFiles(person, ctx, fileRefs.length || folderRefs.length ? fileRefs : [""]);
    const ds = await findFolders(person, folderRefs);
    /* A name that matched several is a question, not a delete: nothing goes
       until every one of them is unambiguous. */
    if (fs.problems.length || ds.problems.length) {
      return { text: `${[...fs.problems, ...ds.problems].join(" ")} Nothing was deleted.` };
    }
    const done: { id: string; name: string }[] = [];
    const errors: string[] = [];
    let inFolders = 0;
    for (const f of fs.ok) {
      try {
        await softDelete(person, f.id);
        done.push(f);
      } catch (err) {
        errors.push(`${f.name}: ${msg(err)}`);
      }
    }
    for (const d of ds.ok) {
      try {
        const res = await deleteFolder(person, d.id);
        inFolders += res.files;
        done.push(d);
      } catch (err) {
        errors.push(`${d.name}: ${msg(err)}`);
      }
    }
    return {
      text: [
        done.length
          ? `Moved to the trash: ${done.map((d) => `"${d.name}"`).join(", ")}${inFolders ? ` (with ${inFolders} file(s) inside the folders)` : ""}. They can be restored from /files/trash for 30 days.`
          : "Nothing was deleted.",
        errors.length ? `Not deleted: ${errors.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      changed: done.length > 0,
      ...(done.length ? { artifacts: done.map((d) => ({ kind: "file" as const, id: d.id, title: d.name, action: "updated" as const })) } : {}),
    };
  }

  if (name === "restore_files") {
    const fileRefs = strings(args.files, 200);
    const folderRefs = strings(args.folders, 50);
    if (!fileRefs.length && !folderRefs.length) return { text: "Say which files to bring back from the trash." };
    /* Only what the trash screen shows this person: what they could have deleted. */
    const trash = (await listTrash(person, 500)).map((r) => ({ id: r.file.id, name: r.file.name }));
    const trashedFolders = (await listTrashedFolders(person, 500)).map((r) => ({ id: r.id, name: folderLabel(r.name) }));
    const done: { id: string; name: string }[] = [];
    const errors: string[] = [];
    for (const ref of fileRefs) {
      const f = isFileId(ref) ? trash.find((t) => t.id === ref.toLowerCase()) : undefined;
      const found = f ? { ok: f } : isFileId(ref) ? { error: `No file ${ref} in the person's trash.` } : pick(trash, ref, "trashed file");
      if ("error" in found) {
        errors.push(found.error);
        continue;
      }
      try {
        await restore(person, found.ok.id);
        done.push(found.ok);
      } catch (err) {
        errors.push(`${found.ok.name}: ${msg(err)}`);
      }
    }
    for (const ref of folderRefs) {
      const f = isFolderId(ref) ? trashedFolders.find((t) => t.id === ref.toLowerCase()) : undefined;
      const found = f ? { ok: f } : isFolderId(ref) ? { error: `No folder ${ref} in the person's trash.` } : pick(trashedFolders, ref, "trashed folder");
      if ("error" in found) {
        errors.push(found.error);
        continue;
      }
      try {
        await restoreFolder(person, found.ok.id);
        done.push(found.ok);
      } catch (err) {
        errors.push(`${found.ok.name}: ${msg(err)}`);
      }
    }
    return {
      text: [done.length ? `Restored: ${done.map((d) => `"${d.name}"`).join(", ")}.` : "Nothing was restored.", errors.length ? errors.join(" ") : ""]
        .filter(Boolean)
        .join("\n"),
      changed: done.length > 0,
      ...(done.length ? { artifacts: done.map((d) => ({ kind: "file" as const, id: d.id, title: d.name, action: "updated" as const })) } : {}),
    };
  }

  if (name === "share_file") {
    const ref = str(args.target, 300);
    const objectType: SharedObject = args.kind === "folder" || isFolderId(ref) ? "folder" : "file";
    const role = args.role === "editor" ? "editor" : "viewer";
    const found = objectType === "folder" ? (ref ? await findFolder(person, ref) : { error: "Say which folder." }) : await findFile(person, ctx, ref);
    if ("error" in found) return { text: `${found.error} Nothing was shared.` };
    const objectId = found.ok.id;

    /* shareAction's door: Files, or (for a file) its owner or editor without it. */
    if (!holdsFiles && !(objectType === "file" && ["owner", "editor"].includes((await relationOn(person, "file", objectId)) ?? ""))) {
      return { text: "The person may not share this. Nothing was shared." };
    }

    let expiresAt: Date | undefined;
    if (args.days !== undefined && args.days !== null && args.days !== "") {
      const days = num(args.days, NaN);
      if (!Number.isFinite(days) || days <= 0 || days > 3650) return { text: "The number of days has to be between 1 and 3650. Nothing was shared." };
      expiresAt = new Date(Date.now() + days * 86_400_000);
    }

    /* The person's own access first, before anybody is looked up, so this is
       never a way to learn who has an account here (shareAction). */
    const ceiling = await shareCeiling(person, objectType, objectId);
    if (!ceiling) return { text: "The person may not share this. Nothing was shared." };
    if (!atLeast(ceiling, role)) return { text: `The person's own access is ${ceiling} (${REL_ZH[ceiling]}), so they can share it at most as that. Nothing was shared.` };

    const whoRaw = str(args.with, 320);
    if (!whoRaw) return { text: "Say whom to share it with." };
    /* A guest is not handed the studio's staff list (studioPeopleAction): by exact email only. */
    let target: { id: string; name: string } | null = null;
    if (person.role === "guest") {
      const [row] = await db
        .select({ id: users.id, name: users.name, nameLocal: users.nameLocal })
        .from(users)
        .where(and(eq(users.tenantId, person.tenantId), eq(users.email, whoRaw.toLowerCase()), isNull(users.deletedAt)))
        .limit(1);
      if (!row) return { text: "Nobody in this studio has that email (a guest shares by exact email). Nothing was shared." };
      target = { id: row.id, name: row.nameLocal || row.name };
    } else {
      const who = await findColleague(person, whoRaw);
      if (!("one" in who)) return { text: colleagueRefusal(whoRaw, who) };
      target = who.one;
    }
    if (target.id === person.id) return { text: "That is the person asking; they already have it. Nothing was shared." };

    const result = await share(person, { type: objectType, id: objectId }, role, { type: "user", id: target.id }, expiresAt ? { expiresAt, replace: true } : { replace: true });
    if (!result.ok) {
      return {
        text:
          result.reason === "above-ceiling"
            ? `The person can share it at most as ${result.ceiling ?? "their own access"}. Nothing was shared.`
            : result.reason === "protected-owner"
              ? "That colleague owns it; an owner's access is never changed. Nothing was shared."
              : "The person may not share this. Nothing was shared.",
      };
    }
    await audit(person, "file.share", { objectType, objectId, module: "files", meta: { to: target.id, relation: role, via: "agent" } });
    return {
      text: `Shared "${found.ok.name}" with ${target.name} as ${role} (${REL_ZH[role]})${expiresAt ? `, until ${expiresAt.toISOString().slice(0, 10)}` : ""}.`,
      changed: true,
      artifacts: [{ kind: "file", id: objectId, title: found.ok.name, action: "updated" }],
    };
  }

  if (name === "set_file_access") {
    const access = str(args.access, 20);
    let choice: AccessChoice;
    if (access === "everyone") choice = { mode: "everyone" };
    else if (access === "private") choice = { mode: "private" };
    else if (access === "groups") {
      const groups = (["admin", "member", "guest"] as const).filter((g) => strings(args.groups, 3).includes(g));
      if (!groups.length) return { text: "Say which groups: admin, member or guest. Nothing was changed." };
      choice = { mode: "groups", groups };
    } else return { text: "Access has to be private, everyone or groups. Nothing was changed." };

    const refs = strings(args.files, 200);
    const fs = await findFiles(person, ctx, refs.length ? refs : [""]);
    if (fs.problems.length) return { text: `${fs.problems.join(" ")} Nothing was changed.` };
    if (!fs.ok.length) return { text: "Say which files. Nothing was changed." };
    /* setFileAccessAction's door: Files, or one's own single document without it. */
    if (!holdsFiles && !(fs.ok.length === 1 && (await relationOn(person, "file", fs.ok[0].id)) === "owner")) {
      return { text: "The person may not change who sees these. Nothing was changed." };
    }
    try {
      const n = await setFileAccess(person, fs.ok.map((f) => f.id), choice);
      const said = choice.mode === "everyone" ? "the whole studio can view" : choice.mode === "private" ? "private" : `visible to ${choice.mode === "groups" ? choice.groups.join(", ") : ""}`;
      return {
        text: `${n} file(s) set to ${said}.${n < fs.ok.length ? ` ${fs.ok.length - n} were skipped: only a file's owner or an admin may change who sees it.` : ""}`,
        changed: n > 0,
        /* setFileAccess says how many, not which: a receipt only when it is all of them. */
        ...(n === fs.ok.length ? { artifacts: fs.ok.map((f) => ({ kind: "file" as const, id: f.id, title: f.name, action: "updated" as const })) } : {}),
      };
    } catch (err) {
      return { text: `Nothing was changed: ${msg(err)}` };
    }
  }

  return { text: `Unknown tool ${name}.` };
}

export const filesPack: ToolPack = { module: "files", defs, run };
