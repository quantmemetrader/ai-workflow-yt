"use client";

import Link from "next/link";
import { Tiles, filesLabel, formatBytes, formatDate, type FileRow } from "@/components/canvas/FilesScreen";
import { Poster } from "@/components/files/Poster";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";

/** What a file is to a project, as `lib/files/lenses.ts` decided it. */
export type ProjectRole = "final" | "render" | "clip" | "graphic" | "audio" | "reference" | "other";

export type ProjectCard = {
  id: string;
  title: string;
  activeAt: string;
  files: { role: ProjectRole; file: FileRow }[];
  hidden: number;
};

/* The four shelves of a project card, in the order the work produces them
   last-first: the finished video is what somebody opening a project's files
   came for, so it leads. */
const SHELVES: { role: ProjectRole; zh: string; en: string }[] = [
  { role: "final", zh: "最终版视频", en: "Final videos" },
  { role: "render", zh: "成片", en: "Renders" },
  { role: "clip", zh: "素材", en: "Footage" },
  { role: "graphic", zh: "配图", en: "Pictures" },
  { role: "audio", zh: "配音", en: "Voice-over" },
  { role: "reference", zh: "参考资料", en: "References" },
  { role: "other", zh: "其他", en: "Other" },
];

/*
 * The card is a <details>: open and closed is the browser's own state, so
 * there is nothing to hydrate and nothing to disagree about, and the keyboard
 * and screen readers already know what it is. The chevron turns with it and
 * the few posters in the heading step aside once the card is open, since the
 * files themselves are then right below.
 */
const CSS = `
[data-proj-groups] details > summary { list-style: none; }
[data-proj-groups] details > summary::-webkit-details-marker { display: none; }
[data-proj-groups] .pg-chev { transition: transform .15s ease; }
[data-proj-groups] details[open] .pg-chev { transform: rotate(90deg); }
[data-proj-groups] .pg-peek { display: flex; gap: 4px; flex-shrink: 0; }
[data-proj-groups] details[open] .pg-peek { display: none; }
[data-proj-groups] summary:focus-visible { outline: 2px solid #171717; outline-offset: 2px; border-radius: 10px; }
[data-proj-groups] .pg-title:hover { text-decoration: underline; text-underline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { [data-proj-groups] .pg-chev { transition: none; } }
`;

/** A clip the director made from a still picture is named "… · 画面 #id". */
const isPictureShot = (f: FileRow) => f.name.includes("· 画面");

/**
 * 按项目: one card per project this person may see, each holding the files
 * the project uses, shelved as 成片 / 素材 / 配图 / 配音; below them 未归类,
 * the readable files no project uses.
 *
 * The tiles are the Files grid's own (`Tiles`), so a file here opens, is
 * renamed and is shared exactly as it is in a folder.
 */
export function ProjectGroups({
  projects,
  loose,
  looseTotal,
  needle,
  layout,
  locale,
  onOpenFile,
  onRename,
  onDelete,
  onSetAccess,
}: {
  projects: ProjectCard[];
  loose: FileRow[];
  looseTotal: number;
  needle: string;
  layout: "grid" | "gallery";
  locale: string;
  onOpenFile: (id: string) => void;
  onRename?: (kind: "file" | "folder", id: string, currentName: string) => void;
  onDelete?: (kind: "file" | "folder", id: string, currentName: string) => void;
  onSetAccess?: (file: FileRow) => void;
}) {
  const zh = locale.startsWith("zh");
  const t = filesLabel(zh);
  const matches = (f: FileRow) => !needle || f.name.toLowerCase().includes(needle);

  /* The filter box narrows by file name, and a project whose title matches
     keeps all its files: typing a project's name is how you find it. */
  const shown = projects
    .map((p) => {
      const titleHit = Boolean(needle) && p.title.toLowerCase().includes(needle);
      return { ...p, files: titleHit ? p.files : p.files.filter((x) => matches(x.file)) };
    })
    .filter((p) => !needle || p.files.length > 0 || p.title.toLowerCase().includes(needle));
  const looseShown = loose.filter(matches);
  /* The newest project that has something in it starts open, so the lens
     shows files the moment it is chosen rather than a stack of closed
     headings — and not the empty card of a project started a minute ago. */
  const firstOpen = shown.findIndex((p) => p.files.length > 0);

  const tiles = (files: FileRow[], tag?: (f: FileRow) => string | null) => (
    <Tiles
      layout={layout}
      folders={[]}
      files={files}
      locale={locale}
      onOpenFolder={() => {}}
      onOpenFile={onOpenFile}
      onRename={onRename}
      onDelete={onDelete}
      onSetAccess={onSetAccess}
      showDate
      tag={tag}
      zh={zh}
      t={t}
    />
  );

  return (
    <div data-proj-groups="" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {shown.length === 0 ? (
        <p style={{ margin: "4px 2px 6px", fontSize: 12.5, color: "#8a8a8a" }}>
          {needle
            ? zh
              ? "没有名称匹配的项目或文件。"
              : "No project or file matches that name."
            : zh
              ? "还没有你能看到的项目。项目用到的视频、图片和配音会按项目归到这里。"
              : "No projects you can see yet. The videos, pictures and voice-over a project uses are grouped here by project."}
        </p>
      ) : null}

      {shown.map((p, i) => {
        const count = (role: ProjectRole) => p.files.filter((x) => x.role === role).length;
        const bytes = p.files.reduce((sum, x) => sum + (x.file.sizeBytes || 0), 0);
        const peek = p.files.filter((x) => x.file.posterUrl).slice(0, 4);
        return (
          <details
            key={p.id}
            /* A filter opens every card it leaves standing. */
            open={i === firstOpen || Boolean(needle)}
            style={{ border: "1px solid #ededed", borderRadius: 12, background: "#ffffff" }}
          >
            <summary
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                cursor: "pointer",
                minHeight: 52,
              }}
            >
              <span className="pg-chev" style={{ display: "flex", color: "#8a8a8a" }}>
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
                >
                  <path d="m9.5 5.5 6 6.5-6 6.5" />
                </svg>
              </span>
              <span style={{ display: "flex", color: "#7c7c7c" }}>
                <Icon name="folder" size={15} />
              </span>
              <span style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                  {/* The title goes to the project; the rest of the heading
                      opens and closes the card. */}
                  <Link
                    href={`/projects/${p.id}/files`}
                    className="pg-title"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: "#171717",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {p.title}
                  </Link>
                  <span style={{ fontSize: 12, color: "#8a8a8a", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                    {p.files.length}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: "#8a8a8a", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {p.files.length === 0 ? (
                    <span>{zh ? "还没有文件" : "No files yet"}</span>
                  ) : (
                    SHELVES.filter((s) => count(s.role) > 0).map((s) => (
                      <span key={s.role} style={{ whiteSpace: "nowrap" }}>
                        <Tr zh={s.zh} en={s.en} inZh={zh} /> {count(s.role)}
                      </span>
                    ))
                  )}
                  {bytes > 0 ? <span>{formatBytes(bytes, locale)}</span> : null}
                  <span suppressHydrationWarning>{zh ? `${formatDate(p.activeAt, locale)} 更新` : `Updated ${formatDate(p.activeAt, locale)}`}</span>
                </span>
              </span>
              {peek.length ? (
                /* Laid out by the stylesheet, not inline: an inline display would
                   outrank the rule that hides it on an open card. */
                <span className="pg-peek" aria-hidden>
                  {peek.map((x) => (
                    <Poster
                      key={x.file.id}
                      src={x.file.posterUrl as string}
                      style={{ width: 46, height: 30, borderRadius: 5, objectFit: "cover", background: "#f3f3f3" }}
                    />
                  ))}
                </span>
              ) : null}
            </summary>

            <div style={{ padding: "2px 14px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
              {SHELVES.map((s) => {
                const list = p.files.filter((x) => x.role === s.role).map((x) => x.file);
                if (list.length === 0) return null;
                return (
                  <section key={s.role}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 500, color: "#525252", display: "flex", gap: 6 }}>
                      <Tr zh={s.zh} en={s.en} inZh={zh} />
                      <span style={{ color: "#8a8a8a", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>{list.length}</span>
                    </h3>
                    {tiles(list, s.role === "clip" ? (f) => (isPictureShot(f) ? (zh ? "画面" : "Still") : null) : undefined)}
                  </section>
                );
              })}
              {p.files.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: "#8a8a8a" }}>
                  {zh
                    ? "这个项目还没有用到文件。剪辑师放进素材箱的片段、渲染的成片和配音会出现在这里。"
                    : "This project uses no files yet. The clips put in its bin, its renders and its voice-over appear here."}
                </p>
              ) : null}
              {/* Files the project uses that this person may not open: a count,
                  so the card does not pretend to be the whole project, and no
                  names, because a name is part of the file. */}
              {p.hidden > 0 && !needle ? (
                <p style={{ margin: 0, fontSize: 12, color: "#8a8a8a", display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="lock" size={12} />
                  {zh ? `另有 ${p.hidden} 个文件你没有权限查看` : `${p.hidden} more ${p.hidden === 1 ? "file" : "files"} you do not have access to`}
                </p>
              ) : null}
            </div>
          </details>
        );
      })}

      {/* 未归类 — what no project uses. The stock is not in it: licensed
          pictures fetched and never used live in their own folder. */}
      {looseShown.length > 0 || (!needle && looseTotal > 0) ? (
        <section style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 2px 10px" }}>
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 500, color: "#171717" }}>
              <Tr zh="未归类" en="Not in a project" inZh={zh} />
            </h3>
            <span style={{ fontSize: 12, color: "#8a8a8a", fontVariantNumeric: "tabular-nums" }}>{needle ? looseShown.length : looseTotal}</span>
            <span style={{ fontSize: 12, color: "#8a8a8a" }}>
              {zh ? "没有被任何项目用到的文件" : "Files no project uses"}
            </span>
          </div>
          {tiles(looseShown)}
          {looseTotal > loose.length && !needle ? (
            <p style={{ margin: "12px 2px 0", fontSize: 12, color: "#8a8a8a" }}>
              {zh ? `显示最近的 ${loose.length} 个，共 ${looseTotal} 个。` : `Showing the latest ${loose.length} of ${looseTotal}.`}{" "}
              <Link href="/files" style={{ color: "#171717" }}>
                {zh ? "在“全部”里查看" : "See them all"}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
