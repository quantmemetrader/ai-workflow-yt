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
 */
export function ShareSheet({
  objectType,
  objectId,
  ceiling,
  shares,
  locale,
}: {
  objectType: SharedObject;
  objectId: string;
  ceiling: Relation | null;
  shares: { subjectId: string; subjectType: string; relation: Relation; name: string | null; expiresAt: string | null }[];
  locale: Locale;
}) {
  const t = makeT(locale);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [relation, setRelation] = useState<Relation>("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const order: Relation[] = ["viewer", "commenter", "editor", "owner"];
  const rank = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
  const allowed = ceiling ? order.filter((r) => rank[r] <= rank[ceiling]) : [];

  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink-gray-9">{t("Share")}</h2>
      <p className="mb-3 text-xs text-ink-gray-5">
        {ceiling
          ? `${t("You can share up to")} ${t(LABEL[ceiling])}.`
          : t("You cannot share this.")}
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
              setMessage(res.error ?? `${t("Shared with")} ${res.sharedWith}`);
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
            aria-label={t("Share")}
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
        {shares.map((s) => (
          <li key={`${s.subjectId}-${s.relation}`} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate text-ink-gray-7">
              {s.subjectType === "tenant" ? t("Shared with the studio") : s.name ?? s.subjectId}
              {s.expiresAt && (
                <span className="ml-1 text-ink-gray-4">
                  · {t("until")} {new Date(s.expiresAt).toISOString().slice(0, 10)}
                </span>
              )}
            </span>
            <span className="text-ink-gray-5">{t(LABEL[s.relation])}</span>
            {ceiling && rank[ceiling] >= 2 && s.subjectType === "user" && (
              <button
                onClick={() =>
                  start(async () => {
                    await revokeAction(objectType, objectId, s.subjectId, s.relation);
                    router.refresh();
                  })
                }
                className="text-ink-gray-4 hover:text-ink-red-3"
                aria-label={`${t("Remove")} — ${s.name ?? s.subjectId}`}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
