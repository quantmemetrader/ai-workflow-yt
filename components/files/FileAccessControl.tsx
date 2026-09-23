"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AccessPicker, EyeOffGlyph, GlobeGlyph, PeopleGlyph, PersonGlyph, visibilityLabel, type AccessChoice } from "@/components/files/AccessPicker";
import { setFileAccessAction } from "@/app/(app)/files/actions";
import { notify } from "@/lib/client/notify";

/** "Who can see this" on a file's own page, above the per-person Share box. */
export function FileAccessControl({
  fileId,
  fileName,
  visibility,
  groups,
  userIds,
  canChange,
  zh,
}: {
  fileId: string;
  fileName: string;
  visibility: "private" | "everyone" | "groups" | "people";
  groups: string[];
  userIds: string[];
  canChange: boolean;
  zh: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const initial: AccessChoice =
    visibility === "everyone"
      ? { mode: "everyone" }
      : visibility === "groups"
        ? { mode: "groups", groups }
        : visibility === "people"
          ? { mode: "people", userIds }
          : { mode: "private" };
  const glyph =
    visibility === "private" ? <EyeOffGlyph /> : visibility === "everyone" ? <GlobeGlyph /> : visibility === "people" ? <PersonGlyph /> : <PeopleGlyph />;

  return (
    <section style={{ border: "1px solid #ededed", borderRadius: 10, background: "#fff", padding: "10px 12px" }}>
      <div className="lbl" style={{ padding: 0, marginBottom: 8 }}>{zh ? "谁可以看" : "Who can see this"}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ color: "#525252", display: "inline-flex" }}>{glyph}</span>
        <span style={{ flex: 1 }}>{visibilityLabel(visibility, groups, zh, userIds.length)}</span>
        {canChange && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setOpen(true)}
            style={{ height: 26, padding: "0 10px", borderRadius: 7, border: "1px solid #e2e2e2", background: "#fff", font: "inherit", fontSize: 12, cursor: "pointer" }}
          >
            {zh ? "更改" : "Change"}
          </button>
        )}
      </div>
      {open && (
        <AccessPicker
          zh={zh}
          title={zh ? `谁可以看“${fileName}”？` : `Who can see “${fileName}”?`}
          confirm={zh ? "保存" : "Save"}
          initial={initial}
          onClose={() => setOpen(false)}
          onConfirm={(choice) => {
            setOpen(false);
            start(async () => {
              const res = await setFileAccessAction([fileId], choice);
              if (res.error) notify(res.error);
              else notify(zh ? "已更新访问权限" : "Access updated", "ok");
              router.refresh();
            });
          }}
        />
      )}
    </section>
  );
}
