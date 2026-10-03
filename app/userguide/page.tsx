import type { Metadata } from "next";
import { GUIDE_DATE, GUIDE_LEAD, GUIDE_TITLE, SECTIONS, type Block } from "@/lib/userguide/content";

/**
 * /userguide: the studio's guide, open to anyone with the link (the owner,
 * 2 Oct: "host the guide here, open to all"). No sign-in, no shell: a plain
 * page in Chinese or English (?lang=en), the same text and screenshots as
 * the guide written on 2 Oct 2026.
 */

export const metadata: Metadata = {
  title: "腾亚创变使用指南 · Tengya Studio User Guide",
  description: "How to use the Tengya studio platform: topics, scripts, editing, publishing, AI colleagues, libraries and settings.",
  robots: { index: true, follow: true },
};

const CSS = `
.ug { --ink: #171717; --muted: #6b6b6b; --line: #e8e6e1; --bg: #fbfaf8; max-width: 860px; margin: 0 auto; padding: 36px 20px 80px; color: var(--ink); font: 15.5px/1.75 -apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Segoe UI", sans-serif; }
.ug a { color: #1f5fbf; }
.ug .top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.ug .brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); font-weight: 700; }
.ug .lang { margin-left: auto; display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; font-size: 13px; }
.ug .lang a { padding: 5px 12px; text-decoration: none; color: var(--muted); }
.ug .lang a[aria-current="page"] { background: #171717; color: #fff; }
.ug h1 { font-size: 30px; line-height: 1.25; margin: 18px 0 8px; letter-spacing: -0.01em; }
.ug .lead { font-size: 16.5px; color: #3f3f3f; margin: 0 0 6px; }
.ug .date { font-size: 13px; color: var(--muted); margin: 0 0 28px; }
.ug nav.toc { border: 1px solid var(--line); border-radius: 14px; background: var(--bg); padding: 16px 20px; margin: 0 0 36px; }
.ug nav.toc b { display: block; font-size: 13px; color: var(--muted); margin-bottom: 8px; font-weight: 600; }
.ug nav.toc ol { margin: 0; padding-left: 20px; columns: 2; column-gap: 28px; }
.ug nav.toc li { break-inside: avoid; margin: 2px 0; }
.ug nav.toc a { text-decoration: none; }
.ug section { margin: 0 0 44px; scroll-margin-top: 20px; }
.ug h2 { font-size: 22px; margin: 0 0 12px; padding-top: 12px; border-top: 1px solid var(--line); line-height: 1.3; }
.ug p { margin: 0 0 12px; }
.ug p.sub { font-weight: 650; margin: 18px 0 6px; }
.ug ul, .ug ol { margin: 0 0 14px; padding-left: 22px; }
.ug li { margin: 4px 0; }
.ug figure { margin: 14px 0 18px; }
.ug figure img { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 6px 24px rgba(30,25,20,.08); background: #fff; }
.ug figcaption { font-size: 13px; color: var(--muted); margin-top: 8px; }
.ug table { width: 100%; border-collapse: collapse; margin: 6px 0 16px; font-size: 14.5px; }
.ug th, .ug td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.ug th { font-weight: 650; background: var(--bg); }
.ug td:first-child { white-space: nowrap; font-weight: 600; }
.ug .foot { border-top: 1px solid var(--line); padding-top: 18px; font-size: 13px; color: var(--muted); }
/* The guide is read from a phone (a link in WhatsApp or WeChat): the app's desktop-only gate does not apply here. */
.desktop-only-gate { display: none !important; }
body { overflow: auto !important; }
@media (max-width: 640px) { .ug { padding: 24px 16px 60px; font-size: 15px; } .ug h1 { font-size: 24px; } .ug nav.toc ol { columns: 1; } .ug td:first-child { white-space: normal; } }
@media print { .ug .lang, .ug nav.toc { display: none; } .ug section { break-inside: avoid; } }
`;

function Blocks({ blocks, en }: { blocks: Block[]; en: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "p") {
          const text = en ? b.en : b.zh;
          /* A short line with no full stop is a run-in heading inside the section. */
          const sub = text.length <= 24 && !/[。.]/.test(text);
          return (
            <p key={i} className={sub ? "sub" : undefined}>
              {text}
            </p>
          );
        }
        if (b.t === "ul" || b.t === "ol") {
          const items = en ? b.en : b.zh;
          const List = b.t === "ul" ? "ul" : "ol";
          return (
            <List key={i}>
              {items.map((x, j) => (
                <li key={j}>{x}</li>
              ))}
            </List>
          );
        }
        if (b.t === "table") {
          const rows = en ? b.en : b.zh;
          const [head, ...body] = rows;
          return (
            <table key={i}>
              <thead>
                <tr>
                  {head.map((h, j) => (
                    <th key={j}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return (
          <figure key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.src} alt={en ? b.en : b.zh} loading="lazy" />
            <figcaption>{en ? b.en : b.zh}</figcaption>
          </figure>
        );
      })}
    </>
  );
}

export default async function UserGuidePage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  const en = lang === "en";
  return (
    <main id="main" className="ug" lang={en ? "en" : "zh-CN"}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="top">
        <a className="brand" href="/">
          {en ? "Tengya Studio" : "腾亚创变"}
        </a>
        <div className="lang" role="group" aria-label="Language">
          <a href="/userguide" aria-current={en ? undefined : "page"}>中文</a>
          <a href="/userguide?lang=en" aria-current={en ? "page" : undefined}>English</a>
        </div>
      </div>
      <h1>{en ? GUIDE_TITLE.en : GUIDE_TITLE.zh}</h1>
      <p className="lead">{en ? GUIDE_LEAD.en : GUIDE_LEAD.zh}</p>
      <p className="date">{en ? `Updated ${GUIDE_DATE}` : `更新于 ${GUIDE_DATE}`}</p>
      <nav className="toc" aria-label={en ? "Contents" : "目录"}>
        <b>{en ? "Contents" : "目录"}</b>
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{en ? s.en : s.zh}</a>
            </li>
          ))}
        </ol>
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{en ? s.en : s.zh}</h2>
          <Blocks blocks={s.blocks} en={en} />
        </section>
      ))}
      <div className="foot">
        {en ? (
          <>
            Questions the guide does not answer: ask the assistant on any page, or your admin. <a href="/login">Sign in</a>
          </>
        ) : (
          <>
            指南里没写到的问题，问任意页面右边的助理，或者找管理员。<a href="/login">登录</a>
          </>
        )}
      </div>
    </main>
  );
}
