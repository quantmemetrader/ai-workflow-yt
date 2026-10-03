import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, folders, users } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { canReadFolders, relationOn, shareCeiling } from "@/lib/authz/rebac";
import { folderLabel, listVersions, sharesWithNames } from "@/lib/files/service";
import { uploadConfirmed } from "@/lib/files/abandon";
import { audit } from "@/lib/audit";
import { formatBytes, formatDate, makeT } from "@/lib/i18n";
import { Markdown } from "@/components/ui/Markdown";
import { ShareSheet } from "@/components/files/ShareSheet";
import { FileAccessControl } from "@/components/files/FileAccessControl";
import { manageableFiles, visibilityForFiles } from "@/lib/files/access";
import { RenameFile } from "@/components/files/RenameFile";
import { editable } from "@/lib/files/doc-edit";
import { FileVersions } from "@/components/files/FileVersions";
import { MoveFileButton } from "@/components/files/MoveDialog";

/**
 * One file: the thing itself, who can open it, and every version of it.
 *
 * Laid out like the artboard's Gallery view — preview fills the pane, facts and
 * sharing sit in the 320px panel on the right — so it belongs to the same
 * screen family as the list it came from.
 */
const fallbackMeta = { title: "文件" };

/* The tab says which file it is, not just 文件 (QA, 2 Oct). Only a name the
   viewer may open; anything else keeps the generic title. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("files");
  if (!(await relationOn(viewer, "file", id))) return fallbackMeta;
  const [row] = await db.select({ name: files.name }).from(files).where(eq(files.id, id)).limit(1);
  return row ? { title: row.name } : fallbackMeta;
}

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("files");
  const locale = viewer.locale ?? "zh-CN";
  const t = makeT(locale);
  const zh = locale.startsWith("zh");

  const held = await relationOn(viewer, "file", id);
  if (!held) notFound();

  const [row] = await db
    .select({ file: files, ownerName: users.name, ownerNameLocal: users.nameLocal })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    /* An upload that never finished is not a file yet (`uploadConfirmed`). */
    .where(and(eq(files.id, id), uploadConfirmed()))
    .limit(1);
  if (!row || row.file.deletedAt) notFound();

  await audit(viewer, "file.view", { objectType: "file", objectId: id, module: "files" });

  const [versions, shares, ceiling, vis, manage, trail] = await Promise.all([
    listVersions(viewer, id),
    sharesWithNames("file", id),
    shareCeiling(viewer, "file", id),
    visibilityForFiles([id]),
    manageableFiles(viewer, [row.file]),
    /* The folders it sits in, for the breadcrumb: only ones this person can
       open, so a file shared out of a private folder does not name it. */
    row.file.folderPath.length
      ? db
          .select({ id: folders.id, name: folders.name })
          .from(folders)
          .where(and(inArray(folders.id, row.file.folderPath), eq(folders.tenantId, viewer.tenantId), isNull(folders.deletedAt), canReadFolders(viewer)))
      : Promise.resolve([]),
  ]);
  /* 文件 › A › B › name, as the folder page shows it (QA, 4 Oct); the personal
     home folder is 文件 itself. */
  const breadcrumbs = row.file.folderPath
    .map((fid) => trail.find((f) => f.id === fid))
    .filter((f): f is { id: string; name: string } => Boolean(f) && f?.name !== "__home")
    .map((f) => ({ id: f.id, name: folderLabel(f.name) }));
  const seen = vis.get(id) ?? { visibility: "private" as const, groups: [], userIds: [] };
  /* (QA, 2 Oct: people shares of every level are listed, viewers included, so
     each can be removed; everyone/group grants stay in 谁可以看.) */
  const people = shares.filter((s) => s.tuple.subjectType !== "tenant" && s.tuple.subjectType !== "role");
  const sharedPeople = new Set(
    people.filter((s) => s.tuple.subjectId !== row.file.ownerId && (!s.tuple.expiresAt || s.tuple.expiresAt > new Date())).map((s) => s.tuple.subjectId),
  ).size;

  const file = row.file;
  /* Uploading a new version, restoring one and moving the file: owner or editor, as the server checks. */
  const canEdit = held === "owner" || held === "editor";
  const isMedia = ["image", "video", "audio"].includes(file.kind);

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: 56,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 18px 0 22px",
        }}
      >
        <Link href="/files" style={{ fontSize: 13, color: "#7c7c7c", flexShrink: 0 }}>
          {t("Files")}
        </Link>
        <Chevron />
        {breadcrumbs.map((b) => (
          <span key={b.id} style={{ display: "contents" }}>
            <Link href={`/files/f/${b.id}`} style={{ display: "inline-block", fontSize: 13, color: "#7c7c7c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
              {b.name}
            </Link>
            <Chevron />
          </span>
        ))}
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.name}
        </span>
        {/* The one screen certain to be showing the right file was the one
            screen with no way to fix its name. */}
        {/* Same rule as the list's pencil: a studio-wide grant is visibility,
            not the right to rename (QA, 2 Oct). */}
        {manage.has(id) ? (
          <RenameFile id={file.id} name={file.name} zh={zh} />
        ) : null}
        <div style={{ flexGrow: 1 }} />
        {canEdit && !file.tags.includes("proxy") ? <MoveFileButton id={file.id} name={file.name} folderId={file.folderId} zh={zh} /> : null}
        {editable(file.name, file.kind, file.mime) ? (
          <Link href={`/docs/${file.id}`} className="btn s" style={{ height: 30, textDecoration: "none", color: "#171717", marginRight: 6 }}>
            {held === "owner" || held === "editor" ? (zh ? "在线编辑" : "Edit") : zh ? "打开" : "Open"}
          </Link>
        ) : null}
        <a
          href={`/api/files/${file.id}/download?download=1`}
          className="btn s"
          style={{ height: 30, textDecoration: "none", color: "#171717" }}
        >
          {t("Download")}
        </a>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "22px 26px" }}>
          {file.text ? (
            <article style={{ maxWidth: 780 }}>
              {/* (QA, 2 Oct: a .docx came out as one run-on block. Only Markdown
                  files go through the Markdown renderer; anything else keeps
                  its own line breaks.) */}
              {/\.(md|markdown)$/i.test(file.name) ? (
                <Markdown text={file.text} />
              ) : (
                <div style={{ fontSize: 14, lineHeight: 1.8, color: "#262626" }}>
                  {file.text.split(/\n+/).map((para, i) =>
                    para.trim() ? (
                      <p key={i} style={{ margin: "0 0 10px", whiteSpace: "pre-wrap" }}>
                        {para}
                      </p>
                    ) : null,
                  )}
                </div>
              )}
            </article>
          ) : isMedia ? (
            <div
              style={{
                border: "1px solid #ededed",
                borderRadius: 12,
                overflow: "hidden",
                background: "#f8f8f8",
              }}
            >
              {file.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${file.id}/download`} alt={file.name} style={{ width: "100%" }} />
              ) : file.kind === "video" ? (
                <video src={`/api/files/${file.id}/download`} controls style={{ width: "100%" }} />
              ) : (
                <audio src={`/api/files/${file.id}/download`} controls style={{ width: "100%", padding: 16 }} />
              )}
            </div>
          ) : (
            <div
              style={{
                border: "1px solid #ededed",
                borderRadius: 12,
                padding: 40,
                textAlign: "center",
                fontSize: 13,
                color: "#999999",
              }}
            >
              {file.mime ?? (zh ? "无法预览的文件" : "Binary file")} · {formatBytes(file.sizeBytes)}
            </div>
          )}
        </div>

        <aside
          style={{
            width: 320,
            flexShrink: 0,
            borderLeft: "1px solid #ededed",
            background: "#fcfcfc",
            overflowY: "auto",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <section
            style={{ border: "1px solid #ededed", borderRadius: 10, background: "#fff", padding: "10px 12px" }}
          >
            <Row label={t("Owner")} value={(zh && row.ownerNameLocal) || row.ownerName} />
            <Row label={t("Size")} value={formatBytes(file.sizeBytes)} />
            <Row label={t("Modified")} value={formatDate(file.updatedAt, locale)} />
            {file.durationMs ? <Row label={zh ? "时长" : "Duration"} value={`${Math.round(file.durationMs / 1000)}s`} /> : null}
            {file.width ? <Row label={zh ? "分辨率" : "Resolution"} value={`${file.width}×${file.height}`} /> : null}
            {/* A checksum means nothing to most people: admins find it folded
                away under 技术细节 (QA, 2 Oct). */}
            {file.checksum && viewer.isAdmin ? (
              <details style={{ fontSize: 11.5, paddingTop: 6 }}>
                <summary style={{ cursor: "pointer", color: "#7c7c7c", listStyle: "revert" }}>{zh ? "技术细节" : "Technical details"}</summary>
                <Row label={zh ? "校验和" : "Checksum"} value={file.checksum.slice(0, 16)} />
              </details>
            ) : null}
          </section>

          <FileAccessControl
            fileId={file.id}
            fileName={file.name}
            visibility={seen.visibility}
            groups={seen.groups}
            userIds={seen.userIds}
            canChange={viewer.isAdmin || file.ownerId === viewer.id}
            zh={zh}
            sharedPeople={sharedPeople}
          />

          <ShareSheet
            objectType="file"
            objectId={file.id}
            ceiling={ceiling}
            locale={locale}
            /* Everyone and group grants are set in "Who can see this" above. */
            ownerId={file.ownerId}
            shares={people.map((s) => ({
              subjectId: s.tuple.subjectId,
              subjectType: s.tuple.subjectType,
              relation: s.tuple.relation,
              name: (zh && s.userNameLocal) || s.userName,
              expiresAt: s.tuple.expiresAt?.toISOString() ?? null,
            }))}
          />

          <FileVersions
            fileId={file.id}
            fileName={file.name}
            current={file.version}
            canEdit={canEdit && !file.tags.includes("proxy")}
            zh={zh}
            versions={versions.map((v) => ({
              versionNo: v.version.versionNo,
              author: (zh && v.authorNameLocal) || v.authorName,
              date: formatDate(v.version.createdAt, locale),
              note: v.version.note ? versionNote(v.version.note, zh) : null,
              stored: Boolean(v.version.storageKey),
            }))}
          />
        </aside>
      </div>
    </div>
  );
}

/** Version notes written by the server in English, said in the viewer's
 * language (QA, 2 Oct: the line read "— Uploaded"). */
function versionNote(note: string, zh: boolean) {
  if (!zh) return note;
  const known: Record<string, string> = { Uploaded: "上传", Created: "新建", "Edited online": "在线编辑", "New version": "上传新版本" };
  const restored = /^Restored from v(\d+)$/.exec(note);
  if (restored) return `恢复自 v${restored[1]}`;
  return known[note] ?? note;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 11.5,
        padding: "5px 0",
        borderBottom: "1px solid #f3f3f3",
      }}
    >
      <span style={{ color: "#999999" }}>{label}</span>
      <span style={{ color: "#383838", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </p>
  );
}

/* The separator the folder page's breadcrumb uses. */
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden style={{ width: 12, height: 12, flexShrink: 0, stroke: "#c7c7c7", fill: "none", strokeWidth: 2, strokeLinecap: "round" }}>
      <path d="m9.5 5.5 6 6.5-6 6.5" />
    </svg>
  );
}
