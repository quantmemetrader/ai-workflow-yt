import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workProjects, scriptComments, scripts, users } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { projectForPage } from "@/lib/projects/page-data";
import { listPeople } from "@/lib/chat/service";
import { scriptDetail } from "@/lib/script/service";
import { scriptWriting } from "@/lib/script/writing";
import { docApprovals, docReferences } from "@/lib/script/doc";
import { docForBeats, type RichNode } from "@/lib/script/rich";
import { ScriptDoc } from "@/components/script/doc/ScriptDoc";

/**
 * A project's script as a document with an AI copilot, comments, versions
 * and share-for-approval (`components/script/doc`) — drawn inside the
 * project's 脚本 tab, or on its own page (`standalone`: opened from 所有脚本,
 * with only a slim bar back to the library and to the project).
 */
export async function ScriptDocPage({ id, standalone = false }: { id: string; standalone?: boolean }) {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, id, zh);
  if (!p) notFound();

  const scriptId = p.script?.id ?? null;
  const [detail, approvals, references, comments, people, writing] = await Promise.all([
    scriptId ? scriptDetail(viewer, scriptId) : Promise.resolve(null),
    scriptId ? docApprovals(viewer, scriptId) : Promise.resolve([]),
    scriptId ? docReferences(viewer, scriptId) : Promise.resolve([]),
    scriptId
      ? db
          .select({
            id: scriptComments.id,
            parentId: scriptComments.parentId,
            beatOrd: scriptComments.beatOrd,
            quote: scriptComments.quote,
            body: scriptComments.body,
            createdAt: scriptComments.createdAt,
            resolvedAt: scriptComments.resolvedAt,
            authorId: scriptComments.authorId,
            authorName: users.name,
            authorNameLocal: users.nameLocal,
            authorAvatar: users.avatarUrl,
          })
          .from(scriptComments)
          .leftJoin(users, eq(users.id, scriptComments.authorId))
          .where(and(eq(scriptComments.scriptId, scriptId)))
          .orderBy(asc(scriptComments.createdAt))
      : Promise.resolve([]),
    listPeople(viewer),
    scriptId ? scriptWriting(viewer.tenantId, scriptId).then((w) => w.writing) : Promise.resolve(false),
  ]);
  const [stored] = scriptId ? await db.select({ doc: scripts.doc }).from(scripts).where(eq(scripts.id, scriptId)).limit(1) : [];
  const [src] = await db.select({ source: workProjects.source }).from(workProjects).where(eq(workProjects.id, p.id)).limit(1);
  const failedRaw = (src?.source as { draftFailed?: { at?: string; note?: string } | null } | null)?.draftFailed ?? null;
  const draftFailed = failedRaw?.note ? { at: failedRaw.at ?? "", note: failedRaw.note } : null;
  const beats = (detail?.beats ?? []).map((b) => ({ visual: b.visual, voiceover: b.voiceover, subtitle: b.subtitle, naturalSound: b.naturalSound }));
  /* The rich document if it still says what the beats say; else one built from them. */
  const doc = docForBeats((stored?.doc as RichNode | null) ?? null, beats);

  const s = detail?.script ?? null;
  /* Says why the whole studio can open it when the project is open to everyone, so it does not read as the opposite of the dialog's 「仅限能看到这个项目的人」 (QA, 2 Oct). */
  const accessNote =
    p.access.link === "edit"
      ? zh ? "工作室里有链接的人都能打开并编辑" : "Anyone in the studio with the link can open and edit"
      : p.access.link === "view"
        ? zh ? "工作室里有链接的人都能打开查看" : "Anyone in the studio with the link can view"
        : p.access.mode === "everyone"
      ? zh ? "这个项目全工作室可见，所以工作室里的人都能打开这个链接" : "The whole studio can see this project, so anyone in the studio can open this link"
      : p.access.mode === "private"
        ? zh ? "项目仅自己可见：把下面「有链接的人」改成可查看或可编辑，发链接的人就能打开" : "The project is private: set Anyone with the link below so the people you send it to can open it"
        : zh ? "能看到这个项目的人可以打开这个链接" : "People who can see this project can open this link";
  const sentBack = p.sentBack.script && p.sentBack.script.state === "open" ? p.sentBack.script : null;

  return (
    <div data-script-page="" data-project-frame={standalone ? "" : undefined} style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: standalone ? "#f9fbfd" : undefined, overflowY: standalone ? "auto" : undefined }}>
      {standalone ? (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: "1px solid #e7e6e2", background: "#fff" }}>
          <Link href="/script" prefetch={false} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", borderRadius: 9, border: "1px solid #dcdbd6", color: "#171717", textDecoration: "none", fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
            ← {zh ? "所有脚本" : "All scripts"}
          </Link>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#171717", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>{detail?.script.title ?? p.title}</span>
          <Link href={`/projects/${p.id}`} prefetch={false} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", borderRadius: 9, background: "#f3f3f1", color: "#404040", textDecoration: "none", fontSize: 13, whiteSpace: "nowrap", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>
            {zh ? "所属项目：" : "Project: "}{p.title} →
          </Link>
        </div>
      ) : null}
      <ScriptDoc
        projectId={p.id}
        projectTitle={p.title}
        zh={zh}
        me={{
          id: viewer.id,
          name: (zh && viewer.nameLocal) || viewer.name,
          avatarUrl: viewer.avatarUrl,
          isAdmin: viewer.role === "owner" || viewer.role === "admin",
          canEdit: viewer.modules.includes("script") && p.linkOnly !== "view" && p.status !== "archived",
        }}
        script={
          s
            ? { id: s.id, title: s.title, version: s.version, lockedVersion: s.lockedVersion, status: s.status, targetSeconds: s.targetSeconds, mandatoryPoints: s.mandatoryPoints }
            : null
        }
        beats={beats}
        doc={doc}
        versions={(detail?.versions ?? []).map((v) => ({
          versionNo: v.versionNo,
          createdAt: v.createdAt.toISOString(),
          authorName: (zh && v.authorNameLocal) || v.authorName,
          note: v.note,
          wordCount: v.wordCount,
          spokenSeconds: v.spokenSeconds,
          model: v.model,
        }))}
        approvals={approvals}
        comments={comments.map((c) => ({
          id: c.id,
          parentId: c.parentId,
          beatOrd: c.beatOrd,
          quote: c.quote,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          resolvedAt: c.resolvedAt?.toISOString() ?? null,
          authorId: c.authorId,
          authorName: (zh && c.authorNameLocal) || c.authorName || "—",
          authorAvatar: c.authorAvatar,
        }))}
        references={references}
        writing={writing}
        draftFailed={writing ? null : draftFailed}
        sentBack={sentBack}
        people={people.map((x) => ({ id: x.id, name: (zh && x.nameLocal) || x.name, avatarUrl: x.avatarUrl, title: x.title }))}
        accessNote={accessNote}
        accessMode={p.access.mode}
        access={p.access}
        canManageAccess={p.canManage}
        linkAccess={p.access.link ?? null}
      />
    </div>
  );
}
