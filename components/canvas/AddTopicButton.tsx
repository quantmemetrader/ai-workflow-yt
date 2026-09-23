"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NameDialog } from "@/components/ui/NameDialog";
import { notify } from "@/lib/client/notify";
import { addTopicAction } from "@/app/(app)/research/actions";

/**
 * "＋ 添加选题" — putting a topic into the backlog by hand.
 *
 * The client's words: *"and for potential topics, cant find where to add"*.
 * There was in fact a way — the phrase field on the Trends dashboard — but it
 * is one 268px box on one screen out of five, it is worded as a search, and
 * what it makes is a `new` topic on the watchlist, which the Topic backlog does
 * not show. So somebody looking at 选题储备 and wanting to put a topic in it had
 * nothing to press, and the one control that existed put the topic somewhere
 * else.
 *
 * This is the button that was missing. It is small and it is deliberately in
 * two places: the module sidebar, so it is on every Research screen, and the
 * backlog's own header, so it is where the thing it fills is. Both add to the
 * backlog (`place: "backlog"`), which is what "potential topic" means here.
 *
 * It owns the server action itself rather than taking an `onAdd` prop. Every
 * caller would wire the same call to the same action, and the sidebar is
 * rendered by server components that have no callback to give it.
 */
export function AddTopicButton({
  zh,
  /** The host screen's own button classes — `.btn s`, `.n`, whatever it draws. */
  className = "btn s",
  style,
  /** A shorter label, for a toolbar with no room for the long one. */
  compact = false,
}: {
  zh: boolean;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, start] = React.useTransition();

  const t = (en: string, cn: string) => (zh ? cn : en);

  function submit(name: string) {
    start(async () => {
      const res = await addTopicAction(name, undefined, null, "backlog");
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      notify(
        "name" in res && res.name
          ? t(`“${res.name}” is in the backlog.`, `“${res.name}”已加入选题储备。`)
          : t("Added to the backlog.", "已加入选题储备。"),
        "ok",
      );
      // The sources are asked about the new phrase in the background, so the
      // card appears now and its heat fills in later.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className={className}
        /* The artboards give `.btn` its pointer inside their own scoped CSS,
           and the sidebar is drawn outside all of them, so it carries its
           own. */
        style={{ cursor: "pointer", ...style }}
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24">
          <path d="M12 5.5v13M5.5 12h13" />
        </svg>
        {busy
          ? t("Adding…", "添加中…")
          : compact
            ? t("Add", "添加")
            : t("Add a topic", "添加选题")}
      </button>
      {open ? (
        <NameDialog
          title={t("Add a topic to the backlog", "添加选题到选题储备")}
          placeholder={t("A phrase, e.g. AI video tools", "一个词或短语，例如：AI 视频工具")}
          confirm={t("Add", "添加")}
          cancel={t("Cancel", "取消")}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
