"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfileAction, type ProfileState } from "./actions";

/**
 * Your own name and face.
 *
 * Until this existed, both were whatever an operator typed into a seed script:
 * the person they belong to could not change either, and a studio where
 * everybody is a grey circle with two initials is a studio where nobody reads
 * the sender of a message.
 *
 * The picture goes straight to storage and comes back through a route that
 * serves it to colleagues in the same studio — not through Files, because a
 * profile picture is meant to be seen by everyone you work with and a file is
 * meant to be seen by whoever it was shared with.
 */
export function ProfileCard({
  zh,
  name,
  nameLocal,
  title,
  email,
  avatarUrl,
}: {
  zh: boolean;
  name: string;
  nameLocal: string | null;
  title: string | null;
  email: string;
  avatarUrl: string | null;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfileAction, {});
  const picker = useRef<HTMLInputElement | null>(null);
  const [uploading, startUpload] = useTransition();
  const [picture, setPicture] = useState(avatarUrl);
  const [problem, setProblem] = useState<string | null>(null);

  function upload(file: File) {
    setProblem(null);
    startUpload(async () => {
      try {
        const res = await fetch("/api/avatar", {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error(await res.text());
        const { avatarUrl: next } = (await res.json()) as { avatarUrl: string };
        setPicture(next);
        router.refresh();
      } catch (err) {
        setProblem(err instanceof Error ? err.message : "That picture would not upload");
      }
    });
  }

  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-gray-9">{t("You", "个人资料")}</h2>

      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picture} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-gray-3 text-base text-ink-gray-7">
              {name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <button
            type="button"
            disabled={uploading}
            onClick={() => picker.current?.click()}
            className="text-[11px] text-ink-gray-6 underline-offset-2 hover:underline disabled:opacity-50"
          >
            {uploading ? t("Uploading…", "上传中…") : picture ? t("Change", "更换") : t("Add a photo", "上传照片")}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </div>

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

          {state.error || problem ? (
            <p role="alert" className="text-xs text-ink-red-3">
              {state.error ?? problem}
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
