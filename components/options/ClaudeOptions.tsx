"use client";

import * as React from "react";

/**
 * 「怎么用上 Claude」: every route the studio can take, on one page (Ryan,
 * 9 Oct: "a site featuring all potential solutions that they can choose
 * from"). Anthropic does not serve Hong Kong, so each route is somebody's
 * account or another model; the page says what each asks of the studio, how
 * it is paid, whether we have run it, and what can go wrong, so the choice is
 * theirs to make with the facts in front of them.
 */
type L = "zh" | "en";
type Status = "live" | "ran" | "untested" | "official" | "unsure" | "now";

type Option = {
  key: string;
  name: Record<L, string>;
  tag?: Record<L, string>;
  claude: boolean;
  status: Status;
  what: Record<L, string>;
  you: Record<L, string[]>;
  pay: Record<L, string>;
  /** How likely it is to work for a Hong Kong studio, and why we think so. */
  chance: Record<L, string>;
  risk: Record<L, string>;
  link?: { href: string; label: string };
};

const STATUS: Record<Status, { zh: string; en: string; tone: string }> = {
  live: { zh: "已接通，现在就能用", en: "Connected, works today", tone: "good" },
  ran: { zh: "平台用它运行过，换密钥后需重测", en: "The platform has run on it; retest with a new key", tone: "ok" },
  untested: { zh: "我们还没实测", en: "Not tested by us yet", tone: "warn" },
  official: { zh: "官方允许的渠道（仅 GPT）", en: "Officially permitted (GPT only)", tone: "ok" },
  unsure: { zh: "不保证能用", en: "Not guaranteed to work", tone: "warn" },
  now: { zh: "平台现在就在用", en: "What the platform runs on now", tone: "good" },
};

const OPTIONS: Option[] = [
  {
    key: "a",
    name: { zh: "Orbio", en: "Orbio" },
    claude: true,
    status: "ran",
    what: {
      zh: "一个买 AI 额度的平台：一个密钥就能用 Claude、GPT、Gemini，额度有折扣。它建在 OpenRouter 之上，把请求转给 OpenRouter。它声明只转发请求、不保存对话内容。",
      en: "A marketplace for AI credits: one key for Claude, GPT and Gemini, sold at a discount. It is built on top of OpenRouter and relays requests to it. It states it only relays requests and keeps no prompts or answers.",
    },
    you: {
      zh: ["打开 orbio.so，填金额，点 Buy", "登录并付款", "把生成的密钥发给 Ryan，我们接入并测试"],
      en: ["Open orbio.so, enter an amount, press Buy", "Sign in and pay", "Send the key to Ryan; we connect and test it"],
    },
    pay: {
      zh: "网页上直接付款。香港的卡能不能付，需要实际付一次小额才知道。",
      en: "Paid on the site. Whether a Hong Kong card is accepted needs one small payment to find out.",
    },
    chance: {
      zh: "我们的平台用它运行过，技术上接得上。香港的卡能否付款还没验证。",
      en: "Our platform has run on it, so it connects. Whether a Hong Kong card can pay is not verified.",
    },
    risk: {
      zh: "这是一家新公司，建在 OpenRouter 之上。它能运营多久我们不确定，无法保证它一直存在；建议每次只充小额，用多少充多少。",
      en: "It is a new company, built on top of OpenRouter. We do not know how long it will exist and cannot guarantee that it will; top up small amounts and only what you will use.",
    },
    link: { href: "https://www.orbio.so/", label: "orbio.so" },
  },
  {
    key: "b",
    name: { zh: "B.AI", en: "B.AI" },
    claude: true,
    status: "untested",
    what: {
      zh: "一个模型平台。它的文档列出了 Claude Sonnet 5.5、Opus 5.5 等十多个 Claude 模型，以及 GPT、Gemini、Qwen、Kimi 等，标价与官方相同（Sonnet 5.5 每百万字输入 2 美元、输出 10 美元）。",
      en: "A model platform. Its documentation lists Claude Sonnet 5.5, Opus 5.5 and a dozen more Claude models, plus GPT, Gemini, Qwen and Kimi, at the official list prices (Sonnet 5.5: US$2 in, US$10 out per million tokens).",
    },
    you: {
      zh: ["打开 b.ai，用 Google 账号登录", "充值，然后创建 API 密钥", "把密钥发给 Ryan，我们接入并测试"],
      en: ["Open b.ai and sign in with Google", "Top up, then create an API key", "Send the key to Ryan; we connect and test it"],
    },
    pay: {
      zh: "文档写明支持信用卡、微信支付、支付宝、银联，也支持加密货币；具体可选的方式以充值页面显示为准，因地区而异。",
      en: "Its documentation names cards, WeChat Pay, Alipay and UnionPay, and also crypto; the methods actually offered are those shown on the top-up page and vary by region.",
    },
    chance: {
      zh: "它的文档没有列出任何不支持的国家或地区，没有提到香港，反而专门写了中国内地用户如何访问。所以没有迹象显示它会拒绝香港，但我们还没有用真实密钥测过 Claude，测过才能确认。",
      en: "Its documentation lists no unsupported countries or regions and does not mention Hong Kong; it even explains how users in mainland China can reach it. Nothing suggests it refuses Hong Kong, but we have not yet tested Claude with a real key, and only that confirms it.",
    },
    risk: {
      zh: "你们的脚本、合同等内容会经过这家第三方。我们在它的网站上没有找到服务条款和隐私政策，也没有写明它的 Claude 来自哪里。公司较新，与加密货币项目有关联。",
      en: "Your scripts and contracts pass through this third party. We found no terms of service or privacy policy on its site, and it does not say where its Claude capacity comes from. The company is young and tied to a crypto project.",
    },
    link: { href: "https://b.ai/", label: "b.ai" },
  },
];

export function ClaudeOptions() {
  const [lang, setLang] = React.useState<L>("zh");
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return (
    <div className="co">
      <style>{CSS}</style>
      <header className="co-head">
        <div className="co-brand">腾亚创变 · Tengya</div>
        <div className="co-lang" role="group" aria-label="Language">
          <button type="button" data-on={lang === "zh" ? "" : undefined} onClick={() => setLang("zh")}>中文</button>
          <button type="button" data-on={lang === "en" ? "" : undefined} onClick={() => setLang("en")}>EN</button>
        </div>
      </header>

      <main className="co-main">
        <h1>{t("怎么用上 Claude：可选方案", "Getting Claude: the options")}</h1>
        <div className="co-table-wrap">
          <table className="co-table">
            <thead>
              <tr>
                <th>{t("方案", "Option")}</th>
                <th>{t("有 Claude", "Claude")}</th>
                <th>{t("你们要做的", "What you do")}</th>
                <th>{t("状态", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {OPTIONS.map((o) => (
                <tr key={o.key}>
                  <td>
                    <a href={`#${o.key}`}>
                      {o.key.toUpperCase()}. {o.name[lang]}
                    </a>
                  </td>
                  <td>{o.claude ? t("有", "Yes") : t("没有", "No")}</td>
                  <td>{o.you[lang].length === 1 ? o.you[lang][0] : t(`${o.you[lang].length} 步`, `${o.you[lang].length} steps`)}</td>
                  <td>
                    <span className={`co-pill co-${STATUS[o.status].tone}`}>{STATUS[o.status][lang]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {OPTIONS.map((o) => (
          <section key={o.key} id={o.key} className="co-card">
            <div className="co-card-head">
              <span className="co-letter">{o.key.toUpperCase()}</span>
              <h2>{o.name[lang]}</h2>
              {o.tag ? <span className="co-tag">{o.tag[lang]}</span> : null}
              <span className={`co-pill co-${STATUS[o.status].tone}`}>{STATUS[o.status][lang]}</span>
            </div>
            <p className="co-what">{o.what[lang]}</p>
            <dl>
              <div>
                <dt>{t("你们要做的", "What you do")}</dt>
                <dd>
                  {o.you[lang].length === 1 ? (
                    o.you[lang][0]
                  ) : (
                    <ol>
                      {o.you[lang].map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("怎么付款", "How it is paid")}</dt>
                <dd>{o.pay[lang]}</dd>
              </div>
              <div>
                <dt>{t("在香港能用的把握", "Will it work from Hong Kong")}</dt>
                <dd>{o.chance[lang]}</dd>
              </div>
              <div>
                <dt>{t("要知道的风险", "What to know")}</dt>
                <dd>{o.risk[lang]}</dd>
              </div>
            </dl>
            {o.link ? (
              <a className="co-link" href={o.link.href} target="_blank" rel="noopener noreferrer">
                {o.link.label} ↗
              </a>
            ) : null}
          </section>
        ))}

        <section className="co-advice">
          <h2>{t("怎么选", "How to choose")}</h2>
          <ul>
            <li>{t("两个都需要先充一小笔，把密钥发给 Ryan。我们用真实请求测 Claude，确认能用再正式接入。", "Either way, top up a small amount first and send the key to Ryan. We test Claude with real requests and connect it only once it works.")}</li>
            <li>{t("先充小额。两家都是新平台，不要一次充很多。", "Start small. Both are new services; do not top up a large amount at once.")}</li>
          </ul>
          <p>{t("无论选哪个，平台都会保留自动切换：Claude 用不了时，换另一个模型回答，工作不会停。", "Whichever you choose, the platform keeps its automatic fallback: when Claude is unavailable another model answers, so work does not stop.")}</p>
        </section>

        <footer className="co-foot">{t("最后更新：2026 年 10 月 9 日 · 有问题找 Ryan", "Last updated 9 Oct 2026 · Questions to Ryan")}</footer>
      </main>
    </div>
  );
}

const CSS = `
/* This page is for phones too: the app's desktop-only notice stands aside here, as on the user guide. */
.desktop-only-gate { display: none !important; }
body { overflow: auto !important; }
.co { min-height: 100vh; background: #f7f6f2; color: #1c1b19; font-size: 15px; line-height: 1.7; -webkit-text-size-adjust: 100%; }
.co-head { display: flex; align-items: center; justify-content: space-between; max-width: 860px; margin: 0 auto; padding: 18px 20px 0; }
.co-brand { font-size: 13px; font-weight: 600; letter-spacing: .02em; color: #6b675f; }
.co-lang { display: inline-flex; border: 1px solid #dcd9d0; border-radius: 999px; overflow: hidden; background: #fff; }
.co-lang button { border: 0; background: none; padding: 5px 13px; font: inherit; font-size: 12.5px; color: #6b675f; cursor: pointer; }
.co-lang button[data-on] { background: #1c1b19; color: #fff; }
.co-main { max-width: 860px; margin: 0 auto; padding: 22px 20px 60px; }
.co h1 { font-size: 27px; line-height: 1.3; font-weight: 700; margin: 6px 0 14px; letter-spacing: -.01em; }
.co-lede { margin: 0 0 10px; color: #3b3934; }
.co-now { margin: 20px 0; padding: 14px 18px; border-radius: 12px; background: #eaf3ec; border: 1px solid #cfe3d4; }
.co-now-title { font-weight: 600; margin-bottom: 4px; color: #1f5a37; }
.co-now ul, .co-advice ul { margin: 0; padding-left: 20px; }
.co-table-wrap { overflow-x: auto; margin: 22px 0 6px; border: 1px solid #e3e0d7; border-radius: 12px; background: #fff; }
.co-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 560px; }
.co-table th { text-align: left; font-weight: 600; color: #6b675f; padding: 10px 14px; border-bottom: 1px solid #e3e0d7; font-size: 12.5px; }
.co-table td { padding: 11px 14px; border-bottom: 1px solid #f0eee7; vertical-align: top; }
.co-table tr:last-child td { border-bottom: 0; }
.co-table a { color: #1c1b19; font-weight: 500; text-decoration: underline; text-decoration-color: #cfcbc0; text-underline-offset: 3px; }
.co-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1.6; }
.co-good { background: #e3f2e7; color: #1f5a37; }
.co-ok { background: #e8eefb; color: #1f448f; }
.co-warn { background: #fbefd9; color: #7a4d06; }
.co-card { margin-top: 18px; padding: 20px; background: #fff; border: 1px solid #e3e0d7; border-radius: 14px; scroll-margin-top: 16px; }
.co-card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.co-letter { width: 28px; height: 28px; border-radius: 8px; background: #1c1b19; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex-shrink: 0; }
.co-card h2 { font-size: 18px; font-weight: 650; margin: 0; }
.co-tag { padding: 2px 10px; border-radius: 999px; background: #1c1b19; color: #fff; font-size: 12px; font-weight: 500; }
.co-what { margin: 0 0 12px; color: #3b3934; }
.co-card dl { margin: 0; display: grid; gap: 10px; }
.co-card dl > div { display: grid; grid-template-columns: 120px 1fr; gap: 12px; padding-top: 10px; border-top: 1px solid #f0eee7; }
.co-card dt { font-size: 12.5px; font-weight: 600; color: #6b675f; padding-top: 2px; }
.co-card dd { margin: 0; }
.co-card ol { margin: 0; padding-left: 20px; list-style: decimal; }
.co-now ul, .co-advice ul { list-style: disc; }
.co-link { display: inline-block; margin-top: 14px; font-size: 13.5px; font-weight: 500; color: #1f448f; text-decoration: none; }
.co-link:hover { text-decoration: underline; }
.co-advice { margin-top: 26px; padding: 20px; border-radius: 14px; background: #1c1b19; color: #f3f1ea; }
.co-advice h2 { font-size: 17px; margin: 0 0 8px; }
.co-advice li { margin-bottom: 6px; }
.co-advice p { margin: 10px 0 0; color: #cfcbc0; font-size: 14px; }
.co-foot { margin-top: 22px; font-size: 12.5px; color: #8b877e; text-align: center; }
@media (max-width: 560px) {
  .co h1 { font-size: 22px; }
  .co-card dl > div { grid-template-columns: 1fr; gap: 2px; }
  .co-card { padding: 16px; }
}
`;
