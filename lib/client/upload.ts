"use client";

/**
 * Putting a file in the studio's store, from anywhere.
 *
 * Files had this inline, which was fine while Files was the only screen that
 * took an upload. The editor takes one too — dropping a clip onto the media
 * panel is how footage gets into a project — and a second copy of a
 * presign-upload-complete dance is a second place for it to drift.
 *
 * Three steps, and each is where it is for a reason:
 *
 *   1. **Presign.** The server decides the key and the permissions; the
 *      browser never picks either.
 *   2. **PUT straight to R2.** The bytes never pass through a function, so a
 *      four-gigabyte master costs the app nothing and is not bounded by any
 *      request body limit.
 *   3. **Complete.** The row is only marked usable once the object is really
 *      there, which is what stops a half-uploaded file appearing in a list.
 */
export type UploadProgress = { name: string; pct: number; error?: string };

export async function uploadFiles(
  list: FileList | File[],
  opts: {
    folderId?: string | null;
    /** Who sees the files, from the upload dialog. Omitted means private. */
    access?:
      | { mode: "private" }
      | { mode: "everyone" }
      | { mode: "groups"; groups: string[] }
      | { mode: "people"; userIds: string[] };
    onProgress?: (uploads: UploadProgress[]) => void;
    /** Called per file as it lands, with the id the store gave it. */
    onDone?: (fileId: string, file: File) => void | Promise<void>;
  } = {},
): Promise<{ uploaded: number; failed: number }> {
  const files = Array.from(list);
  const state: UploadProgress[] = files.map((f) => ({ name: f.name, pct: 0 }));
  const report = () => opts.onProgress?.([...state]);
  report();

  let uploaded = 0;
  let failed = 0;

  await Promise.all(
    files.map(async (file, index) => {
      try {
        const presign = await fetch("/api/files/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            mime: file.type || "application/octet-stream",
            size: file.size,
            folderId: opts.folderId ?? null,
            access: opts.access ?? { mode: "private" },
          }),
        });
        if (!presign.ok) throw new Error(await presign.text());
        const { fileId, upload } = (await presign.json()) as {
          fileId: string;
          upload: { method: string; url: string; headers: Record<string, string> };
        };

        // XHR rather than fetch: it is still the only way to get upload
        // progress, and a person watching a large file needs to see it move.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(upload.method, upload.url);
          for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            state[index] = { ...state[index], pct: Math.round((e.loaded / e.total) * 100) };
            report();
          };
          /* 2xx and nothing else. A refused cross-origin PUT reports status
             0, which `< 300` counted as a success — so a file the storage
             never received was confirmed, listed, and put on a timeline. */
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(xhr.status === 0 ? "The browser was not allowed to send the file to storage" : `Storage said ${xhr.status}`));
          xhr.onerror = () => reject(new Error("The transfer to storage failed. If this keeps happening, this address is not on the storage's allowed list."));
          xhr.send(file);
        });

        // The confirm step is what checks the bytes really landed; its answer
        // used to be thrown away.
        const confirmed = await fetch(`/api/files/${fileId}/complete`, { method: "POST" });
        if (!confirmed.ok) throw new Error((await confirmed.text()) || "The upload did not arrive");
        state[index] = { ...state[index], pct: 100 };
        report();
        uploaded++;
        await opts.onDone?.(fileId, file);
      } catch (err) {
        state[index] = {
          ...state[index],
          error: err instanceof Error ? err.message : "Upload failed",
        };
        report();
        failed++;
      }
    }),
  );

  return { uploaded, failed };
}
