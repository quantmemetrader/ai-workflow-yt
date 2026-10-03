"use client";

import * as React from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { NameDialog } from "./NameDialog";

/**
 * `ConfirmDialog` and `NameDialog` as something a handler can await, so a
 * call site that used `window.confirm` / `window.prompt` keeps its shape:
 *
 *   const ask = useAsk(zh);
 *   if (!(await ask.confirm({ title: "删除？", danger: true }))) return;
 *   …
 *   {ask.dialog}
 *
 * Closing the box (Esc, the backdrop, 取消) answers false / null.
 */
export type ConfirmAsk = { title: string; body?: string; confirm?: string; cancel?: string; danger?: boolean };
export type PromptAsk = { title: string; placeholder?: string; initial?: string; confirm?: string; cancel?: string };

type Open =
  | { kind: "confirm"; opts: ConfirmAsk; done: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptAsk; done: (value: string | null) => void };

export function useAsk(zh = true) {
  const [open, setOpen] = React.useState<Open | null>(null);
  const confirm = React.useCallback(
    (opts: ConfirmAsk) => new Promise<boolean>((resolve) => setOpen({ kind: "confirm", opts, done: resolve })),
    [],
  );
  const prompt = React.useCallback(
    (opts: PromptAsk) => new Promise<string | null>((resolve) => setOpen({ kind: "prompt", opts, done: resolve })),
    [],
  );
  const ok = zh ? "确定" : "OK";
  const cancel = zh ? "取消" : "Cancel";
  let dialog: React.ReactNode = null;
  if (open?.kind === "confirm") {
    dialog = (
      <ConfirmDialog
        title={open.opts.title}
        body={open.opts.body}
        confirm={open.opts.confirm ?? ok}
        cancel={open.opts.cancel ?? cancel}
        danger={open.opts.danger}
        onConfirm={() => open.done(true)}
        onClose={() => {
          open.done(false);
          setOpen(null);
        }}
      />
    );
  } else if (open?.kind === "prompt") {
    dialog = (
      <NameDialog
        title={open.opts.title}
        placeholder={open.opts.placeholder ?? ""}
        initial={open.opts.initial ?? ""}
        confirm={open.opts.confirm ?? ok}
        cancel={open.opts.cancel ?? cancel}
        onSubmit={(value) => open.done(value)}
        onClose={() => {
          open.done(null);
          setOpen(null);
        }}
      />
    );
  }
  return { dialog, confirm, prompt };
}
