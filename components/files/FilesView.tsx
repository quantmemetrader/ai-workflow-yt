"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AccessPicker, type AccessChoice } from "@/components/files/AccessPicker";
import { FilesScreen, type FileRow, type FolderRow } from "@/components/canvas/FilesScreen";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { useLocalPreference } from "@/lib/client/preference";
import { NameDialog } from "@/components/ui/NameDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const LAYOUTS = ["list", "grid", "gallery"] as const;
import {
  deleteFileAction,
  deleteFolderAction,
  newFolderAction,
  renameFileAction,
  renameFolderAction,
  restoreFileAction,
  restoreFolderAction,
  setFileAccessAction,
} from "@/app/(app)/files/actions";
import { notify } from "@/lib/client/notify";
import { uploadFiles, type UploadProgress } from "@/lib/client/upload";

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
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const zh = locale.startsWith("zh");
  /* The agent answers in this module. It used to be a link to /chat, which is
   * why a question about a folder cost you the folder. */
  const agent = useInlineAgent({ module: "files", fileId: undefined });
  const [namingFolder, setNamingFolder] = useState(false);
  const [renaming, setRenaming] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);
  /* Deleting a folder takes everything in it, so it is confirmed by name
     rather than by a bin icon that acts the moment it is clicked. */
  const [deleting, setDeleting] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);

  // Which view of a folder this person likes, remembered in their browser.
  const [layout, setLayout] = useLocalPreference("aura:files-layout", LAYOUTS, "grid");
  /* Each batch is its own list, so two drops in a row do not renumber each
     other's rows; a batch with nothing left to say goes away. */
  const [batches, setBatches] = useState<{ id: number; rows: UploadProgress[] }[]>([]);
  const uploads = batches.flatMap((b) => b.rows);

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

  function upload(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length) setAsking(files);
  }

  async function send(files: File[], access: AccessChoice) {
    const id = Date.now() + Math.random();
    setBatches((b) => [...b, { id, rows: files.map((f) => ({ name: f.name, pct: 0 })) }]);

    const { uploaded, failed } = await uploadFiles(files, {
      folderId,
      access,
      onProgress: (rows) => setBatches((b) => b.map((x) => (x.id === id ? { ...x, rows } : x))),
      onDone: () => router.refresh(),
    });

    if (uploaded) notify(zh ? `已上传 ${uploaded} 个文件` : `Uploaded ${uploaded} ${uploaded === 1 ? "file" : "files"}`, "ok");
    // Rows that failed stay on screen with their reason; the rest have landed
    // in the list below and have nothing more to say.
    setBatches((b) =>
      failed
        ? b.map((x) => (x.id === id ? { ...x, rows: x.rows.filter((r) => r.error) } : x))
        : b.filter((x) => x.id !== id),
    );
  }

  /* "Drop a file here" is what the empty state says, so it has to be true.
     Listened for on the document: the drop target is the whole screen, and a
     file dragged over the browser must not open in a new tab instead. */
  const canUpload = canEdit && view === "folder";
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
      <FilesScreen
        breadcrumbs={breadcrumbs}
        folders={folders}
        files={files}
        sidebarFolders={sidebarFolders}
        currentFolderId={folderId}
        canEdit={canEdit}
        canCreate={canCreate}
        uploads={uploads}
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
                  router.refresh();
                })
            : undefined
        }
        layout={layout}
        onLayoutChange={setLayout}
        onAsk={(prompt) => void agent.send(prompt)}
        thread={
          <InlineAgentThread
            messages={agent.messages}
            notice={agent.notice}
            conversationId={agent.conversationId}
            zh={zh}
          />
        }
        onOpenFolder={(id) => router.push(id ? `/files/f/${id}` : "/files")}
        onOpenFile={(id) => router.push(`/files/${id}`)}
        onUploadClick={() => input.current?.click()}
        onNewFolder={() => setNamingFolder(true)}
        onSetAccess={(f) => setChanging(f)}
        onRename={canEdit ? (kind, id, name) => setRenaming({ kind, id, name }) : undefined}
        onDelete={
          canEdit && view !== "trash" ? (kind, id, name) => setDeleting({ kind, id, name }) : undefined
        }
      />
      {renaming && (
        <NameDialog
          title={zh ? "重命名" : "Rename"}
          placeholder={renaming.name}
          confirm={zh ? "保存" : "Save"}
          cancel={zh ? "取消" : "Cancel"}
          onClose={() => setRenaming(null)}
          onSubmit={(name) =>
            start(async () => {
              const res =
                renaming.kind === "file"
                  ? await renameFileAction(renaming.id, name)
                  : await renameFolderAction(renaming.id, name);
              if ("error" in res && res.error) notify(res.error);
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
              router.refresh();
            })
          }
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
