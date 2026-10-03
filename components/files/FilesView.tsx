"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useDroppedFiles } from "@/lib/client/dropped";
import { useRouter } from "next/navigation";
import { AccessPicker, type AccessChoice } from "@/components/files/AccessPicker";
import { FilesScreen, type FileRow, type FilesLens, type FolderRow } from "@/components/canvas/FilesScreen";
import { ProjectGroups, type ProjectCard } from "@/components/files/ProjectGroups";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { useLocalPreference } from "@/lib/client/preference";
import { NameDialog } from "@/components/ui/NameDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAsk } from "@/components/ui/useAsk";
import { MoveDialog, type MoveItems } from "@/components/files/MoveDialog";
import { useNewVersion } from "@/components/files/FileVersions";

const LAYOUTS = ["list", "grid", "gallery"] as const;
import {
  deleteFileAction,
  deleteFilesAction,
  deleteFolderAction,
  folderPurgeCountAction,
  purgeFolderAction,
  newFolderAction,
  purgeFileAction,
  renameFileAction,
  renameFolderAction,
  restoreFileAction,
  restoreFolderAction,
  setFileAccessAction,
} from "@/app/(app)/files/actions";
import { notify } from "@/lib/client/notify";
import { uploadFiles } from "@/lib/client/upload";
import { readUploads, serverUploads, subscribeUploads } from "@/lib/client/uploads";

/**
 * Live wiring for the Files artboard.
 *
 * Uploads go browser → R2 on a presigned URL, so the progress bar is the real
 * transfer and a 4 GB master never passes through a server function. The row
 * is created first (that is what owns the key and the permissions) and
 * confirmed once the object has actually landed.
 */
export function FilesView({
  model,
  view = "folder",
  folderId,
  breadcrumbs,
  folders,
  files,
  sidebarFolders,
  canEdit,
  canCreate,
  locale,
  lens,
  projects,
  loose,
  looseTotal,
}: {
  model: string;
  view?: "folder" | "recent" | "shared" | "trash";
  folderId: string | null;
  breadcrumbs: { id: string; name: string }[];
  folders: FolderRow[];
  files: FileRow[];
  sidebarFolders: FolderRow[];
  canEdit: boolean;
  canCreate?: boolean;
  locale: string;
  /** The top of Files only: which lens is showing, and for 按项目 the cards
   * and the unfiled files (`lib/files/lenses.ts`). */
  lens?: FilesLens;
  projects?: ProjectCard[];
  loose?: FileRow[];
  looseTotal?: number;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const zh = locale.startsWith("zh");
  const ask = useAsk(zh);
  /* The agent answers in this module. It used to be a link to /chat, which is
   * why a question about a folder cost you the folder. */
  const agent = useInlineAgent({ module: "files", fileId: undefined });
  const [namingFolder, setNamingFolder] = useState(false);
  const [renaming, setRenaming] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);
  /* Deleting a folder takes everything in it, so it is confirmed by name
     rather than by a bin icon that acts the moment it is clicked. */
  const [deleting, setDeleting] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);
  /* 永久删除 from the trash, confirmed by name (QA, 2 Oct). */
  const [purging, setPurging] = useState<{ id: string; name: string } | null>(null);
  /* 移动到… for a row, a tile, or the files ticked in 选择多个文件. */
  const [moving, setMoving] = useState<MoveItems | null>(null);
  const newVersion = useNewVersion(zh);

  // Which view of a folder this person likes, remembered in their browser.
  const [layout, setLayout] = useLocalPreference("aura:files-layout", LAYOUTS, "grid");

  /*
   * The same presign → PUT → confirm dance the editor uses. This screen had
   * its own copy with the bug the shared one fixed: a PUT the storage refused
   * reported status 0, `< 300` counted that as a success, the unchecked
   * confirm was swallowed, and a file that never arrived sat in the list as
   * if it had.
   */
  /* Who sees them is asked the moment files are added, before a byte moves:
     the choice is part of the upload, so a file is never briefly visible to
     people it was not meant for. */
  const [asking, setAsking] = useState<File[] | null>(null);
  const [changing, setChanging] = useState<FileRow | null>(null);
  /* 批量选择 (Ryan, 30 Sep: "there needs to be a batch delete for files"). */
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stopPicking = () => { setPicking(false); setPicked(new Set()); };

  function upload(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length) setAsking(files);
  }

  /* Progress is drawn by the upload tray in the app layout, not here: the
     transfer outlives this screen, so its picture has to as well. Leaving the
     folder mid-upload used to kill the upload. The row itself exists from the
     first byte, so the card it makes in the list below is told how far the
     bytes have got and draws that instead of a broken poster. */
  const jobs = useSyncExternalStore(subscribeUploads, readUploads, serverUploads);
  const progress = new Map(jobs.filter((j) => j.fileId && j.status === "uploading").map((j) => [j.fileId as string, j.pct]));
  const rows = progress.size ? files.map((f) => (progress.has(f.id) ? { ...f, uploading: progress.get(f.id) } : f)) : files;

  async function send(files: File[], access: AccessChoice) {
    const { uploaded } = await uploadFiles(files, { folderId, access, onDone: () => router.refresh() });
    if (uploaded) notify(zh ? `已上传 ${uploaded} 个文件` : `Uploaded ${uploaded} ${uploaded === 1 ? "file" : "files"}`, "ok");
  }

  /* "Drop a file here" is what the empty state says, so it has to be true.
     Listened for on the document: the drop target is the whole screen, and a
     file dragged over the browser must not open in a new tab instead. */
  const canUpload = canEdit && view === "folder";
  /* Files dropped on a Files page that cannot take them here (recent, shared) arrive at the folder. */
  useDroppedFiles(canUpload ? "files" : null, (list) => upload(list));
  const openFile = (id: string) => router.push(`/files/${id}`);
  const rename = canEdit ? (kind: "file" | "folder", id: string, name: string) => setRenaming({ kind, id, name }) : undefined;
  const remove = canEdit && view !== "trash" ? (kind: "file" | "folder", id: string, name: string) => setDeleting({ kind, id, name }) : undefined;
  const move =
    canEdit && view !== "trash"
      ? (kind: "file" | "folder", id: string, name: string) => setMoving(kind === "file" ? { files: [id], folders: [], label: name } : { files: [], folders: [id], label: name })
      : undefined;
  const uploadVersion = canEdit && view !== "trash" ? (id: string, name: string) => newVersion.pick(id, name) : undefined;

  /* 永久删除 on a folder in the trash: the count is read first, so the
     dialog can say how many files go with it. */
  async function purgeFolder(id: string, name: string) {
    const count = await folderPurgeCountAction(id);
    if ("error" in count && count.error) {
      notify(count.error);
      return;
    }
    const n = "files" in count ? count.files : 0;
    const sub = "folders" in count ? Math.max(0, count.folders - 1) : 0;
    const live = "live" in count ? count.live : 0;
    /* Said before the click: other people's files in it are an admin's call. */
    if ("blocked" in count && count.blocked) {
      notify(zh ? `“${name}”：${count.blocked}` : `${count.others} items in “${name}” belong to other people; only an admin can delete them forever`);
      return;
    }
    if (live > 0) {
      notify(zh ? `“${name}”里还有 ${live} 项没有删除，请先把它们移出这个文件夹` : `“${name}” still holds ${live} items that are not in the trash; move them out first`);
      return;
    }
    const ok = await ask.confirm({
      title: zh ? `永久删除文件夹“${name}”？` : `Delete “${name}” forever?`,
      body: zh
        ? `会彻底删除这个文件夹${sub ? `、其中 ${sub} 个子文件夹` : ""}和 ${n} 个文件（包括它们的所有版本），之后无法恢复。`
        : `This removes the folder${sub ? `, ${sub} subfolders` : ""} and ${n} ${n === 1 ? "file" : "files"} (every version of each) for good. It cannot be undone.`,
      confirm: zh ? "永久删除" : "Delete forever",
      danger: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await purgeFolderAction(id);
      if ("error" in res && res.error) notify(res.error);
      else notify(zh ? `已永久删除“${name}”和 ${n} 个文件` : `Deleted “${name}” and ${n} files for good`, "ok");
      router.refresh();
    });
  }
  useEffect(() => {
    if (!canUpload) return;
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      void upload(e.dataTransfer.files);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", drop);
    };
  }, [canUpload, folderId]);

  return (
    <>
      {ask.dialog}
      {newVersion.picker}
      <FilesScreen
        breadcrumbs={breadcrumbs}
        folders={folders}
        files={rows}
        sidebarFolders={sidebarFolders}
        currentFolderId={folderId}
        canEdit={canEdit}
        canCreate={canCreate}
        uploads={[]}
        locale={locale}
        model={model}
        view={view}
        onRestore={
          view === "trash"
            ? (id) =>
                start(async () => {
                  /* The trash lists files and folders together, and the row
                     only hands back an id — so the file is tried first and a
                     folder id falls through to the folder restore. */
                  const res = folders.some((f) => f.id === id)
                    ? await restoreFolderAction(id)
                    : await restoreFileAction(id);
                  if (res.error) notify(res.error);
                  else notify(zh ? "已恢复到原来的位置" : "Restored to where it was", "ok");
                  router.refresh();
                })
            : undefined
        }
        onPurge={view === "trash" ? (id, name) => setPurging({ id, name }) : undefined}
        onPurgeFolder={view === "trash" ? (id, name) => void purgeFolder(id, name) : undefined}
        onMove={move}
        onNewVersion={uploadVersion}
        layout={layout}
        onLayoutChange={setLayout}
        lens={lens}
        renderBody={
          lens === "projects"
            ? (needle) => (
                <ProjectGroups
                  projects={projects ?? []}
                  loose={loose ?? []}
                  looseTotal={looseTotal ?? 0}
                  needle={needle}
                  /* A project's files are pictures first; the list layout's
                     columns would repeat one header per shelf, so it draws
                     as the grid here. */
                  layout={layout === "gallery" ? "gallery" : "grid"}
                  locale={locale}
                  onOpenFile={openFile}
                  onRename={rename}
                  onDelete={remove}
                  onSetAccess={(f) => setChanging(f)}
                />
              )
            : undefined
        }
        onAsk={(prompt, files) => void agent.send(prompt, files)}
        thread={
          <InlineAgentThread
            messages={agent.messages}
            notice={agent.notice}
            conversationId={agent.conversationId}
            zh={zh}
          />
        }
        onOpenFolder={(id) => router.push(id ? `/files/f/${id}` : "/files")}
        onOpenFile={picking ? togglePick : openFile}
        selected={picking ? picked : undefined}
        /* Batch select acts only on the files the filter box leaves showing:
           全选 used to tick every row in the folder, and with a filter showing
           12 it trashed 89 (QA, 3 Oct). The 按项目 lens draws its own shelves
           with no ticks, so it has no batch bar at all. */
        banner={(visibleIds: string[]) => {
          if (!(canEdit && view !== "trash" && lens !== "projects" && rows.length)) return null;
          const visible = new Set(visibleIds);
          const chosen = [...picked].filter((id) => visible.has(id));
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
              {picking ? (
                <>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#171717" }}>{zh ? `已选 ${chosen.length} 个文件` : `${chosen.length} selected`}</span>
                  <button type="button" className="fv-btn" disabled={!visibleIds.length} onClick={() => setPicked(new Set(visibleIds))}>{zh ? "全选" : "Select all"}</button>
                  <button
                    type="button"
                    className="fv-btn danger"
                    disabled={!chosen.length}
                    onClick={async () => {
                      if (!chosen.length || !(await ask.confirm({ title: zh ? `把 ${chosen.length} 个文件移到回收站？` : `Move ${chosen.length} files to the trash?`, body: zh ? "30 天内可以恢复。" : "They can be restored for 30 days.", confirm: zh ? "移到回收站" : "Move to trash", danger: true }))) return;
                      start(async () => {
                        const res = await deleteFilesAction(chosen);
                        if (res.error) notify(res.error);
                        else notify(zh ? `已删除 ${res.deleted} 个${res.failed ? `，${res.failed} 个没有权限` : ""}` : `Deleted ${res.deleted}${res.failed ? `, ${res.failed} not allowed` : ""}`, res.failed ? "info" : "ok");
                        stopPicking();
                        router.refresh();
                      });
                    }}
                  >
                    {zh ? "删除所选" : "Delete selected"}
                  </button>
                  <button
                    type="button"
                    className="fv-btn"
                    disabled={!chosen.length}
                    onClick={() => setMoving({ files: chosen, folders: [], label: zh ? `${chosen.length} 个文件` : `${chosen.length} files` })}
                  >
                    {zh ? "移动所选" : "Move selected"}
                  </button>
                  <button type="button" className="fv-btn" onClick={stopPicking}>{zh ? "取消" : "Cancel"}</button>
                </>
              ) : (
                <button type="button" className="fv-btn" onClick={() => setPicking(true)}>{zh ? "选择多个文件" : "Select files"}</button>
              )}
              <style>{`.fv-btn{height:30px;padding:0 12px;border:1px solid #dcdbd6;border-radius:8px;background:#fff;color:#262626;font:inherit;font-size:12.5px;cursor:pointer}.fv-btn:hover{background:#f7f7f5}.fv-btn.danger{border-color:#e5484d;color:#c62a2f}.fv-btn:disabled{opacity:.45;cursor:default}`}</style>
            </div>
          );
        }}
        onUploadClick={() => input.current?.click()}
        onNewFolder={() => setNamingFolder(true)}
        onSetAccess={(f) => setChanging(f)}
        onRename={rename}
        onDelete={remove}
      />
      {renaming && (
        <NameDialog
          title={zh ? "重命名" : "Rename"}
          placeholder={renaming.name}
          /* Starts from the current name (QA, 2 Oct: it opened empty). */
          initial={renaming.name}
          confirm={zh ? "保存" : "Save"}
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setRenaming(null)}
          onSubmit={(name) =>
            start(async () => {
              const res =
                renaming.kind === "file"
                  ? await renameFileAction(renaming.id, name)
                  : await renameFolderAction(renaming.id, name);
              /* Say it worked: inside a folder the list reorders and the row
                 can move out of sight (QA, 2 Oct: no toast). */
              if ("error" in res && res.error) notify(res.error);
              else if (name.trim() && name.trim() !== renaming.name) notify(zh ? `已改名为“${"name" in res && res.name ? res.name : name.trim()}”` : `Renamed to “${"name" in res && res.name ? res.name : name.trim()}”`, "ok");
              router.refresh();
            })
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={deleting.kind === "folder" ? (zh ? "删除文件夹" : "Delete folder") : zh ? "删除文件" : "Delete file"}
          body={
            deleting.kind === "folder"
              ? zh
                ? `“${deleting.name}”及其中的所有内容都会移到回收站，30 天内可以恢复。`
                : `“${deleting.name}” and everything inside it moves to the trash. You have 30 days to put it back.`
              : zh
                ? `“${deleting.name}”会移到回收站，30 天内可以恢复。`
                : `“${deleting.name}” moves to the trash. You have 30 days to put it back.`
          }
          confirm={zh ? "移到回收站" : "Move to trash"}
          danger
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            start(async () => {
              const target = deleting;
              setDeleting(null);
              if (!target) return;
              const res =
                target.kind === "folder"
                  ? await deleteFolderAction(target.id)
                  : await deleteFileAction(target.id);
              if ("error" in res && res.error) notify(res.error);
              else if ("files" in res && res.files)
                notify(zh ? `已移到回收站 · ${res.files} 个文件` : `Moved to trash · ${res.files} files`);
              /* A single file, or an empty folder, said nothing (QA, 3 Oct). */
              else notify(zh ? "已移到回收站" : "Moved to trash", "ok");
              router.refresh();
            })
          }
        />
      )}

      {purging && (
        <ConfirmDialog
          title={zh ? "永久删除" : "Delete forever"}
          body={zh ? `“${purging.name}”会被彻底删除，之后无法恢复。` : `“${purging.name}” will be gone for good. This cannot be undone.`}
          confirm={zh ? "永久删除" : "Delete forever"}
          danger
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setPurging(null)}
          onConfirm={() =>
            start(async () => {
              const target = purging;
              setPurging(null);
              if (!target) return;
              const res = await purgeFileAction(target.id);
              if (res.error) notify(res.error);
              else notify(zh ? `已永久删除“${target.name}”` : `Deleted “${target.name}” for good`, "ok");
              router.refresh();
            })
          }
        />
      )}

      {moving && (
        <MoveDialog
          zh={zh}
          items={moving}
          currentFolderId={moving.folders.length ? undefined : folderId}
          onClose={() => setMoving(null)}
          onMoved={() => {
            if (moving.files.length > 1) stopPicking();
          }}
        />
      )}

      {namingFolder && (
        <NameDialog
          title={zh ? "新建文件夹" : "New folder"}
          placeholder={zh ? "文件夹名称" : "Name it"}
          confirm={zh ? "创建" : "Create"}
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setNamingFolder(false)}
          onSubmit={(name) =>
            start(async () => {
              const res = await newFolderAction(folderId, name);
              if (res.error) notify(res.error);
              else notify(zh ? `已新建文件夹「${name}」` : `Folder “${name}” created`, "ok");
              router.refresh();
            })
          }
        />
      )}

      {asking && (
        <AccessPicker
          zh={zh}
          title={
            zh
              ? `谁可以看这 ${asking.length} 个文件？`
              : `Who can see ${asking.length === 1 ? `“${asking[0].name}”` : `these ${asking.length} files`}?`
          }
          confirm={zh ? "上传" : "Upload"}
          note={
            folderId
              ? zh
                ? "如果这个文件夹已分享给别人，他们也能看到里面的文件。"
                : "If this folder is shared, whoever it is shared with sees what is in it too."
              : undefined
          }
          onClose={() => setAsking(null)}
          onConfirm={(access) => {
            const files = asking;
            setAsking(null);
            void send(files, access);
          }}
        />
      )}

      {changing && (
        <AccessPicker
          zh={zh}
          title={zh ? `谁可以看“${changing.name}”？` : `Who can see “${changing.name}”?`}
          confirm={zh ? "保存" : "Save"}
          initial={
            changing.visibility === "everyone"
              ? { mode: "everyone" }
              : changing.visibility === "groups"
                ? { mode: "groups", groups: changing.groups ?? [] }
                : changing.visibility === "people"
                  ? { mode: "people", userIds: changing.userIds ?? [] }
                  : { mode: "private" }
          }
          onClose={() => setChanging(null)}
          onConfirm={(access) => {
            const id = changing.id;
            setChanging(null);
            start(async () => {
              const res = await setFileAccessAction([id], access);
              if (res.error) notify(res.error);
              else notify(zh ? "已更新访问权限" : "Access updated", "ok");
              router.refresh();
            });
          }}
        />
      )}

      <input
        ref={input}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}
