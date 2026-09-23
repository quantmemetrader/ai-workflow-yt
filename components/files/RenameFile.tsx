"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NameDialog } from "@/components/ui/NameDialog";
import { renameFileAction } from "@/app/(app)/files/actions";
import { notify } from "@/lib/client/notify";
import { beginWork } from "@/lib/client/busy";

/**
 * Renaming a file from the screen that is showing it.
 *
 * The list has a pencil on every row; the file's own page did not, so the one
 * place you are certain you have the right file was the one place you could
 * not fix its name. The storage key never changes — this is the label, not the
 * object.
 */
export function RenameFile({ id, name, zh }: { id: string; name: string; zh: boolean }) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Rename", "重命名")}
        title={t("Rename", "重命名")}
        style={{
          width: 26,
          height: 26,
          border: 0,
          borderRadius: 7,
          background: "transparent",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          style={{ width: 13, height: 13, fill: "none", stroke: "#7c7c7c", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }}
        >
          <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
        </svg>
      </button>

      {open ? (
        <NameDialog
          title={t("Rename file", "重命名文件")}
          placeholder={name}
          confirm={t("Rename", "重命名")}
          cancel={t("Cancel", "取消")}
          onClose={() => setOpen(false)}
          onSubmit={(next) => {
            setOpen(false);
            const wanted = next.trim();
            if (!wanted || wanted === name) return;
            start(async () => {
              const done = beginWork(t(`Renaming ${name}`, `重命名 ${name}`));
              try {
                const res = await renameFileAction(id, wanted);
                if (res.error) notify(res.error);
                else router.refresh();
              } finally {
                done();
              }
            });
          }}
        />
      ) : null}
    </>
  );
}
