/**
 * Putting a file in the chat box.
 *
 * Nothing new: this is the upload path the rest of the product already has —
 * `POST /api/files/presign` makes the row and signs a URL, the bytes go
 * straight to R2, `POST /api/files/[id]/complete` confirms the object arrived
 * and writes version 1. The composer was simply never wired to it, which is
 * what "the current AI you can not update file in the chat box" means.
 *
 * The bytes never pass through the app, so attaching a 2 GB master costs the
 * server nothing and is not bounded by a request-body limit.
 */

export type Attaching = {
  /** Stable while the upload runs; the file id is not known until it ends. */
  key: string;
  name: string;
  size: number;
  /** 0–1. Only the PUT is measured; it is all but the whole wait. */
  progress: number;
  /** Set when the upload finished — this is what the message carries. */
  fileId?: string;
  error?: string;
};

/** R2 takes exactly the content type that was signed into the URL. A browser
 * that offers nothing is the generic one, which is what the route defaults to
 * as well — the two must agree or the PUT is rejected as a signature mismatch. */
const typeOf = (file: File) => file.type || "application/octet-stream";

export async function uploadToStudio(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ id: string; name: string }> {
  const presigned = await fetch("/api/files/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime: typeOf(file), size: file.size }),
    signal,
  });
  if (!presigned.ok) throw new Error((await presigned.text()) || "Upload refused");

  const { fileId, upload } = (await presigned.json()) as {
    fileId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string> };
  };

  await put(upload, file, onProgress, signal);

  // Until this lands the row has no version and no poster job: an object in
  // the bucket that the studio does not yet consider a file.
  const done = await fetch(`/api/files/${fileId}/complete`, { method: "POST", signal });
  if (!done.ok) throw new Error((await done.text()) || "The upload did not arrive");

  return { id: fileId, name: file.name };
}

/**
 * `fetch` cannot report how far a request body has got, and a 2 GB upload with
 * no progress bar looks like a hung page — so the one PUT is an XHR.
 */
function put(
  upload: { url: string; method: "PUT"; headers: Record<string, string> },
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url, true);
    for (const [header, value] of Object.entries(upload.headers)) xhr.setRequestHeader(header, value);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The storage service refused the file (${xhr.status})`));
    xhr.onerror = () => reject(new Error("The upload was interrupted"));
    xhr.onabort = () => reject(new Error("The upload was cancelled"));

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** "4.2 MB" — enough to tell a clip from a thumbnail on the chip. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
