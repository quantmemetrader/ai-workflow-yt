"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AVATARS, AVATAR_STYLES, catalogAvatar } from "@/lib/avatars/catalog";
import { defaultAvatarFor } from "@/lib/avatars/default";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { setAvatarAction } from "@/app/(app)/settings/actions";

/* What `POST /api/avatar` takes (app/api/avatar/route.ts), checked here too so
   a wrong file gets a sentence in the person's language before any upload. */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type Note = { tone: "ok" | "err"; text: string };

/**
 * Choosing your own picture: the one you have now, every picture on offer
 * grouped by style, "上传照片" for a photo of your own, and "用默认" to go back
 * to the automatic one.
 *
 * Opened from your face in the top bar and from the 头像 row in Settings.
 * A press saves at once — there is nothing to confirm about a picture, and a
 * second press on another one simply replaces it. A catalog pick or the
 * default goes through `setAvatarAction`, which checks the choice against the
 * catalog and only ever changes the signed-in person; a photo goes through the
 * existing upload route. Either way the page is refreshed, so the top bar, the
 * chat and Home show the new face without a reload.
 */
export function AvatarSheet({
  userId,
  name,
  avatarUrl,
  zh,
  onClose,
}: {
  userId: string;
  /** The name as colleagues see it: the alt text, and the line beside the picture. */
  name: string;
  /** `users.avatar_url` right now; null means the default. */
  avatarUrl: string | null;
  zh: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const t = (cn: string, en: string) => (zh ? cn : en);
  /* The sheet's own copy, so a pick shows at once; the refresh brings the
     rest of the page along behind it. */
  const [current, setCurrent] = React.useState<string | null>(avatarUrl);
  /** What is being saved: a catalog path, "upload" or "default". */
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<Note | null>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);

  /* Escape closes from anywhere, and focus starts inside the dialog so the
     keyboard is where the eyes are. The latest `onClose` is read through a
     ref: a parent re-render hands in a new function, and re-running this
     effect for it would pull focus back to the panel mid-use. */
  const closeRef = React.useRef(onClose);
  React.useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  React.useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saved = () =>
    setNote({ tone: "ok", text: t("已保存。同事们刷新页面后就会看到。", "Saved. Colleagues see it the next time their page refreshes.") });

  function choose(path: string | null) {
    if (busy) return;
    setBusy(path ?? "default");
    setNote(null);
    setAvatarAction(path)
      .then((res) => {
        if ("error" in res && res.error) {
          setNote({ tone: "err", text: res.error });
          return;
        }
        setCurrent(path);
        saved();
        router.refresh();
      })
      .catch(() => setNote({ tone: "err", text: t("没能保存，请再试一次。", "That did not save. Try again.") }))
      .finally(() => setBusy(null));
  }

  async function upload(file: File) {
    if (!TYPES.includes(file.type)) {
      setNote({ tone: "err", text: t("只能用 JPG、PNG、WebP 或 GIF 图片。", "A JPG, PNG, WebP or GIF, please.") });
      return;
    }
    if (file.size > MAX_BYTES) {
      setNote({ tone: "err", text: t("照片需要小于 5MB。", "A photo has to be under 5MB.") });
      return;
    }
    setBusy("upload");
    setNote(null);
    try {
      const res = await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error((await res.text()) || String(res.status));
      const { avatarUrl: next } = (await res.json()) as { avatarUrl: string };
      setCurrent(next);
      saved();
      router.refresh();
    } catch (err) {
      setNote({
        tone: "err",
        text: zh ? "照片没能上传，请再试一次。" : err instanceof Error && err.message ? err.message : "That photo would not upload.",
      });
    } finally {
      setBusy(null);
    }
  }

  const kind =
    current === null ? "default" : catalogAvatar(current) ? "catalog" : current.startsWith("/api/avatar/") ? "photo" : "other";
  const kindLabel = {
    default: t("自动分配的默认头像", "Your automatic picture"),
    catalog: t("从图库里选的", "Picked from the set"),
    photo: t("你上传的照片", "Your uploaded photo"),
    other: t("当前的头像", "Your current picture"),
  }[kind];

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        background: "rgba(23,23,23,0.18)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "9vh",
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-sheet-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 94vw)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22)",
          overflow: "hidden",
          outline: "none",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 18px 12px", borderBottom: "1px solid #f3f3f3" }}>
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <div id="avatar-sheet-title" style={{ fontSize: 14.5, fontWeight: 600, color: "#171717" }}>
              <Tr zh="头像" inZh={zh} />
            </div>
            <div style={{ fontSize: 11.5, color: "#999999", marginTop: 3 }}>
              {t("选一张，或上传你自己的照片。工作室里的同事都会看到。", "Pick one, or upload a photo of your own. Everyone in the studio sees it.")}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("关闭", "Close")} title={t("关闭", "Close")} style={iconButton}>
            <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round" }}>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* What you have now, and the two ways out of the grid. */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14, padding: "14px 18px", borderBottom: "1px solid #f3f3f3" }}>
          <PersonAvatar id={userId} url={current} name={name} size={60} style={{ boxShadow: "0 0 0 1px #ededed" }} />
          <div style={{ minWidth: 0, flex: "1 1 140px" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
            <div style={{ fontSize: 11.5, color: "#7c7c7c", marginTop: 2 }}>{kindLabel}</div>
            {/* Said before it happens: a photo is deleted, not kept on the
                side, when another picture replaces it (`setAvatarAction`). */}
            {kind === "photo" ? (
              <div style={{ fontSize: 11, color: "#a3a3a3", marginTop: 2 }}>
                {t("换成别的头像或默认头像时，这张照片会被删除。", "Picking another picture, or the default, deletes this photo.")}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => picker.current?.click()} disabled={busy !== null} style={{ ...solid, opacity: busy === "upload" ? 0.6 : 1 }}>
              <Icon name="upload" size={13} />
              {busy === "upload" ? t("上传中…", "Uploading…") : <Tr zh="上传照片" inZh={zh} />}
            </button>
            {/* The default's own face on the button, so "用默认" is not a
                leap in the dark. Decorative (empty alt): the words say it. */}
            <button
              type="button"
              onClick={() => choose(null)}
              disabled={busy !== null || current === null}
              aria-pressed={current === null}
              title={current === null ? t("正在使用默认头像", "Already on the default") : undefined}
              style={{ ...ghost, opacity: busy === "default" ? 0.6 : current === null ? 0.55 : 1 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={defaultAvatarFor(userId)} alt="" width={18} height={18} style={{ width: 18, height: 18, borderRadius: 9, display: "block" }} />
              <Tr zh="用默认" inZh={zh} />
            </button>
          </div>
          <input
            ref={picker}
            type="file"
            accept={TYPES.join(",")}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </div>

        {note ? (
          <p
            role={note.tone === "err" ? "alert" : "status"}
            style={{ margin: 0, padding: "8px 18px", fontSize: 12, color: note.tone === "err" ? "#cc2929" : "#278f5e", background: note.tone === "err" ? "#fff7f7" : "#f2fdf4" }}
          >
            {note.text}
          </p>
        ) : null}

        <div style={{ overflowY: "auto", minHeight: 0, padding: "4px 18px 16px" }}>
          {AVATAR_STYLES.map((style) => (
            <section key={style.key} style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 9 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#525252" }}>
                  <Tr zh={style.zh} en={style.en} inZh={zh} />
                </span>
                <span style={{ fontSize: 11, color: "#b3b3b3" }}>{zh ? style.licenceZh : style.licence.name}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(54px, 1fr))", gap: 10 }}>
                {AVATARS.filter((a) => a.style === style.key).map((a, i) => {
                  const on = current === a.path;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => choose(a.path)}
                      disabled={busy !== null || on}
                      aria-pressed={on}
                      style={{
                        position: "relative",
                        padding: 3,
                        border: 0,
                        borderRadius: "50%",
                        background: "transparent",
                        boxShadow: on ? "0 0 0 2px #171717" : "0 0 0 1px #ededed",
                        cursor: on ? "default" : busy ? "progress" : "pointer",
                        opacity: busy === a.path ? 0.5 : 1,
                        transition: "box-shadow .12s ease, transform .12s ease",
                        aspectRatio: "1",
                      }}
                      onMouseEnter={(e) => {
                        if (!on) e.currentTarget.style.boxShadow = "0 0 0 1px #b5b5b5";
                      }}
                      onMouseLeave={(e) => {
                        if (!on) e.currentTarget.style.boxShadow = "0 0 0 1px #ededed";
                      }}
                    >
                      {/* The button's name comes from this alt text. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.path}
                        alt={t(`${style.zh}头像 ${i + 1}`, `${style.en} picture ${i + 1}`)}
                        width={54}
                        height={54}
                        loading="lazy"
                        draggable={false}
                        style={{ width: "100%", height: "100%", borderRadius: "50%", display: "block", objectFit: "cover" }}
                      />
                      {on ? (
                        <span
                          aria-hidden
                          style={{
                            position: "absolute",
                            right: -2,
                            bottom: -2,
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            background: "#171717",
                            border: "2px solid #fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon name="check" size={10} color="#ffffff" strokeWidth={2.6} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "11px 18px 13px", borderTop: "1px solid #f3f3f3" }}>
          <span style={{ fontSize: 11, lineHeight: 1.5, color: "#a3a3a3", flexGrow: 1, minWidth: 0 }}>
            {t("插画和线描头像来自 DiceBear，CC0 授权。", "Sketch and line-art pictures from DiceBear, CC0.")}{" "}
            <a href="/avatars/LICENSES.md" target="_blank" rel="noreferrer" style={{ color: "#7c7c7c" }}>
              {t("来源", "Credits")}
            </a>
          </span>
          <button type="button" onClick={onClose} style={ghost}>
            <Tr zh="完成" inZh={zh} />
          </button>
        </div>
      </div>
    </div>
  );
}

const iconButton: React.CSSProperties = {
  width: 28,
  height: 28,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: 0,
  borderRadius: 7,
  background: "transparent",
  color: "#7c7c7c",
  cursor: "pointer",
};

const solid: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 13px",
  borderRadius: 8,
  border: "1px solid #171717",
  background: "#171717",
  color: "#fff",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghost: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
