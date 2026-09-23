import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, users } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { relationOn, shareCeiling } from "@/lib/authz/rebac";
import { listVersions, sharesWithNames } from "@/lib/files/service";
import { audit } from "@/lib/audit";
import { formatBytes, formatDate, makeT } from "@/lib/i18n";
import { Markdown } from "@/components/ui/Markdown";
import { ShareSheet } from "@/components/files/ShareSheet";
import { FileAccessControl } from "@/components/files/FileAccessControl";
import { visibilityForFiles } from "@/lib/files/access";
import { RenameFile } from "@/components/files/RenameFile";

/**
 * One file: the thing itself, who can open it, and every version of it.
 *
 * Laid out like the artboard's Gallery view — preview fills the pane, facts and
 * sharing sit in the 320px panel on the right — so it belongs to the same
 * screen family as the list it came from.
 */
export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("files");
  const locale = viewer.locale ?? "zh-CN";
  const t = makeT(locale);
  const zh = locale.startsWith("zh");

  const held = await relationOn(viewer, "file", id);
  if (!held) notFound();

  const [row] = await db
    .select({ file: files, ownerName: users.name })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    .where(eq(files.id, id))
    .limit(1);
  if (!row || row.file.deletedAt) notFound();

  await audit(viewer, "file.view", { objectType: "file", objectId: id, module: "files" });

  const [versions, shares, ceiling, vis] = await Promise.all([
    listVersions(viewer, id),
    sharesWithNames("file", id),
    shareCeiling(viewer, "file", id),
    visibilityForFiles([id]),
  ]);
  const seen = vis.get(id) ?? { visibility: "private" as const, groups: [], userIds: [] };

  const file = row.file;
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
        <Link href="/files" style={{ fontSize: 13, color: "#7c7c7c" }}>
          {t("Files")}
        </Link>
        <span style={{ color: "#c7c7c7" }}>/</span>
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
        {held === "owner" || held === "editor" ? (
          <RenameFile id={file.id} name={file.name} zh={zh} />
        ) : null}
        <div style={{ flexGrow: 1 }} />
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
              <Markdown text={file.text} />
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
              {file.mime ?? "Binary file"} · {formatBytes(file.sizeBytes)}
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
            <Row label={t("Owner")} value={row.ownerName} />
            <Row label={t("Size")} value={formatBytes(file.sizeBytes)} />
            <Row label={t("Modified")} value={formatDate(file.updatedAt, locale)} />
            {file.durationMs ? <Row label={zh ? "时长" : "Duration"} value={`${Math.round(file.durationMs / 1000)}s`} /> : null}
            {file.width ? <Row label={zh ? "分辨率" : "Resolution"} value={`${file.width}×${file.height}`} /> : null}
            {file.checksum ? <Row label={zh ? "校验和" : "Checksum"} value={file.checksum.slice(0, 16)} /> : null}
          </section>

          <FileAccessControl
            fileId={file.id}
            fileName={file.name}
            visibility={seen.visibility}
            groups={seen.groups}
            userIds={seen.userIds}
            canChange={viewer.isAdmin || file.ownerId === viewer.id}
            zh={zh}
          />

          <ShareSheet
            objectType="file"
            objectId={file.id}
            ceiling={ceiling}
            locale={locale}
            /* Everyone and group grants are set in "Who can see this" above. */
            shares={shares
              .filter((s) => s.tuple.subjectType !== "tenant" && s.tuple.subjectType !== "role" && s.tuple.relation !== "viewer")
              .map((s) => ({
              subjectId: s.tuple.subjectId,
              subjectType: s.tuple.subjectType,
              relation: s.tuple.relation,
              name: s.userName,
              expiresAt: s.tuple.expiresAt?.toISOString() ?? null,
            }))}
          />

          <section
            style={{ border: "1px solid #ededed", borderRadius: 10, background: "#fff", padding: "10px 12px" }}
          >
            <div className="lbl" style={{ padding: 0, marginBottom: 8 }}>
              {t("Versions")}
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
              {versions.map((v) => (
                <li key={v.version.id} style={{ fontSize: 11.5, color: "#7c7c7c" }}>
                  <span style={{ fontWeight: 500, color: "#171717" }}>v{v.version.versionNo}</span> ·{" "}
                  {v.authorName} · {formatDate(v.version.createdAt, locale)}
                  {v.version.note ? ` — ${v.version.note}` : ""}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
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
