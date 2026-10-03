"use client";

import * as React from "react";
import { useAsk } from "@/components/ui/useAsk";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { Poster } from "@/components/files/Poster";
import { Card, Empty, PageBody, INK, LINE, MUTED, smallButton } from "@/components/projects/kit";
import { uploadFiles, type UploadProgress } from "@/lib/client/upload";
import { notify } from "@/lib/client/notify";
import { Ago } from "@/components/ui/Ago";
import type { ProjectFile, ProjectFileRole } from "@/lib/projects/files";
import type { UploadAccess } from "@/components/chat/upload";
import {
  deleteProjectFilesAction,
  landProjectFileAction,
  moveProjectFilesAction,
  previewTextAction,
  renameProjectFileAction,
  unlinkProjectFileAction,
} from "@/app/(app)/projects/[id]/files/actions";

export type FileItem = ProjectFile & { tagged: boolean; inBin: boolean };

/* The box names, as `ROLE_LABEL` in lib/projects/files.ts has them — that
   module is server-only, so a client component keeps its own copy. */
const ROLE_LABEL: Record<ProjectFileRole, { zh: string; en: string }> = {
  clip: { zh: "素材", en: "Footage" },
  reference: { zh: "参考资料", en: "References" },
  render: { zh: "AI 成片", en: "AI renders" },
  final: { zh: "最终版视频", en: "Final videos" },
  cover: { zh: "封面", en: "Covers" },
  other: { zh: "其他", en: "Other" },
};

/** The boxes, in the order the page shows them: what is ready to post first. */
const ORDER: ProjectFileRole[] = ["final", "render", "clip", "reference", "other"];
/** Where an upload can be put (renders only come from the editor). */
const UPLOAD_TO: ProjectFileRole[] = ["clip", "reference", "final", "other"];

const HINT: Record<ProjectFileRole, { zh: string; en: string }> = {
  final: { zh: "团队在自己电脑上改好、准备发布的视频", en: "Videos the team finished on their own machine, ready to post" },
  render: { zh: "剪辑师渲染出来的成片，下载后可以自己再修改", en: "What the editor rendered; download it to fix it up yourself" },
  clip: { zh: "主持人拍好的口播和空镜，剪辑师从这里取素材", en: "What the host filmed; the editor cuts from these" },
  reference: { zh: "范例、笔记、资料，文案写脚本时会参考", en: "Examples, notes and research the writer reads" },
  cover: { zh: "剪辑师做的封面，发布时选一张", en: "Covers the editor made; pick one when posting" },
  other: { zh: "其他放进这个项目的文件", en: "Anything else put in this project" },
};

const EMPTY: Record<ProjectFileRole, { zh: string; en: string }> = {
  final: { zh: "还没有最终版。下载 AI 成片改好后，传到这里再去发布。", en: "No final video yet. Download the AI render, fix it up, and upload it here to post." },
  render: { zh: "还没有成片。素材到了，剪辑师剪完渲染后会出现在这里。", en: "No render yet. It appears here once the editor has cut and rendered." },
  clip: { zh: "主持人拍好的口播和空镜传到这里，剪辑师会自动拿到。", en: "Upload the host's takes and b-roll here; the editor picks them up." },
  reference: { zh: "把范例脚本、笔记、PDF 传到这里，文案写的时候会看。", en: "Upload example scripts, notes and PDFs; the writer reads them." },
  cover: { zh: "成片出来后，剪辑师会自动做三张封面。", en: "Covers are made when the render lands." },
  other: { zh: "暂时没有其他文件。", en: "Nothing else yet." },
};

const ROLE_ICON: Record<ProjectFileRole, IconName> = { final: "play", render: "film", clip: "clapper", reference: "doc", cover: "image", other: "folder" };

type View = "list" | "grid";
const VIEW_KEY = "pj-files-view";
const VIEW_EVENT = "pj-files-view";
/* The view when storage is refused (a private window): kept for the visit. */
let memoryView: View | null = null;
function readView(): View {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === "grid" || v === "list") return v;
  } catch {
    /* storage refused */
  }
  return memoryView ?? "list";
}
function storeView(v: View) {
  memoryView = v;
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* not remembered past this visit, still switched */
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
}
function subscribeView(onChange: () => void) {
  window.addEventListener(VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function ProjectFiles({
  projectId,
  zh,
  files,
  access,
  hasCut,
  hasScript,
}: {
  projectId: string;
  zh: boolean;
  files: FileItem[];
  access: UploadAccess;
  hasCut: boolean;
  hasScript: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const ask = useAsk(zh);
  const [query, setQuery] = React.useState("");
  const view = React.useSyncExternalStore(subscribeView, readView, () => "list" as View);
  const [target, setTarget] = React.useState<"auto" | ProjectFileRole>("auto");
  const [uploads, setUploads] = React.useState<UploadProgress[] | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [picked, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<FileItem | null>(null);
  const input = React.useRef<HTMLInputElement | null>(null);
  const dragDepth = React.useRef(0);

  const pickView = storeView;

  /* A selection only ever counts files still on the page (one deleted
     elsewhere drops out of it on the next refresh). */
  const liveIds = new Set(files.map((f) => f.id));
  const selected = new Set([...picked].filter((id) => liveIds.has(id)));

  const needle = query.trim().toLowerCase();
  const shown = needle ? files.filter((f) => f.name.toLowerCase().includes(needle) || f.ownerName.toLowerCase().includes(needle)) : files;
  const byRole = (r: ProjectFileRole) => shown.filter((f) => f.role === r);

  const guess = (f: File): ProjectFileRole => (f.type.startsWith("video/") ? "clip" : f.type.startsWith("audio/") ? "other" : "reference");

  async function upload(list: File[]) {
    if (!list.length) return;
    const roleOf = new Map<File, ProjectFileRole>(list.map((f) => [f, target === "auto" ? guess(f) : target]));
    setUploads(list.map((f) => ({ name: f.name, pct: 0 })));
    const notes: string[] = [];
    const out = await uploadFiles(list, {
      access,
      onProgress: (u) => setUploads(u),
      onDone: async (fileId, file) => {
        const r = await landProjectFileAction(projectId, fileId, roleOf.get(file) ?? "other");
        if ("error" in r && r.error) notes.push(r.error);
        else if ("note" in r && r.note) notes.push(r.note);
      },
    });
    if (out.uploaded) notify(t(`已上传 ${out.uploaded} 个文件`, `Uploaded ${out.uploaded} file(s)`), "ok");
    if (out.failed) notify(t(`${out.failed} 个文件没传上去，再试一次`, `${out.failed} file(s) failed; try again`));
    for (const n of notes) notify(n);
    router.refresh();
    window.setTimeout(() => setUploads(null), 2500);
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const failed = (r: unknown) => {
    const e = r && typeof r === "object" && "error" in r ? (r as { error?: string }).error : null;
    if (e) notify(e);
    return Boolean(e);
  };

  const act = {
    move: (ids: string[], role: ProjectFileRole) =>
      start(async () => {
        const r = await moveProjectFilesAction(projectId, ids, role);
        if (!failed(r)) notify(t(`已移到「${ROLE_LABEL[role].zh}」`, `Moved to ${ROLE_LABEL[role].en}`), "ok");
        setSelected(new Set());
        router.refresh();
      }),
    unlink: async (f: FileItem) => {
      const stays = f.inBin ? t("\n\n它还在剪辑台的素材箱里，所以仍会出现在「素材」。要彻底拿掉，请在剪辑台移除。", "\n\nIt is still in the editor's bin, so it stays under Footage. Remove it in the editor to take it out.") : "";
      if (!(await ask.confirm({ title: t(`把「${f.name}」移出这个项目？`, `Take "${f.name}" out of this project?`), body: t("文件还在「文件」里，不会删除。", "It stays in Files.") + stays }))) return;
      start(async () => {
        if (!failed(await unlinkProjectFileAction(projectId, f.id))) notify(t("已移出项目", "Taken out of the project"), "ok");
        router.refresh();
      });
    },
    remove: async (ids: string[]) => {
      const one = files.find((f) => f.id === ids[0]);
      const msg = ids.length === 1 && one ? t(`删除「${one.name}」？30 天内可以在回收站恢复。`, `Delete "${one.name}"? It can be restored from the trash for 30 days.`) : t(`删除选中的 ${ids.length} 个文件？30 天内可以在回收站恢复。`, `Delete ${ids.length} files? They can be restored from the trash for 30 days.`);
      if (!(await ask.confirm({ title: msg, danger: true }))) return;
      start(async () => {
        const r = await deleteProjectFilesAction(projectId, ids);
        if (!failed(r) && "deleted" in r) {
          notify(r.refused ? t(`删除了 ${r.deleted} 个，${r.refused} 个没有权限`, `Deleted ${r.deleted}; ${r.refused} need edit access`) : t(`已删除 ${r.deleted} 个文件`, `Deleted ${r.deleted} file(s)`), r.refused ? "error" : "ok");
        }
        setSelected(new Set());
        router.refresh();
      });
    },
    rename: async (f: FileItem, name: string) => {
      const clean = name.trim();
      if (!clean || clean === f.name) return;
      const r = await renameProjectFileAction(projectId, f.id, clean);
      if (!failed(r)) router.refresh();
    },
    copyLink: async (f: FileItem) => {
      const url = `${window.location.origin}/api/files/${f.id}/download`;
      try {
        await navigator.clipboard.writeText(url);
        notify(t("链接已复制，同事登录后可以打开", "Link copied; colleagues open it once signed in"), "ok");
      } catch {
        await ask.prompt({ title: t("复制这个链接", "Copy this link"), initial: url, confirm: t("好", "Done") });
      }
    },
    download: (ids: string[]) => {
      ids.forEach((id, i) =>
        window.setTimeout(() => {
          const a = document.createElement("a");
          a.href = `/api/files/${id}/download?download=1`;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, i * 400),
      );
    },
  };

  const selIds = [...selected];

  return (
    <>
      {ask.dialog}
    <PageBody>
      <style>{CSS}</style>
      {/* ---- the drop zone ---- */}
      <div
        className="pf-drop"
        data-drag={dragging ? "1" : undefined}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <span style={{ width: 44, height: 44, borderRadius: 12, background: "#fff", border: `1px solid ${LINE}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: INK, flexShrink: 0 }}>
          <Icon name="upload" size={20} />
        </span>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{t("把文件拖到这里，或点击上传", "Drop files here, or click to upload")}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
            {t("可以一次传多个，视频、图片、文档都行。", "Several at once; videos, pictures and documents all work.")}
            {target === "auto" ? t(" 视频放进「素材」，其他放进「参考资料」。", " Videos go to Footage, the rest to References.") : null}
            {(target === "clip" || target === "auto") && hasCut ? t(" 素材会自动进剪辑台。", " Footage goes straight to the editor.") : null}
            {target === "reference" && hasScript ? t(" 参考资料文案写脚本时会读。", " The writer reads references.") : null}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 12, color: MUTED, marginRight: 2 }}>{t("放到", "Put in")}</span>
          {(["auto", ...UPLOAD_TO] as const).map((r) => (
            <button key={r} type="button" onClick={() => setTarget(r)} className="pf-seg" data-on={target === r ? "1" : undefined}>
              {r === "auto" ? t("自动", "Auto") : zh ? ROLE_LABEL[r].zh : ROLE_LABEL[r].en}
            </button>
          ))}
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload(list);
          }}
        />
      </div>

      {uploads ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12 }}>
          {uploads.map((u, i) => (
            <div key={`${u.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
              <span style={{ minWidth: 0, flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: INK }}>{u.name}</span>
              <span style={{ width: 180, height: 6, borderRadius: 99, background: "#efefec", overflow: "hidden", flexShrink: 0 }}>
                <span style={{ display: "block", height: "100%", width: `${u.error ? 100 : u.pct}%`, background: u.error ? "#e0625a" : u.pct >= 100 ? "#22a061" : INK, transition: "width .25s linear" }} />
              </span>
              <span style={{ width: 64, textAlign: "right", color: u.error ? "#c42b2b" : MUTED, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                {u.error ? t("失败", "Failed") : u.pct >= 100 ? t("已完成", "Done") : `${u.pct}%`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ---- search, view, selection ---- */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, flexGrow: 1, maxWidth: 420, color: MUTED }}>
          <SearchGlyph />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("搜文件名或上传的人", "Search by name or uploader")} style={{ border: 0, outline: 0, background: "transparent", fontFamily: "inherit", fontSize: 13, color: INK, flexGrow: 1, minWidth: 0 }} />
        </label>
        <span style={{ fontSize: 12.5, color: MUTED }}>{needle ? t(`找到 ${shown.length} 个`, `${shown.length} found`) : t(`共 ${files.length} 个文件`, `${files.length} files`)}</span>
        <span style={{ flexGrow: 1 }} />
        <div style={{ display: "flex", padding: 2, borderRadius: 9, background: "#ecebe7" }}>
          {(["list", "grid"] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => pickView(v)} className="pf-view" data-on={view === v ? "1" : undefined}>
              {v === "list" ? <ListGlyph /> : <GridGlyph />}
              {v === "list" ? t("列表", "List") : t("网格", "Grid")}
            </button>
          ))}
        </div>
      </div>

      {selIds.length ? (
        <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 14px", borderRadius: 12, background: INK, color: "#fff" }}>
          <span style={{ fontSize: 13, fontWeight: 600, marginRight: 6 }}>{t(`已选 ${selIds.length} 个`, `${selIds.length} selected`)}</span>
          <button type="button" className="pf-bulk" onClick={() => act.download(selIds)}>
            <Icon name="download" size={13} />
            {t("下载", "Download")}
          </button>
          <MoveMenu zh={zh} dark disabled={pending} onPick={(r) => act.move(selIds, r)} />
          <button type="button" className="pf-bulk" disabled={pending} onClick={() => act.remove(selIds)}>
            <TrashGlyph />
            {t("删除", "Delete")}
          </button>
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="pf-bulk" onClick={() => setSelected(new Set())}>
            {t("取消选择", "Clear")}
          </button>
        </div>
      ) : null}

      {/* ---- the boxes ---- */}
      {ORDER.map((role) => {
        const list = byRole(role);
        const all = list.length > 0 && list.every((f) => selected.has(f.id));
        return (
          <Card
            key={role}
            id={`files-${role}`}
            icon={ROLE_ICON[role]}
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {zh ? ROLE_LABEL[role].zh : ROLE_LABEL[role].en}
                <span style={{ fontSize: 12, fontWeight: 500, color: MUTED, background: "#f3f3f1", borderRadius: 99, padding: "0 8px", lineHeight: "20px" }}>{list.length}</span>
              </span>
            }
            sub={zh ? HINT[role].zh : HINT[role].en}
            right={
              list.length ? (
                <button
                  type="button"
                  style={smallButton(false)}
                  onClick={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      for (const f of list) {
                        if (all) next.delete(f.id);
                        else next.add(f.id);
                      }
                      return next;
                    })
                  }
                >
                  {all ? t("取消全选", "Unselect") : t("全选", "Select all")}
                </button>
              ) : role !== "render" ? (
                <button
                  type="button"
                  style={smallButton(false)}
                  onClick={() => {
                    setTarget(role);
                    input.current?.click();
                  }}
                >
                  <Icon name="upload" size={13} />
                  {t("上传", "Upload")}
                </button>
              ) : null
            }
          >
            {list.length === 0 ? (
              <Empty icon={ROLE_ICON[role]} text={needle ? t("没有符合的文件", "Nothing matches") : zh ? EMPTY[role].zh : EMPTY[role].en} />
            ) : view === "list" ? (
              <div style={{ display: "flex", flexDirection: "column", border: `1px solid #efeeea`, borderRadius: 12, overflow: "visible" }}>
                {list.map((f, i) => (
                  <Row key={f.id} f={f} zh={zh} first={i === 0} selected={selected.has(f.id)} pending={pending} onToggle={() => toggle(f.id)} onPreview={() => setPreview(f)} act={act} />
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
                {list.map((f) => (
                  <Tile key={f.id} f={f} zh={zh} selected={selected.has(f.id)} pending={pending} onToggle={() => toggle(f.id)} onPreview={() => setPreview(f)} act={act} />
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {preview ? <PreviewModal key={preview.id} f={preview} zh={zh} projectId={projectId} onClose={() => setPreview(null)} onDownload={() => act.download([preview.id])} /> : null}
    </PageBody>
    </>
  );
}

type Acts = {
  move: (ids: string[], role: ProjectFileRole) => void;
  unlink: (f: FileItem) => void;
  remove: (ids: string[]) => void;
  rename: (f: FileItem, name: string) => Promise<void>;
  copyLink: (f: FileItem) => Promise<void>;
  download: (ids: string[]) => void;
};

const isVideo = (f: FileItem) => Boolean(f.mime?.startsWith("video/")) || f.kind === "video";
const isImage = (f: FileItem) => Boolean(f.mime?.startsWith("image/")) || f.kind === "image";

function Thumb({ f, width, height, radius = 8 }: { f: FileItem; width: number | string; height: number | string; radius?: number }) {
  if (isVideo(f) || isImage(f)) {
    return (
      <div style={{ position: "relative", width, height, flexShrink: 0 }}>
        <Poster src={`/api/files/${f.id}/thumb`} style={{ width: "100%", height: "100%", borderRadius: radius, objectFit: "cover" }} fallback={<Icon name={isVideo(f) ? "film" : "image"} size={18} />} />
        {isVideo(f) && f.durationMs ? (
          <span style={{ position: "absolute", right: 4, bottom: 4, fontSize: 10.5, fontWeight: 600, color: "#fff", background: "rgba(0,0,0,.62)", borderRadius: 4, padding: "0 5px", lineHeight: "16px", fontVariantNumeric: "tabular-nums" }}>{clock(f.durationMs)}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ width, height, flexShrink: 0, borderRadius: radius, background: "#f3f3f1", color: "#6b6b6b", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
      <Icon name="doc" size={18} />
      <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase" }}>{ext(f.name)}</span>
    </div>
  );
}

function Meta({ f, zh }: { f: FileItem; zh: boolean }) {
  const bits = [bytes(f.sizeBytes), isVideo(f) && f.durationMs ? clock(f.durationMs) : null, f.width && f.height ? `${f.width}×${f.height}` : null].filter(Boolean);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: MUTED, minWidth: 0, flexWrap: "wrap" }}>
      {bits.length ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{bits.join(" · ")}</span> : null}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <PersonAvatar id={f.ownerId} url={f.ownerAvatar} name={f.ownerName} size={16} />
        {f.ownerName}
      </span>
      <Ago iso={f.createdAt} zh={zh} />
      {f.role === "clip" && f.inBin ? <span style={{ color: "#1e7a4f", background: "#e7f6ee", borderRadius: 99, padding: "0 7px", lineHeight: "17px" }}>{zh ? "已在剪辑台" : "In the editor"}</span> : null}
    </div>
  );
}

function NameOrEdit({ f, editing, onDone, act, style }: { f: FileItem; editing: boolean; onDone: () => void; act: Acts; style?: React.CSSProperties }) {
  if (!editing) return <span title={f.name} style={{ fontSize: 13.5, fontWeight: 500, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, ...style }}>{f.name}</span>;
  return <EditName f={f} onDone={onDone} act={act} />;
}

/** The name as a box to type in; mounted afresh each time 重命名 is pressed. */
function EditName({ f, onDone, act }: { f: FileItem; onDone: () => void; act: Acts }) {
  const [value, setValue] = React.useState(f.name);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void act.rename(f, value).then(onDone);
      }}
      style={{ minWidth: 0, flexGrow: 1 }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void act.rename(f, value).then(onDone)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", fontSize: 13.5, fontFamily: "inherit", border: "1px solid #c9c9c4", borderRadius: 7, padding: "3px 8px" }}
      />
    </form>
  );
}

function Row({ f, zh, first, selected, pending, onToggle, onPreview, act }: { f: FileItem; zh: boolean; first: boolean; selected: boolean; pending: boolean; onToggle: () => void; onPreview: () => void; act: Acts }) {
  const [editing, setEditing] = React.useState(false);
  return (
    <div className="pf-row" data-sel={selected ? "1" : undefined} style={{ borderTop: first ? 0 : "1px solid #f0efeb" }}>
      <Check on={selected} onChange={onToggle} zh={zh} />
      <button type="button" onClick={onPreview} className="pf-thumb-btn" aria-label={zh ? "预览" : "Preview"}>
        <Thumb f={f} width={72} height={44} />
      </button>
      <div style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <NameOrEdit f={f} editing={editing} onDone={() => setEditing(false)} act={act} />
        <Meta f={f} zh={zh} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button type="button" style={smallButton(false)} onClick={onPreview}>
          <Icon name="eye" size={13} />
          {zh ? "预览" : "Preview"}
        </button>
        <button type="button" style={smallButton(false)} onClick={() => act.download([f.id])} title={zh ? "下载" : "Download"}>
          <Icon name="download" size={13} />
          {zh ? "下载" : "Download"}
        </button>
        <MoreMenu f={f} zh={zh} pending={pending} act={act} onRename={() => setEditing(true)} />
      </div>
    </div>
  );
}

function Tile({ f, zh, selected, pending, onToggle, onPreview, act }: { f: FileItem; zh: boolean; selected: boolean; pending: boolean; onToggle: () => void; onPreview: () => void; act: Acts }) {
  const [editing, setEditing] = React.useState(false);
  return (
    <div className="pf-tile" data-sel={selected ? "1" : undefined}>
      <div style={{ position: "relative" }}>
        <button type="button" onClick={onPreview} className="pf-thumb-btn" style={{ width: "100%", display: "block" }} aria-label={zh ? "预览" : "Preview"}>
          <Thumb f={f} width="100%" height={112} radius={9} />
        </button>
        <span style={{ position: "absolute", top: 6, left: 6 }}>
          <Check on={selected} onChange={onToggle} zh={zh} light />
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, minWidth: 0 }}>
        <div style={{ minWidth: 0, flexGrow: 1, display: "flex" }}>
          <NameOrEdit f={f} editing={editing} onDone={() => setEditing(false)} act={act} style={{ fontSize: 13 }} />
        </div>
        <MoreMenu f={f} zh={zh} pending={pending} act={act} onRename={() => setEditing(true)} withDownload />
      </div>
      <div style={{ marginTop: 4 }}>
        <Meta f={f} zh={zh} />
      </div>
    </div>
  );
}

function Check({ on, onChange, zh, light = false }: { on: boolean; onChange: () => void; zh: boolean; light?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={zh ? "选择" : "Select"}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="pf-check"
      data-on={on ? "1" : undefined}
      data-light={light ? "1" : undefined}
    >
      {on ? <Icon name="check" size={11} /> : null}
    </button>
  );
}

/** Close a popover on a press outside it or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);
  return ref;
}

function MoreMenu({ f, zh, pending, act, onRename, withDownload = false }: { f: FileItem; zh: boolean; pending: boolean; act: Acts; onRename: () => void; withDownload?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [open, setOpen] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const close = React.useCallback(() => {
    setOpen(false);
    setMoving(false);
  }, []);
  const ref = useDismiss(open, close);
  const item = (label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button
      type="button"
      className="pf-item"
      data-danger={danger ? "1" : undefined}
      disabled={pending}
      onClick={() => {
        close();
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );
  /* A render or a clip in the bin is in the project because the editor uses
     it: taking the tag off would change nothing on the page. */
  const canUnlink = f.tagged && f.role !== "render";
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="pf-more" aria-haspopup="menu" aria-expanded={open} aria-label={t("更多", "More")} onClick={() => setOpen((v) => !v)}>
        <DotsGlyph />
      </button>
      {open ? (
        <div role="menu" className="pf-menu">
          {moving ? (
            <>
              <div style={{ fontSize: 11.5, color: MUTED, padding: "4px 10px 6px" }}>{t("移到", "Move to")}</div>
              {UPLOAD_TO.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="pf-item"
                  disabled={pending || r === f.role}
                  onClick={() => {
                    close();
                    act.move([f.id], r);
                  }}
                >
                  <Icon name={ROLE_ICON[r]} size={13} />
                  {zh ? ROLE_LABEL[r].zh : ROLE_LABEL[r].en}
                  {r === f.role ? <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{t("当前", "here")}</span> : null}
                </button>
              ))}
            </>
          ) : (
            <>
              {withDownload ? item(t("下载", "Download"), <Icon name="download" size={13} />, () => act.download([f.id])) : null}
              {item(t("复制链接", "Copy link"), <Icon name="link" size={13} />, () => void act.copyLink(f))}
              {item(t("重命名", "Rename"), <Icon name="pen" size={13} />, onRename)}
              <button type="button" className="pf-item" disabled={pending} onClick={() => setMoving(true)}>
                <Icon name="folderOpen" size={13} />
                {t("移到…", "Move to…")}
                <span style={{ marginLeft: "auto", color: MUTED }}>›</span>
              </button>
              {canUnlink ? item(t("移出项目", "Take out of project"), <Icon name="undo" size={13} />, () => act.unlink(f)) : null}
              {f.role === "clip" && f.inBin ? <div style={{ fontSize: 11, color: MUTED, padding: "4px 10px 2px", lineHeight: 1.45, maxWidth: 200 }}>{t("这段素材在剪辑台素材箱里，要拿掉请在剪辑台移除", "This clip is in the editor's bin; remove it there to take it out")}</div> : null}
              <div style={{ height: 1, background: "#efeeea", margin: "4px 0" }} />
              {item(t("删除", "Delete"), <TrashGlyph />, () => act.remove([f.id]), true)}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MoveMenu({ zh, onPick, disabled, dark = false }: { zh: boolean; onPick: (r: ProjectFileRole) => void; disabled?: boolean; dark?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className={dark ? "pf-bulk" : "pf-item"} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="folderOpen" size={13} />
        {zh ? "移到…" : "Move to…"}
      </button>
      {open ? (
        <div role="menu" className="pf-menu" style={{ left: 0, right: "auto" }}>
          {UPLOAD_TO.map((r) => (
            <button
              key={r}
              type="button"
              className="pf-item"
              onClick={() => {
                close();
                onPick(r);
              }}
            >
              <Icon name={ROLE_ICON[r]} size={13} />
              {zh ? ROLE_LABEL[r].zh : ROLE_LABEL[r].en}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewModal({ f, zh, projectId, onClose, onDownload }: { f: FileItem; zh: boolean; projectId: string; onClose: () => void; onDownload: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const src = `/api/files/${f.id}/download`;
  const pdf = f.mime === "application/pdf" || /\.pdf$/i.test(f.name);
  const plain = Boolean(f.mime?.startsWith("text/")) || /\.(txt|md|srt|vtt|csv|json)$/i.test(f.name);
  const media = isVideo(f) || isImage(f) || Boolean(f.mime?.startsWith("audio/"));
  const needsText = !(media || pdf);
  const [text, setText] = React.useState<string | null>(null);
  const loading = needsText && text === null;
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  React.useEffect(() => {
    /* Text of any kind is read from what the store extracted (a document
       written in the app has no bytes in storage); PDFs and media play from
       the file itself. */
    if (!needsText) return;
    let live = true;
    void previewTextAction(projectId, f.id).then((r) => {
      if (live) setText("text" in r && typeof r.text === "string" ? r.text : "");
    });
    return () => {
      live = false;
    };
  }, [f.id, needsText, projectId]);
  return (
    <div role="dialog" aria-modal="true" aria-label={f.name} onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(20,20,20,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "min(1000px, 100%)", maxHeight: "100%", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${LINE}` }}>
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
              {zh ? ROLE_LABEL[f.role].zh : ROLE_LABEL[f.role].en} · {bytes(f.sizeBytes)} · {f.ownerName}
            </div>
          </div>
          <button type="button" style={smallButton(false)} onClick={onDownload}>
            <Icon name="download" size={13} />
            {t("下载", "Download")}
          </button>
          <button type="button" style={smallButton(false)} onClick={onClose}>
            {t("关闭", "Close")}
          </button>
        </div>
        <div style={{ flexGrow: 1, minHeight: 0, background: media ? "#0f0f0f" : "#fafaf8", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
          {isVideo(f) ? (
            <video src={src} controls autoPlay playsInline style={{ maxWidth: "100%", maxHeight: "72vh", display: "block" }} />
          ) : isImage(f) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={f.name} style={{ maxWidth: "100%", maxHeight: "72vh", display: "block", objectFit: "contain" }} />
          ) : f.mime?.startsWith("audio/") ? (
            <audio src={src} controls autoPlay style={{ width: "80%", margin: 40 }} />
          ) : pdf ? (
            <iframe src={src} title={f.name} style={{ width: "100%", height: "72vh", border: 0, background: "#fff" }} />
          ) : loading ? (
            <div style={{ padding: 60, color: MUTED, fontSize: 13 }}>{t("正在读取…", "Reading…")}</div>
          ) : !text && plain ? (
            <iframe src={src} title={f.name} style={{ width: "100%", height: "72vh", border: 0, background: "#fff" }} />
          ) : text ? (
            <pre style={{ margin: 0, padding: "22px 28px", width: "100%", maxHeight: "72vh", minHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.75, color: "#262626", boxSizing: "border-box" }}>{text}</pre>
          ) : (
            <div style={{ padding: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: MUTED, fontSize: 13 }}>
              <Icon name="doc" size={26} />
              {t("这种文件不能直接预览，下载后打开。", "This kind of file can't be previewed here; download it to open.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}
function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}
function GridGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}
function DotsGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  );
}
function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2h9.4L17.5 7M10 10.5v5.5M14 10.5v5.5" />
    </svg>
  );
}

function ext(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1] : "file";
}
function bytes(n: number): string {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const CSS = `
.pf-drop { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 22px 22px; border: 1.5px dashed #cfcdc6; border-radius: 16px; background: #fbfbf9; cursor: pointer; transition: border-color .15s ease, background-color .15s ease; }
.pf-drop:hover { border-color: #a9a79f; background: #fff; }
.pf-drop[data-drag] { border-color: #1f6feb; background: #f2f7ff; }
.pf-drop:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
.pf-seg { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #dcdbd6; background: #fff; color: #444; font-family: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.pf-seg:hover { border-color: #b9b8b2; }
.pf-seg[data-on] { background: #171717; border-color: #171717; color: #fff; }
.pf-view { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 11px; border: 0; border-radius: 7px; background: transparent; color: #6b6b6b; font-family: inherit; font-size: 12.5px; cursor: pointer; }
.pf-view[data-on] { background: #fff; color: #171717; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.pf-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; transition: background-color .12s ease; }
.pf-row:hover { background: #fafaf8; }
.pf-row[data-sel] { background: #f2f7ff; }
.pf-tile { padding: 8px; border: 1px solid #efeeea; border-radius: 12px; background: #fff; min-width: 0; transition: border-color .12s ease, box-shadow .12s ease; }
.pf-tile:hover { border-color: #d9d8d2; box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.pf-tile[data-sel] { border-color: #8fb3f0; background: #f7faff; }
.pf-thumb-btn { padding: 0; border: 0; background: none; cursor: zoom-in; border-radius: 9px; }
.pf-thumb-btn:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
.pf-check { width: 18px; height: 18px; flex-shrink: 0; border-radius: 5px; border: 1.5px solid #c9c8c2; background: #fff; color: #fff; display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; }
.pf-check[data-light] { box-shadow: 0 1px 3px rgba(0,0,0,.25); }
.pf-check[data-on] { background: #1f6feb; border-color: #1f6feb; }
.pf-more { width: 30px; height: 30px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: #555; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.pf-more:hover, .pf-more[aria-expanded="true"] { background: #f1f1ee; border-color: #e3e2dd; }
.pf-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; min-width: 176px; padding: 5px; background: #fff; border: 1px solid #e3e2dd; border-radius: 11px; box-shadow: 0 10px 30px rgba(0,0,0,.12); display: flex; flex-direction: column; }
.pf-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: #262626; font-family: inherit; font-size: 13px; text-align: left; cursor: pointer; white-space: nowrap; }
.pf-item:hover:not(:disabled) { background: #f4f4f1; }
.pf-item:disabled { color: #b0b0ab; cursor: default; }
.pf-item[data-danger] { color: #c42b2b; }
.pf-item[data-danger]:hover:not(:disabled) { background: #fdecea; }
.pf-bulk { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.08); color: #fff; font-family: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.pf-bulk:hover:not(:disabled) { background: rgba(255,255,255,.18); }
.pf-bulk:disabled { opacity: .5; cursor: default; }
@media (max-width: 720px) { .pf-row { flex-wrap: wrap; } }
`;
