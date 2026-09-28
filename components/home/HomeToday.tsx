import Link from "next/link";
import { Card, Empty, PageBody, smallButton } from "@/components/projects/kit";
import { NewVideoBox } from "@/components/home/NewVideoBox";
import type { Today } from "@/lib/home/today";

/**
 * 首页, for people who are not technical (28 Sep): what is waiting on you,
 * a box to start a new video, the videos under way, and — only while it is
 * true — which AI employee is busy. One column, one obvious press per row.
 */
export function HomeToday({ zh, me, greeting, today }: { zh: boolean; me: string; greeting: string; today: Today }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const n = today.todo.length + today.moreTodo;
  return (
    <PageBody width={960}>
      <style>{HOME_CSS}</style>
      <header style={{ padding: "6px 2px 4px" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>{zh ? `${greeting}，${me}` : `${greeting}, ${me}`}</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#7a7a7a" }}>{n ? t(`今天有 ${n} 件事等你`, `${n} thing${n === 1 ? "" : "s"} waiting for you`) : t("今天没有等你的事", "Nothing is waiting for you")}</p>
      </header>

      <Card icon="check" title={t("等你做的事", "Waiting for you")}>
        {today.todo.length ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {today.todo.map((r, i) => (
              <Link key={r.id} href={r.href} prefetch={false} className="ht-row" style={{ borderTop: i ? "1px solid #f0efeb" : 0 }}>
                <span className="ht-dot" aria-hidden />
                <span style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: "#171717" }}>{r.verb}</span>
                  <span style={{ fontSize: 13, color: "#7a7a7a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.title}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </span>
                <span style={{ ...smallButton(i === 0), height: 34, padding: "0 14px", fontSize: 13 }}>{r.press} →</span>
              </Link>
            ))}
            {today.moreTodo ? (
              <Link href="/projects" prefetch={false} style={{ fontSize: 13, color: "#525252", padding: "10px 2px 0", textDecoration: "none" }}>
                {t(`还有 ${today.moreTodo} 件 →`, `${today.moreTodo} more →`)}
              </Link>
            ) : null}
          </div>
        ) : (
          <Empty icon="check" text={t("都做完了", "All done")} />
        )}
      </Card>

      <Card icon="plus" title={t("做一条新视频", "Make a new video")}>
        <NewVideoBox zh={zh} />
        <Link href="/research" prefetch={false} style={{ display: "inline-block", marginTop: 12, fontSize: 13, color: "#6b6b6b", textDecoration: "none" }}>
          {t("不知道拍什么？看今天的选题 →", "Not sure what to make? See today's topics →")}
        </Link>
      </Card>

      <Card
        icon="film"
        title={t("进行中的视频", "Videos in progress")}
        right={
          <Link href="/projects" prefetch={false} style={{ ...smallButton(), height: 30 }}>
            {t("全部视频", "All videos")} →
          </Link>
        }
      >
        {today.active.length ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {today.active.map((r, i) => (
              <Link key={r.id} href={r.href} prefetch={false} className="ht-row" style={{ borderTop: i ? "1px solid #f0efeb" : 0 }}>
                <span className="ht-thumb" style={r.thumbFileId ? { backgroundImage: `url(/api/files/${r.thumbFileId}/thumb)` } : undefined} aria-hidden>
                  {r.thumbFileId ? null : (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden style={{ color: "#a9b3c6" }}>
                    <rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1" fill="currentColor" />
                    <path d="m16.6 13 4.6 2.8V8.2L16.6 11z" fill="currentColor" />
                  </svg>
                )}
                </span>
                <span style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                  <span style={{ fontSize: 12.5, color: "#7a7a7a" }}>
                    <span className="ht-pill" data-state={r.state}>
                      {r.step}
                    </span>{" "}
                    {r.who}
                  </span>
                </span>
                <span style={{ fontSize: 13, color: "#525252", flexShrink: 0 }}>{t("继续 →", "Open →")}</span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty icon="film" text={t("还没有进行中的视频，在上面开始一条吧", "No videos yet: start one above")} />
        )}
      </Card>

      {today.busy.length ? (
        <p style={{ margin: "2px 4px", fontSize: 12.5, color: "#7a7a7a", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="ht-live" aria-hidden />
          {t("AI 员工在忙：", "The AI team is busy: ")}
          {today.busy.join(zh ? "；" : "; ")}
        </p>
      ) : null}
    </PageBody>
  );
}

const HOME_CSS = `
.ht-row { display: flex; align-items: center; gap: 14px; padding: 12px 2px; text-decoration: none; color: inherit; }
.ht-row:hover { background: #fafaf8; }
.ht-dot { width: 8px; height: 8px; border-radius: 99px; background: #f0a53a; flex-shrink: 0; }
.ht-thumb { width: 64px; height: 40px; border-radius: 8px; background: #eef1f6 center/cover no-repeat; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
.ht-pill { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 0 8px; line-height: 20px; border-radius: 99px; background: #f3f3f1; color: #5f5f5f; margin-right: 4px; }
.ht-pill[data-state="you"] { background: #fff4df; color: #95590a; }
.ht-pill[data-state="running"] { background: #e9f2fe; color: #1f5fbf; }
.ht-live { width: 7px; height: 7px; border-radius: 99px; background: #278f5e; animation: auraPulse 1.6s ease-in-out infinite; flex-shrink: 0; }
@media (prefers-reduced-motion: reduce) { .ht-live { animation: none; } }
`;
