"use client";

import * as React from "react";
import { ATTACH_ACCEPT, bytes, kindOf, uploadToStudio, type Attaching } from "@/components/chat/upload";

/**
 * A file for this one question (Ryan, 1 Oct: "in all places you can send a
 * message to AI, include a button to upload files for reference, even in the
 * side bar, for short-term reference"). The file goes to the person's own
 * files, private; the AI reads it with the id the message carries and it is
 * not added to anybody's training.
 */
export function useAttachments(zh: boolean, max = 10) {
  const [attached, setAttached] = React.useState<Attaching[]>([]);
  const uploading = attached.some((a) => !a.fileId && !a.error);
  const ids = attached.filter((a) => a.fileId).map((a) => a.fileId!) as string[];
  const add = React.useCallback(
    (list: FileList | File[] | null) => {
      const files = Array.from(list ?? []).slice(0, Math.max(0, max - attached.length));
      for (const file of files) {
        const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const controller = new AbortController();
        setAttached((rest) => [...rest, { key, name: file.name, size: file.size, mime: file.type, progress: 0, cancel: () => controller.abort() }]);
        void uploadToStudio(file, (fraction) => setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, progress: fraction } : a))), controller.signal, { access: { mode: "private" } })
          .then(({ id }) => setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, fileId: id, progress: 1, cancel: undefined } : a))))
          .catch((err: unknown) => setAttached((rest) => rest.map((a) => (a.key === key ? { ...a, error: err instanceof Error ? err.message : zh ? "上传失败" : "Upload failed" } : a))));
      }
    },
    [attached.length, max, zh],
  );
  const remove = (key: string) =>
    setAttached((rest) => {
      rest.find((a) => a.key === key)?.cancel?.();
      return rest.filter((a) => a.key !== key);
    });
  const clear = () => setAttached([]);
  /** Pasting a file (a screenshot) into the box attaches it. */
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      e.preventDefault();
      add(files);
    }
  };
  return { attached, ids, uploading, add, remove, clear, onPaste };
}

export function AttachButton({ zh, onFiles, size = 26, title }: { zh: boolean; onFiles: (list: FileList | null) => void; size?: number; title?: string }) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={ATTACH_ACCEPT}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-label={zh ? "添加参考文件" : "Attach a file"}
        title={title ?? (zh ? "添加参考文件：范例、资料、截图都可以，只用于这次提问" : "Attach a reference for this question")}
        className="att-btn"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m20.5 11.5-8.2 8.2a5.3 5.3 0 0 1-7.5-7.5l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9" />
        </svg>
      </button>
      <style>{ATT_CSS}</style>
    </>
  );
}

export function AttachChips({ zh, attached, onRemove }: { zh: boolean; attached: Attaching[]; onRemove: (key: string) => void }) {
  if (!attached.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
      {attached.map((a) => {
        const kind = kindOf(a.name, a.mime);
        return (
          <span key={a.key} className="att-chip" data-error={a.error ? "" : undefined} title={a.error ?? a.name}>
            <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
              {kind === "image" ? (
                <>
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="m20.5 16-5-5-8 8.5" />
                </>
              ) : kind === "video" ? (
                <>
                  <rect x="3" y="5.5" width="13" height="13" rx="2.5" />
                  <path d="m16 10.5 5-3v9l-5-3" />
                </>
              ) : (
                <>
                  <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
                  <path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" />
                </>
              )}
            </svg>
            <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
            <span style={{ color: a.error ? "#b52a2a" : "#9a9a96", flexShrink: 0 }}>{a.error ? (zh ? "失败" : "failed") : a.fileId ? bytes(a.size) : `${Math.round(a.progress * 100)}%`}</span>
            <button type="button" onClick={() => onRemove(a.key)} aria-label={zh ? `移除 ${a.name}` : `Remove ${a.name}`} className="att-x">
              ×
            </button>
          </span>
        );
      })}
      <style>{ATT_CSS}</style>
    </div>
  );
}

const ATT_CSS = `
.att-btn { display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 7px; background: transparent; color: #7a7a76; cursor: pointer; padding: 0; flex-shrink: 0; transition: background .12s ease, color .12s ease; }
.att-btn:hover { background: #f1f1ee; color: #171717; }
.att-chip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 4px 0 7px; border-radius: 7px; border: 1px solid #e7e6e2; background: #fafaf8; font-size: 11.5px; color: #404040; max-width: 100%; }
.att-chip[data-error] { border-color: #f3c7c0; background: #fdf3f1; color: #a4331f; }
.att-x { border: 0; background: none; padding: 0 3px; cursor: pointer; color: #9a9a96; font: inherit; font-size: 14px; line-height: 1; }
.att-x:hover { color: #171717; }
`;
