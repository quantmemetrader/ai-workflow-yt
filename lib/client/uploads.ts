"use client";

import { uploadToStudio, type UploadTarget } from "@/components/chat/upload";

/**
 * Uploads that outlive the page that started them.
 *
 * A 590 MB master takes minutes from Hong Kong. Until now the transfer was
 * owned by the Files screen's own React state: click into a folder, open a
 * project, and the component that held the XHR was gone — the bytes stopped,
 * the row it had already made stayed behind, and the list showed a file with
 * nothing in it. The person who reported it did exactly that.
 *
 * So the transfer lives here, in module state above every page, the same way
 * `busy.ts` and `collecting.ts` hold what a page cannot. `UploadTray` in the
 * app layout draws it wherever you are; a page that starts an upload only
 * asks for it and, if it wants, hears when each file lands.
 *
 * Memory rather than `localStorage`: a `File` handle cannot be stored, so a
 * reload genuinely ends the upload — which is why the tray also warns before
 * one while anything is still moving.
 */
export type UploadJob = {
  key: string;
  name: string;
  size: number;
  /** 0–1. The bytes, which are all but the whole wait. */
  pct: number;
  status: "uploading" | "done" | "failed" | "cancelled";
  error?: string;
  /** Known once the store has made the row — before the bytes finish. */
  fileId?: string;
  folderId: string | null;
  startedAt: number;
};

const EVENT = "aura:uploads";

/** A landed file has nothing more to say after a few seconds. */
const CLEAR_DONE_AFTER = 5000;

let jobs: UploadJob[] = [];
const controllers = new Map<string, AbortController>();
const EMPTY: UploadJob[] = [];

function publish() {
  // A fresh array: `useSyncExternalStore` compares by identity.
  jobs = [...jobs];
  window.dispatchEvent(new Event(EVENT));
}

function patch(key: string, change: Partial<UploadJob>) {
  jobs = jobs.map((j) => (j.key === key ? { ...j, ...change } : j));
  publish();
}

export function readUploads(): UploadJob[] {
  return jobs;
}

/** Nothing during SSR: there is no upload without a browser. */
export function serverUploads(): UploadJob[] {
  return EMPTY;
}

export function subscribeUploads(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function uploadsInFlight(): boolean {
  return jobs.some((j) => j.status === "uploading");
}

export function cancelUpload(key: string) {
  controllers.get(key)?.abort();
}

export function dismissUpload(key: string) {
  jobs = jobs.filter((j) => j.key !== key);
  publish();
}

/**
 * Start sending `files`. Resolves when every one has landed or failed — but
 * nothing about the caller has to stay mounted for that to happen, and the
 * counts are only for a summary toast; the tray already said the rest.
 */
export async function startUploads(
  files: File[],
  opts: UploadTarget & {
    /** Called per file as it lands, with the id the store gave it. */
    onDone?: (fileId: string, file: File) => void | Promise<void>;
    /** This batch's own rows, on every change — for a page that also wants
     * to draw them. The tray draws them regardless. */
    onProgress?: (batch: UploadJob[]) => void;
  } = {},
): Promise<{ uploaded: number; failed: number }> {
  const mine = new Set<string>();
  const report = () => opts.onProgress?.(jobs.filter((j) => mine.has(j.key)));
  const update = (key: string, change: Partial<UploadJob>) => {
    patch(key, change);
    report();
  };

  let uploaded = 0;
  let failed = 0;

  await Promise.all(
    files.map(async (file) => {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      controllers.set(key, controller);
      mine.add(key);
      jobs = [
        ...jobs,
        { key, name: file.name, size: file.size, pct: 0, status: "uploading", folderId: opts.folderId ?? null, startedAt: Date.now() },
      ];
      publish();
      report();

      try {
        const { id } = await uploadToStudio(
          file,
          (fraction) => update(key, { pct: fraction }),
          controller.signal,
          { folderId: opts.folderId, access: opts.access, onRow: (fileId) => update(key, { fileId }) },
        );
        update(key, { pct: 1, status: "done", fileId: id });
        uploaded++;
        setTimeout(() => dismissUpload(key), CLEAR_DONE_AFTER);
        await opts.onDone?.(id, file);
      } catch (err) {
        const cancelled = controller.signal.aborted;
        update(key, {
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? undefined : err instanceof Error ? err.message : "Upload failed",
        });
        if (cancelled) setTimeout(() => dismissUpload(key), CLEAR_DONE_AFTER);
        failed++;
      } finally {
        controllers.delete(key);
      }
    }),
  );

  return { uploaded, failed };
}
