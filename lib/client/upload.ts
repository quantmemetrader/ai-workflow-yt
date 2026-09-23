"use client";

import { startUploads } from "@/lib/client/uploads";
import type { UploadAccess } from "@/components/chat/upload";

/**
 * Putting a file in the studio's store, from anywhere.
 *
 * Files and the editor both call this. It used to run the presign → PUT →
 * confirm dance itself, in one request per file — which is what a 590 MB
 * master from Hong Kong could not survive, and which died with the page the
 * moment the person clicked elsewhere. Both are now `uploads.ts`'s problem:
 * the transfer lives above the page, is multipart past 64 MB, and is drawn
 * by the tray in the app layout. This is the same call it always was, so the
 * screens did not have to change to get that.
 */
export type UploadProgress = { name: string; pct: number; error?: string };

export async function uploadFiles(
  list: FileList | File[],
  opts: {
    folderId?: string | null;
    /** Who sees the files, from the upload dialog. Omitted means private. */
    access?: UploadAccess;
    onProgress?: (uploads: UploadProgress[]) => void;
    /** Called per file as it lands, with the id the store gave it. */
    onDone?: (fileId: string, file: File) => void | Promise<void>;
  } = {},
): Promise<{ uploaded: number; failed: number }> {
  return startUploads(Array.from(list), {
    folderId: opts.folderId,
    access: opts.access,
    onDone: opts.onDone,
    onProgress: opts.onProgress
      ? (batch) => opts.onProgress?.(batch.map((j) => ({ name: j.name, pct: Math.round(j.pct * 100), error: j.error })))
      : undefined,
  });
}
