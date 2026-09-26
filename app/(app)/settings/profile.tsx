"use client";

import { useActionState, useState } from "react";
import { updateProfileAction, type ProfileState } from "./actions";
import { catalogAvatar } from "@/lib/avatars/catalog";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { AvatarSheet } from "@/components/shell/AvatarSheet";
import { Tr } from "@/components/ui/Tr";

/**
 * Your own name and face.
 *
 * Until this existed, both were whatever an operator typed into a seed script:
 * the person they belong to could not change either, and a studio where
 * everybody is a grey circle with two initials is a studio where nobody reads
 * the sender of a message.
 *
 * The picture is the 头像 row: it opens the same chooser as your face in the
 * top bar (`components/shell/AvatarSheet.tsx`) — the pictures on offer, an
 * upload for a photo of your own, and the default. An uploaded photo goes
 * straight to storage and comes back through a route that serves it to
 * colleagues in the same studio — not through Files, because a profile
 * picture is meant to be seen by everyone you work with and a file is meant to
 * be seen by whoever it was shared with.
 */
export function ProfileCard({
  zh,
  userId,
  name,
  nameLocal,
  title,
  email,
  avatarUrl,
}: {
  zh: boolean;
  userId: string;
  name: string;
  nameLocal: string | null;
  title: string | null;
  email: string;
  avatarUrl: string | null;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfileAction, {});
  const [choosing, setChoosing] = useState(false);
  const shownName = (zh && nameLocal) || name;
  const pictureKind =
    avatarUrl === null
      ? t("Your automatic picture", "自动分配的默认头像")
      : catalogAvatar(avatarUrl)
        ? t("Picked from the set", "从图库里选的")
        : avatarUrl.startsWith("/api/avatar/")
          ? t("Your uploaded photo", "你上传的照片")
          : t("Your current picture", "当前的头像");

  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-gray-9">{t("You", "个人资料")}</h2>

      {/* 头像: the picture everybody sees beside your name. */}
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-outline-gray-1 px-3 py-2.5">
        <PersonAvatar id={userId} url={avatarUrl} name={shownName} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-gray-6">
            <Tr zh="头像" inZh={zh} />
          </div>
          <div className="truncate text-[13px] text-ink-gray-9">{pictureKind}</div>
        </div>
        <button
          type="button"
          onClick={() => setChoosing(true)}
          aria-haspopup="dialog"
          className="h-8 rounded-lg border border-outline-gray-2 px-3 text-xs text-ink-gray-7 hover:bg-surface-gray-2"
        >
          {t("Change", "更换")}
        </button>
      </div>
      {choosing ? (
        <AvatarSheet userId={userId} name={shownName} avatarUrl={avatarUrl} zh={zh} onClose={() => setChoosing(false)} />
      ) : null}

      <div className="flex items-start gap-4">
        <form action={action} className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="flex min-w-[150px] flex-1 flex-col gap-1">
              <span className="text-xs text-ink-gray-6">{t("Name", "姓名")}</span>
              <input
                name="name"
                defaultValue={name}
                required
                maxLength={120}
                className="h-9 rounded-lg border border-outline-gray-2 px-3 text-sm outline-none focus:border-outline-gray-4"
              />
            </label>
            <label className="flex min-w-[150px] flex-1 flex-col gap-1">
              <span className="text-xs text-ink-gray-6">{t("Chinese name", "中文名")}</span>
              <input
                name="nameLocal"
                defaultValue={nameLocal ?? ""}
                maxLength={120}
                placeholder={t("optional", "可选")}
                className="h-9 rounded-lg border border-outline-gray-2 px-3 text-sm outline-none focus:border-outline-gray-4"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-gray-6">{t("What you do here", "职位")}</span>
            <input
              name="title"
              defaultValue={title ?? ""}
              maxLength={120}
              placeholder={t("Editor, producer, owner…", "剪辑、制片、负责人…")}
              className="h-9 rounded-lg border border-outline-gray-2 px-3 text-sm outline-none focus:border-outline-gray-4"
            />
          </label>

          <p className="text-[11px] text-ink-gray-5">
            {t(
              `Your work email is ${email}. Only an admin can change that.`,
              `你的工作邮箱是 ${email}，仅管理员可以更改。`,
            )}
          </p>

          {state.error ? (
            <p role="alert" className="text-xs text-ink-red-3">
              {state.error}
            </p>
          ) : null}
          {state.ok && !state.error ? (
            <p className="text-xs text-ink-green-3">{t("Saved.", "已保存。")}</p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="h-8 self-start rounded-lg bg-ink-gray-9 px-3 text-xs text-white disabled:opacity-50"
          >
            {pending ? t("Saving…", "保存中…") : t("Save", "保存")}
          </button>
        </form>
      </div>
    </section>
  );
}
