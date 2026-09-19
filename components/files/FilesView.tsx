"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilesScreen, type FileRow, type FolderRow } from "@/components/canvas/FilesScreen";
import { newFolderAction, restoreFileAction } from "@/app/(app)/files/actions";

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
  locale: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<{ name: string; pct: number; error?: string }[]>([]);

  async function upload(list: FileList) {
    const base = uploads.length;
    setUploads((u) => [...u, ...Array.from(list).map((f) => ({ name: f.name, pct: 0 }))]);

    await Promise.all(
      Array.from(list).map(async (file, offset) => {
        const index = base + offset;
        try {
          const presign = await fetch("/api/files/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: file.name,
              mime: file.type || "application/octet-stream",
              size: file.size,
              folderId,
            }),
          });
          if (!presign.ok) throw new Error(await presign.text());
          const { fileId, upload } = await presign.json();

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(upload.method, upload.url);
            for (const [k, v] of Object.entries(upload.headers as Record<string, string>)) {
              xhr.setRequestHeader(k, v);
            }
            xhr.upload.onprogress = (e) => {
              if (!e.lengthComputable) return;
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploads((u) => u.map((x, i) => (i === index ? { ...x, pct } : x)));
            };
            xhr.onload = () =>
              xhr.status < 300 ? resolve() : reject(new Error(`Storage said ${xhr.status}`));
            xhr.onerror = () => reject(new Error("The transfer failed"));
            xhr.send(file);
          });

          await fetch(`/api/files/${fileId}/complete`, { method: "POST" });
          setUploads((u) => u.filter((_, i) => i !== index));
          router.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          setUploads((u) => u.map((x, i) => (i === index ? { ...x, error: message } : x)));
        }
      }),
    );
  }

  return (
    <>
      <FilesScreen
        breadcrumbs={breadcrumbs}
        folders={folders}
        files={files}
        sidebarFolders={sidebarFolders}
        currentFolderId={folderId}
        canEdit={canEdit}
        uploads={uploads}
        locale={locale}
        model={model}
        view={view}
        onRestore={
          view === "trash"
            ? (id) =>
                start(async () => {
                  const res = await restoreFileAction(id);
                  if (res.error) window.alert(res.error);
                  router.refresh();
                })
            : undefined
        }
        onAsk={(prompt) => router.push(`/chat?q=${encodeURIComponent(prompt)}`)}
        onOpenFolder={(id) => router.push(id ? `/files/f/${id}` : "/files")}
        onOpenFile={(id) => router.push(`/files/${id}`)}
        onUploadClick={() => input.current?.click()}
        onNewFolder={() => {
          const name = window.prompt(locale.startsWith("zh") ? "新建文件夹" : "New folder");
          if (!name) return;
          start(async () => {
            const res = await newFolderAction(folderId, name);
            if (res.error) window.alert(res.error);
            router.refresh();
          });
        }}
      />
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
