/**
 * Putting a file in the chat box.
 *
 * The small path is the one the rest of the product already has —
 * `POST /api/files/presign` makes the row and signs a URL, the bytes go
 * straight to R2, `POST /api/files/[id]/complete` confirms the object arrived
 * and writes version 1.
 *
 * The big path exists because that is not enough for a master. One PUT of
 * 590 MB from Hong Kong is a single request that has to survive the entire
 * transfer: nothing is retried, nothing is resumed, and the presigned URL
 * expires while the bytes are still moving. The studio reported exactly that —
 * "took an eternity and failed". Above the threshold below, the file is cut
 * into parts and each part is its own PUT, signed just before it is sent and
 * sent again if it fails. Four are in flight at a time, which is also what
 * turns a long-haul link's latency from a tax on every byte into a tax paid
 * four times over in parallel.
 *
 * Either way the bytes never pass through the app, so attaching a 2 GB master
 * costs the server nothing and is not bounded by a request-body limit.
 */

export type Attaching = {
  /** Stable while the upload runs; the file id is not known until it ends. */
  key: string;
  name: string;
  size: number;
  /** 0–1. The bytes are what is measured; they are all but the whole wait. */
  progress: number;
  /** Set when the upload finished — this is what the message carries. */
  fileId?: string;
  error?: string;
};

/**
 * Below this a single PUT is fine, and simpler: one request, no bookkeeping,
 * no upload to abandon if the tab closes. 64 MB is roughly the point where a
 * transfer on a bad link starts taking long enough that losing it matters —
 * a couple of minutes from Hong Kong — and it is comfortably above every
 * screenshot, document and voice-over the chat box actually sees.
 */
const MULTIPART_FLOOR = 64 * 1024 * 1024;

/** Four parts at once. Enough to fill a long-haul link, which one request
 * never does; not so many that a phone's uplink is fighting itself. */
const IN_FLIGHT = 4;

/** One try and three retries. Past that it is not a blip. */
const ATTEMPTS = 4;

/** R2 takes exactly the content type that was signed into the URL. A browser
 * that offers nothing is the generic one, which is what the route defaults to
 * as well — the two must agree or the PUT is rejected as a signature mismatch. */
const typeOf = (file: File) => file.type || "application/octet-stream";

export async function uploadToStudio(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ id: string; name: string }> {
  return file.size > MULTIPART_FLOOR
    ? inParts(file, onProgress, signal)
    : allAtOnce(file, onProgress, signal);
}

/* ---------- one PUT ---------- */

async function allAtOnce(
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

/* ---------- many PUTs ---------- */

async function inParts(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ id: string; name: string }> {
  const started = await fetch("/api/files/multipart/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime: typeOf(file), size: file.size }),
    signal,
  });
  if (!started.ok) throw new Error((await started.text()) || "Upload refused");

  // The server chooses the part size: R2 requires every part but the last to
  // be the same length, so this is not something the two ends can each decide.
  const { fileId, uploadId, partSize } = (await started.json()) as {
    fileId: string;
    uploadId: string;
    partSize: number;
  };
  const count = Math.ceil(file.size / partSize);

  /* Progress is the sum of what each part has sent, not how many parts have
     finished: at 16 MB a part the latter is a bar that stands still for a
     minute and then jumps. A part being retried resets its own contribution, so the
     bar can go backwards — which is honest, and better than a bar that claims
     bytes that have to be sent again. */
  const sent = new Array<number>(count).fill(0);
  const etags = new Array<string>(count).fill("");
  const report = () => {
    const total = sent.reduce((a, b) => a + b, 0);
    // Held short of 1 until the parts have actually been assembled, which is
    // a request of its own and not instant on a big file.
    onProgress(Math.min(0.99, file.size > 0 ? total / file.size : 0));
  };

  const live = new Set<XMLHttpRequest>();
  /* Set once and never cleared: the first thing to go wrong — a cancel, or a
     part that ran out of retries — stops the other three workers rather than
     letting them spend another 96 MB on an upload that is already lost. */
  let stopped: Error | null = null;
  const halt = (reason: Error) => {
    stopped ??= reason;
    for (const xhr of live) xhr.abort();
  };
  const onAbort = () => halt(new Error("The upload was cancelled"));
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  const onePart = async (index: number): Promise<string> => {
    const from = index * partSize;
    const blob = file.slice(from, Math.min(from + partSize, file.size));
    let last: unknown;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (stopped) throw stopped;
      // 1s, 2s, 4s, jittered so four workers that all met the same hiccup do
      // not all come back at the same instant.
      if (attempt > 0) await pause(500 * 2 ** attempt * (1 + Math.random()));
      if (stopped) throw stopped;

      sent[index] = 0;
      report();
      try {
        /* Signed on every attempt rather than once up front. This is the
           whole point: a signature only ever has to outlive the one part it
           is for, so a link slow enough to spend an hour on the file never
           meets an expired URL — which is what killed the 590 MB upload. */
        const url = await signPart(fileId, uploadId, index + 1, signal);
        const etag = await putPart(url, blob, live, (loaded) => {
          sent[index] = loaded;
          report();
        });
        sent[index] = blob.size;
        report();
        return etag;
      } catch (err) {
        last = err;
        if (stopped) throw stopped;
      }
    }
    throw last instanceof Error ? last : new Error("A part of the upload could not be sent");
  };

  /* Four workers off one counter, rather than four fixed slices: a part that
     took three tries does not hold up the parts behind it. A worker that gives
     up halts the rest instead of rejecting, so nothing is left unhandled while
     the others wind down. */
  let next = 0;
  const worker = async () => {
    while (!stopped) {
      const index = next++;
      if (index >= count) return;
      try {
        etags[index] = await onePart(index);
      } catch (err) {
        halt(err instanceof Error ? err : new Error("The upload failed"));
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, count) }, worker));
    if (stopped) throw stopped;

    /* Deliberately not given the caller's signal. Every byte is already in
       the bucket by now; abandoning the one cheap request that turns them
       into a file would throw all of it away for nothing. */
    const done = await fetch("/api/files/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId,
        uploadId,
        parts: etags.map((etag, i) => ({ partNumber: i + 1, etag })),
      }),
    });
    if (!done.ok) throw new Error((await done.text()) || "The upload did not arrive");

    onProgress(1);
    return { id: fileId, name: file.name };
  } catch (err) {
    halt(err instanceof Error ? err : new Error("The upload failed"));
    /* Parts already in the bucket are billed until the upload is abandoned,
       and nothing else will ever clean them up — there is no object at the key
       to notice. Best effort: if this request is the thing that failed there
       is nothing more to be done from here. */
    await fetch("/api/files/multipart/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, uploadId }),
      keepalive: true,
    }).catch(() => {});
    throw stopped ?? err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

async function signPart(
  fileId: string,
  uploadId: string,
  partNumber: number,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/files/multipart/sign-part", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, uploadId, partNumber }),
    signal,
  });
  if (!res.ok) throw new Error((await res.text()) || "The upload could not be signed");
  return ((await res.json()) as { url: string }).url;
}

/** One part, by XHR — again because only XHR says how far a request body has
 * got, and with parts that is four progress streams rather than one. */
function putPart(
  url: string,
  blob: Blob,
  live: Set<XMLHttpRequest>,
  onSent: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    live.add(xhr);
    const settle = (fn: () => void) => {
      live.delete(xhr);
      fn();
    };

    xhr.open("PUT", url, true);
    // No content type: the part is a range of bytes, not a document, and none
    // was signed into the URL. A `Blob` from `slice` has no type, so the
    // browser sends none either, and the PUT stays a simple cross-origin
    // request with no preflight.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onSent(e.loaded);
    };
    xhr.onload = () =>
      settle(() => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`The storage service refused a part (${xhr.status})`));
          return;
        }
        const etag = xhr.getResponseHeader("ETag");
        /* Completing the upload means naming every part by its tag, so the
           bucket must expose `ETag` to scripts (`ExposeHeader` in the CORS
           rules — see `scripts/setup-r2.ts`). Without it the part is in the
           bucket and unusable, which is worth saying plainly rather than
           failing later with a malformed part list. */
        if (!etag) {
          reject(new Error("The storage service did not return a part tag"));
          return;
        }
        resolve(etag.replaceAll('"', ""));
      });
    xhr.onerror = () => settle(() => reject(new Error("A part of the upload was interrupted")));
    xhr.ontimeout = () => settle(() => reject(new Error("A part of the upload timed out")));
    xhr.onabort = () => settle(() => reject(new Error("The upload was cancelled")));

    xhr.send(blob);
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
