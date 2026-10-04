import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, folders } from "@/lib/db/schema";
import { requireViewer } from "@/lib/auth/dal";
import { shareCeiling } from "@/lib/authz/rebac";
import { sharesWithNames } from "@/lib/files/service";
import { visibilityForFiles } from "@/lib/files/access";
import { openDoc } from "@/lib/files/doc-edit";
import { LIBRARIES } from "@/lib/files/module-library";
import { DocEditor } from "@/components/files/DocEditor";
import { ShareSheet } from "@/components/files/ShareSheet";
import { FileAccessControl } from "@/components/files/FileAccessControl";

export const metadata = { title: "文档" };

/** A document open for editing (`DocEditor`): anyone who may read it may open it; editors may change it. */
export default async function DocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ share?: string }> }) {
  const { id } = await params;
  const { share: openShare } = await searchParams;
  const viewer = await requireViewer();
  const locale = viewer.locale ?? "zh-CN";
  const zh = locale.startsWith("zh");
  const doc = await openDoc(viewer, id);
  if (!doc) notFound();
  const [row] = await db.select({ ownerId: files.ownerId, storageKey: files.storageKey, folder: folders.name }).from(files).leftJoin(folders, eq(folders.id, files.folderId)).where(eq(files.id, id)).limit(1);
  /* Back to the library it lives in, else Files. */
  const lib = (Object.entries(LIBRARIES) as [keyof typeof LIBRARIES, (typeof LIBRARIES)[keyof typeof LIBRARIES]][]).find(([, l]) => l.zh === row?.folder);
  const back = lib ? { href: `/${lib[0]}?tab=library`, label: zh ? lib[1].zh : lib[1].en } : { href: "/files", label: zh ? "文件" : "Files" };
  const [shares, ceiling, vis] = await Promise.all([sharesWithNames("file", id), shareCeiling(viewer, "file", id), visibilityForFiles([id])]);
  const seen = vis.get(id) ?? { visibility: "private" as const, groups: [], userIds: [] };
  /* (QA, 2 Oct: people shares of every level are listed, viewers included, so
     each can be removed; everyone/group grants stay in 谁可以看.) */
  const people = shares.filter((s) => s.tuple.subjectType !== "tenant" && s.tuple.subjectType !== "role");
  const sharedPeople = new Set(
    people.filter((s) => s.tuple.subjectId !== row?.ownerId && (!s.tuple.expiresAt || s.tuple.expiresAt > new Date())).map((s) => s.tuple.subjectId),
  ).size;
  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <DocEditor
        id={doc.id}
        name={doc.name}
        html={doc.html}
        canEdit={doc.canEdit}
        zh={zh}
        back={back}
        fromOriginal={doc.fromOriginal && Boolean(row?.storageKey)}
        hasOriginal={Boolean(row?.storageKey)}
        openShare={openShare === "1"}
        agentName={lib?.[0] === "legal" ? (zh ? "法务" : "Legal") : lib?.[0] === "finance" || lib?.[0] === "accounting" ? (zh ? "财务" : "Finance") : zh ? "助理" : "Assistant"}
        share={
          <>
            <FileAccessControl fileId={doc.id} fileName={doc.name} visibility={seen.visibility} groups={seen.groups} userIds={seen.userIds} canChange={viewer.isAdmin || row?.ownerId === viewer.id} zh={zh} sharedPeople={sharedPeople} />
            <ShareSheet
              objectType="file"
              objectId={doc.id}
              ceiling={ceiling}
              locale={locale}
              ownerId={row?.ownerId}
              shares={people.map((s) => ({ subjectId: s.tuple.subjectId, subjectType: s.tuple.subjectType, relation: s.tuple.relation, name: (zh && s.userNameLocal) || s.userName, expiresAt: s.tuple.expiresAt?.toISOString() ?? null }))}
            />
          </>
        }
      />
    </div>
  );
}
