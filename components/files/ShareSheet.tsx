"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makeT, type Locale } from "@/lib/i18n";
import { revokeAction, shareAction } from "@/app/(app)/files/actions";
import type { Relation } from "@/lib/db/schema";
import type { SharedObject } from "@/lib/authz/rebac";

const LABEL: Record<Relation, string> = {
  owner: "Owner",
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
};

/**
 * Sharing, with the ceiling stated *before* anyone tries (brief §Database).
 * The select only offers relations this person actually holds, and the server
 * refuses anything higher regardless of what the form sends.
 *
 * (QA, 2 Oct: people shared as viewers are listed too, so they can be removed;
 * the owner's row has no remove button; the hint reads as a sentence.)
 */
export function ShareSheet({
  objectType,
  objectId,
  ceiling,
  shares,
  locale,
  ownerId,
}: {
  objectType: SharedObject;
  objectId: string;
  ceiling: Relation | null;
  shares: { subjectId: string; subjectType: string; relation: Relation; name: string | null; expiresAt: string | null }[];
  locale: Locale;
  /** The object's own owner: their row can never be removed. */
  ownerId?: string | null;
}) {
  const t = makeT(locale);
  const zh = (locale ?? "zh-CN").startsWith("zh");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [relation, setRelation] = useState<Relation>("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const order: Relation[] = ["viewer", "commenter", "editor", "owner"];
  const rank = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
  const allowed = ceiling ? order.filter((r) => rank[r] <= rank[ceiling]) : [];
  /* Strongest first, so the owner leads the list. */
  const rows = [...shares].sort((a, b) => rank[b.relation] - rank[a.relation]);
  const owners = rows.filter((s) => s.relation === "owner").length;
  const removable = (s: (typeof shares)[number]) =>
    Boolean(ceiling) &&
    rank[ceiling!] >= 2 &&
    rank[ceiling!] >= rank[s.relation] &&
    s.subjectType === "user" &&
    !(s.relation === "owner" && (s.subjectId === ownerId || owners <= 1));

  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink-gray-9">{t("Share")}</h2>
      <p className="mb-3 text-xs text-ink-gray-5">
        {ceiling
          ? zh
            ? `你可以把它共享给同事，权限最高到「${t(LABEL[ceiling])}」。`
            : `You can share this with colleagues, up to ${LABEL[ceiling].toLowerCase()}.`
          : zh
            ? "你没有共享它的权限。"
            : "You cannot share this."}
      </p>

      {allowed.length > 0 && (
        <form
          /* Wrapping, and an input that may shrink.
             `flex-1` alone does not: a flex item's default `min-width: auto`
             refuses to go below its content, so on a narrow panel the email
             box held its width, pushed the role picker and the button past the
             edge, and gave the whole page a horizontal scrollbar. */
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await shareAction(objectType, objectId, email, relation);
              setMessage(res.error ?? (zh ? `已共享给 ${res.sharedWith}` : `Shared with ${res.sharedWith}`));
              if (!res.error) setEmail("");
              router.refresh();
            });
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label={t("Work email")}
            placeholder="name@tengya.media"
            className="h-8 min-w-0 flex-1 basis-40 rounded-lg border border-outline-gray-2 px-2.5 text-sm outline-none focus:border-outline-gray-4"
          />
          <select
            value={relation}
            aria-label={zh ? "权限" : "Access"}
            onChange={(e) => setRelation(e.target.value as Relation)}
            className="h-8 shrink-0 rounded-lg border border-outline-gray-2 px-2 text-sm text-ink-gray-8"
          >
            {allowed.map((r) => (
              <option key={r} value={r}>
                {t(LABEL[r])}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="h-8 shrink-0 rounded-lg bg-surface-gray-7 px-3 text-xs font-medium text-white disabled:opacity-50"
          >
            {t("Share")}
          </button>
        </form>
      )}

      {message && <p className="mb-3 text-xs text-ink-gray-6">{message}</p>}

      <ul className="flex flex-col gap-1.5">
        {rows.map((s) => (
          <li key={`${s.subjectId}-${s.relation}`} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate text-ink-gray-7">
              {s.subjectType === "tenant" ? t("Shared with the studio") : s.name ?? s.subjectId}
              {s.expiresAt && (
                <span className="ml-1 text-ink-gray-4">
                  · {t("until")}{" "}
                  {new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date(s.expiresAt))}
                </span>
              )}
            </span>
            <span className="text-ink-gray-5">{t(LABEL[s.relation])}</span>
            {removable(s) ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await revokeAction(objectType, objectId, s.subjectId, s.relation);
                    /* The old "已共享给 …" line must not outlive the share it described. */
                    setMessage(res?.error ?? null);
                    router.refresh();
                  })
                }
                className="text-ink-gray-4 hover:text-ink-red-3"
                aria-label={zh ? `移除 ${s.name ?? ""}` : `Remove ${s.name ?? s.subjectId}`}
                title={zh ? "移除" : "Remove"}
              >
                ×
              </button>
            ) : (
              /* Keeps the relation column aligned with the removable rows. */
              <span aria-hidden style={{ width: 7 }} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
