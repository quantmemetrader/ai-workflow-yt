import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptComments, scripts, users } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { projectForPage } from "@/lib/projects/page-data";
import { listPeople } from "@/lib/chat/service";
import { scriptDetail } from "@/lib/script/service";
import { scriptWriting } from "@/lib/script/writing";
import { docApprovals, docReferences } from "@/lib/script/doc";
import { docForBeats, type RichNode } from "@/lib/script/rich";
import { ScriptDoc } from "@/components/script/doc/ScriptDoc";

export const metadata = { title: "脚本 · Script" };

/**
 * The project's 脚本 page: the script as a document with an AI copilot,
 * comments, versions, and share-for-approval (`components/script/doc`).
 */
export default async function ProjectScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
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
  const beats = (detail?.beats ?? []).map((b) => ({ visual: b.visual, voiceover: b.voiceover, subtitle: b.subtitle, naturalSound: b.naturalSound }));
  /* The rich document if it still says what the beats say; else one built from them. */
  const doc = docForBeats((stored?.doc as RichNode | null) ?? null, beats);

  const s = detail?.script ?? null;
  const accessNote =
    p.access.mode === "everyone"
      ? zh ? "工作室里的人都能打开这个链接" : "Anyone in the studio can open this link"
      : p.access.mode === "private"
        ? zh ? "项目现在仅自己可见 —— 发给同事前，先在顶部把项目改成他们可见" : "The project is private — make it visible to them first"
        : zh ? "能看到这个项目的人可以打开这个链接" : "People who can see this project can open this link";
  const sentBack = p.sentBack.script && p.sentBack.script.state === "open" ? p.sentBack.script : null;

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ScriptDoc
        projectId={p.id}
        projectTitle={p.title}
        zh={zh}
        me={{
          id: viewer.id,
          name: (zh && viewer.nameLocal) || viewer.name,
          avatarUrl: viewer.avatarUrl,
          isAdmin: viewer.role === "owner" || viewer.role === "admin",
          canEdit: viewer.modules.includes("script"),
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
        sentBack={sentBack}
        people={people.map((x) => ({ id: x.id, name: (zh && x.nameLocal) || x.name, avatarUrl: x.avatarUrl, title: x.title }))}
        accessNote={accessNote}
        accessMode={p.access.mode}
        access={p.access}
        canManageAccess={p.canManage}
      />
    </div>
  );
}
