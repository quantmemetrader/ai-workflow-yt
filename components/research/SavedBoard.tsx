"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PageBody, Card, Empty, smallButton, INK, MUTED } from "@/components/projects/kit";
import { CompetitorPanel } from "@/components/research/CompetitorPanel";
import { DiscoverChannels } from "@/components/research/DiscoverChannels";
import { CreatorMemory } from "@/components/research/CreatorMemory";
import { addTopicAction, decideAction } from "@/app/(app)/research/actions";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import type { CompetitorRow } from "@/lib/social/service";
import type { CreatorMemoryState } from "@/lib/creator/service";

/**
 * 选题 · 我的储备 — topics kept for later, and words being watched.
 *
 *   存下来的选题   each one press from a project (or opens the one already made)
 *   关注的词       words the researcher follows on the platforms, with their
 *                 heat and whether it is rising; one box to follow a new word
 *   更多           the rival accounts, finding new ones, and the creator's own
 *                 channel memory — the power tools, folded away
 *
 * The kanban with owners, channels and due dates is one link away for the
 * person who plans the week (`?board=1`).
 */
export type SavedTopic = { id: string; name: string; summary: string | null; heat: number; change: number; projectId: string | null; scriptId: string | null };
export type WatchedTopic = { id: string; name: string; heat: number; change: number; rising: boolean; collecting: boolean; projectId?: string | null };

function pct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0%";
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}

export function SavedBoard({
  zh,
  saved,
  watched,
  canWrite,
  competitors,
  ourMedian,
  ourPosts = null,
  tikhubConfigured,
  creator,
  creatorSyncing,
  canAdmin,
}: {
  zh: boolean;
  saved: SavedTopic[];
  watched: WatchedTopic[];
  canWrite: boolean;
  competitors: CompetitorRow[];
  ourMedian: number | null;
  ourPosts?: number | null;
  tikhubConfigured: boolean;
  creator: CreatorMemoryState;
  creatorSyncing: boolean;
  canAdmin: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [word, setWord] = React.useState("");
  const [more, setMore] = React.useState(false);
  const [, start] = React.useTransition();

  async function make(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      const res = await startFromTopicAction({ kind: "topic", id }, { write: canWrite });
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      if ("projectId" in res && res.projectId) router.push(res.writing ? `/projects/${res.projectId}/script` : `/projects/${res.projectId}`);
    } finally {
      setBusy(null);
    }
  }

  const decide = (id: string, action: "reject" | "save", ok: string) =>
    start(async () => {
      const res = await decideAction(id, action);
      if (res.error) notify(res.error);
      else notify(ok, "ok");
      router.refresh();
    });

  const follow = () => {
    const v = word.trim();
    if (!v) return;
    start(async () => {
      const res = await addTopicAction(v.slice(0, 80));
      if (res.error) {
        notify(res.error);
        return;
      }
      setWord("");
      notify(t(`开始关注「${v}」，大约一分钟后有数据。`, `Following “${v}”; numbers in about a minute.`), "ok");
      router.refresh();
    });
  };

  const collecting = watched.some((w) => w.collecting);
  React.useEffect(() => {
    if (!collecting) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > 4 * 60_000) clearInterval(id);
      else router.refresh();
    }, 8000);
    return () => clearInterval(id);
  }, [collecting, router]);

  return (
    <PageBody width={1040}>
      <Card icon="folder" title={t("存下来的选题", "Saved topics")} sub={t("想以后拍的，都在这里", "Topics kept for later")} right={<Link href="/research/backlog?board=1" prefetch={false} style={{ fontSize: 12.5, color: MUTED, textDecoration: "none" }}>{t("排期看板 →", "Planning board →")}</Link>}>
        {saved.length === 0 ? (
          <Empty icon="folder" text={t("还没有存下来的选题。在「推荐」或「热点榜」里看到好的，就可以存起来。", "Nothing saved yet. Keep good ones from Picks or Hot now.")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {saved.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? "1px solid #f0efeb" : 0 }}>
                <div style={{ minWidth: 0, flexGrow: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  {s.summary ? <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.summary}</div> : null}
                </div>
                {s.projectId ? (
                  <>
                    <Link href={`/projects/${s.projectId}`} prefetch={false} style={smallButton()}>
                      {t("打开项目 →", "Open project →")}
                    </Link>
                    <button type="button" onClick={() => decide(s.id, "reject", t("已移出储备，项目还在", "Removed; the project stays"))} className="sb-quiet" title={t("只从储备里拿掉，项目不受影响", "Only takes it off this list")}>
                      {t("移出", "Remove")}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => void make(s.id)} disabled={busy !== null} style={smallButton(true)}>
                      <Icon name="film" size={13} /> {busy === s.id ? t("正在开始…", "Starting…") : t("做成视频", "Make it")}
                    </button>
                    <button type="button" onClick={() => decide(s.id, "reject", t("已移出储备", "Removed"))} className="sb-quiet">
                      {t("移出", "Remove")}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card icon="eye" title={t("关注的词", "Words we follow")} sub={t("研究员会一直看这些词在各平台热不热", "The researcher keeps watching how hot these are")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            follow();
          }}
          style={{ display: "flex", gap: 8, marginBottom: 10 }}
        >
          <input value={word} onChange={(e) => setWord(e.target.value)} placeholder={t("加一个想关注的词，比如：RWA", "Add a word to follow, e.g. RWA")} style={{ flexGrow: 1, minWidth: 0, height: 36, padding: "0 12px", border: "1px solid #d6d5d0", borderRadius: 9, fontSize: 13.5, fontFamily: "inherit", outline: "none" }} />
          <button type="submit" disabled={!word.trim()} style={{ ...smallButton(true), height: 36, opacity: word.trim() ? 1 : 0.5 }}>
            <Icon name="plus" size={13} /> {t("关注", "Follow")}
          </button>
        </form>
        {watched.length === 0 ? (
          <Empty icon="eye" text={t("还没有关注的词。", "Not following any words yet.")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {watched.map((w, i) => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? "1px solid #f0efeb" : 0 }}>
                <span style={{ minWidth: 0, flexGrow: 1, fontSize: 14, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
                <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {w.collecting ? t("正在收集…", "Collecting…") : (
                    <>
                      {t("热度", "heat")} {Math.round(w.heat)} ·{" "}
                      <span style={{ color: Math.round(w.change) > 0 ? "#1e7a4f" : Math.round(w.change) < 0 ? "#b42318" : MUTED }}>{t("两周", "2 wks")} {pct(w.change)}</span>
                    </>
                  )}
                </span>
                {w.projectId ? (
                  <Link href={`/projects/${w.projectId}`} prefetch={false} style={smallButton()}>
                    {t("打开项目 →", "Open project →")}
                  </Link>
                ) : (
                  <button type="button" onClick={() => void make(w.id)} disabled={busy !== null} style={smallButton()}>
                    <Icon name="film" size={13} /> {busy === w.id ? t("正在开始…", "Starting…") : t("做成视频", "Make it")}
                  </button>
                )}
                <button type="button" onClick={() => decide(w.id, "save", t("已存进储备", "Saved"))} className="sb-quiet">
                  {t("存起来", "Save")}
                </button>
                <button type="button" onClick={() => decide(w.id, "reject", t("不再关注", "Unfollowed"))} className="sb-quiet">
                  {t("不再关注", "Unfollow")}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} style={{ alignSelf: "flex-start", border: 0, background: "none", padding: "4px 2px", font: "inherit", fontSize: 13.5, color: "#525252", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden style={{ transform: more ? "rotate(90deg)" : "none", transition: "transform .15s ease", stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <path d="M9.5 6.5 15 12l-5.5 5.5" />
        </svg>
        {t("更多：对标账号、我们自己的频道", "More: rival accounts, our own channel")}
      </button>
      {more ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CompetitorPanel competitors={competitors} ourMedian={ourMedian} ourPosts={ourPosts} configured={tikhubConfigured} zh={zh} />
          <DiscoverChannels zh={zh} watching={competitors.map((c) => c.externalId)} suggestion={watched[0]?.name ?? null} />
          <CreatorMemory state={creator} syncing={creatorSyncing} zh={zh} canAdmin={canAdmin} />
        </div>
      ) : null}
      <style>{`.sb-quiet{border:0;background:none;padding:0 4px;font:inherit;font-size:12.5px;color:#8a8a8a;cursor:pointer;white-space:nowrap}.sb-quiet:hover{color:#171717}`}</style>
    </PageBody>
  );
}
