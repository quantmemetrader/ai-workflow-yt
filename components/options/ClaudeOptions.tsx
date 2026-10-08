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
    name: { zh: "由我们提供 Claude", en: "We provide Claude" },
    tag: { zh: "推荐", en: "Recommended" },
    claude: true,
    status: "live",
    what: {
      zh: "Claude 走我们团队的账号，已经接进平台。你们照常在模型里选 Claude 就行。",
      en: "Claude runs through our team's account, already connected to the platform. You simply pick Claude in the model list.",
    },
    you: { zh: ["不需要做任何事"], en: ["Nothing"] },
    pay: {
      zh: "按实际用量结算，用量在平台「员工管理 › 用量看板」里随时可查。结算方式由 Ryan 与你们确认。",
      en: "Billed on actual usage, visible any time under People › Token dashboard. Ryan confirms how it is settled.",
    },
    risk: {
      zh: "Anthropic 不向香港提供服务，如果它收紧政策，这条通道可能受影响。届时平台会自动改用其他模型回答，不会中断。",
      en: "Anthropic does not serve Hong Kong; if it tightens enforcement this route can be affected. The platform then answers with another model automatically, so nothing stops.",
    },
  },
  {
    key: "b",
    name: { zh: "Orbio", en: "Orbio" },
    claude: true,
    status: "ran",
    what: {
      zh: "一个买 AI 额度的平台：一个密钥就能用 Claude、GPT、Gemini，额度有折扣。它声明只转发请求、不保存对话内容。",
      en: "A marketplace for AI credits: one key for Claude, GPT and Gemini, sold at a discount. It states it only relays requests and keeps no prompts or answers.",
    },
    you: {
      zh: ["打开 orbio.so，填金额，点 Buy", "登录并付款", "把生成的密钥发给 Ryan，我们接入并测试"],
      en: ["Open orbio.so, enter an amount, press Buy", "Sign in and pay", "Send the key to Ryan; we connect and test it"],
    },
    pay: {
      zh: "网页上直接付款。香港的卡能不能付，需要实际付一次小额才知道。",
      en: "Paid on the site. Whether a Hong Kong card is accepted needs one small payment to find out.",
    },
    risk: {
      zh: "平台较新；额度来自其他卖家，折扣和可买数量随时变化。",
      en: "A young platform; credits come from other sellers, so the discount and the amount on offer change.",
    },
    link: { href: "https://www.orbio.so/", label: "orbio.so" },
  },
  {
    key: "c",
    name: { zh: "B.AI", en: "B.AI" },
    claude: true,
    status: "untested",
    what: {
      zh: "一个模型转售平台，有 Claude、GPT、Gemini 等。支持支付宝、微信支付、银联和信用卡。",
      en: "A model reseller offering Claude, GPT, Gemini and more. Accepts Alipay, WeChat Pay, UnionPay and cards.",
    },
    you: {
      zh: ["打开 b.ai，用 Google 账号登录", "充值，然后创建 API 密钥", "把密钥发给 Ryan，我们接入并测试（约半天）"],
      en: ["Open b.ai and sign in with Google", "Top up, then create an API key", "Send the key to Ryan; we connect and test it (about half a day)"],
    },
    pay: { zh: "支付宝、微信支付、银联或信用卡。", en: "Alipay, WeChat Pay, UnionPay or card." },
    risk: {
      zh: "你们的脚本、合同等内容会经过这家第三方；它的隐私条款写得不具体；公司较新。我们无法确认它提供的 Claude 与官方完全一致，接入后会先测。",
      en: "Your scripts and contracts pass through this third party; its privacy terms are not specific; the company is young. We cannot confirm its Claude matches the official one until we test it.",
    },
    link: { href: "https://b.ai/", label: "b.ai" },
  },
  {
    key: "d",
    name: { zh: "自己的 OpenRouter 账号，用非香港的付款方式", en: "Your own OpenRouter account, paid outside Hong Kong" },
    claude: true,
    status: "unsure",
    what: {
      zh: "OpenRouter 按账单地址和付款卡判断地区，所以用香港信用卡的账号会被 Claude 和 GPT 拒绝（你们现在的账号就是这样，和 VPN 无关）。换成非香港的卡和账单地址，理论上可以。",
      en: "OpenRouter decides region from the billing address and card, which is why an account paid with a Hong Kong card is refused by Claude and GPT (as yours is now; a VPN does not change it). A non-Hong Kong card and billing address should work in principle.",
    },
    you: {
      zh: ["准备一张非香港的卡和账单地址", "新开 OpenRouter 账号并充值", "把密钥填进平台「渠道与凭据 › OpenRouter（Claude 专用）」，点「测试」，当场就知道 Claude 认不认"],
      en: ["A non-Hong Kong card and billing address", "A new OpenRouter account with credit", "Paste the key under Channels & credentials › OpenRouter (Claude) and press Test: it says at once whether Claude accepts it"],
    },
    pay: { zh: "非香港发行的信用卡。", en: "A card issued outside Hong Kong." },
    risk: { zh: "OpenRouter 没有公开它的判断标准，可能再次被拒。", en: "OpenRouter does not publish what it checks; it may be refused again." },
    link: { href: "https://openrouter.ai/", label: "openrouter.ai" },
  },
  {
    key: "e",
    name: { zh: "Microsoft Azure OpenAI", en: "Microsoft Azure OpenAI" },
    claude: false,
    status: "official",
    what: {
      zh: "微软表示继续向香港的合资格企业客户提供 OpenAI 的 GPT 模型（部署在新加坡、日本等邻近地区）。这是香港企业用顶级海外模型的正规途径，但只有 GPT，没有 Claude。",
      en: "Microsoft has said it continues to offer OpenAI's GPT models to eligible Hong Kong business customers (deployed in nearby regions such as Singapore or Japan). It is the official way for a Hong Kong company to use a top overseas model, but it is GPT only, not Claude.",
    },
    you: {
      zh: ["用公司名义开通 Azure 订阅", "在 Azure 里开通 OpenAI 服务并部署模型", "把密钥发给 Ryan，我们接入（约半天）"],
      en: ["Open an Azure subscription in the company's name", "Enable the OpenAI service and deploy a model", "Send the key to Ryan; we connect it (about half a day)"],
    },
    pay: { zh: "你们自己的 Azure 账单，可用香港信用卡。", en: "Your own Azure bill; a Hong Kong card is fine." },
    risk: { zh: "开通步骤比较多；没有 Claude。", en: "More setup steps; no Claude." },
    link: { href: "https://azure.microsoft.com/products/ai-services/openai-service", label: "Azure OpenAI" },
  },
  {
    key: "f",
    name: { zh: "维持现状，不用 Claude", en: "Stay as you are, without Claude" },
    claude: false,
    status: "now",
    what: {
      zh: "平台现在用你们自己的 OpenRouter 账号运行 Qwen、Kimi、DeepSeek 和 GLM。中文写作质量好，不受地区限制。",
      en: "The platform already runs Qwen, Kimi, DeepSeek and GLM on your own OpenRouter account. Strong Chinese writing, and no regional limits.",
    },
    you: { zh: ["不需要做任何事"], en: ["Nothing"] },
    pay: { zh: "你们现有的 OpenRouter 账号。", en: "Your existing OpenRouter account." },
    risk: { zh: "没有 Claude。", en: "No Claude." },
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
        <h1>{t("怎么用上 Claude：全部方案", "Getting Claude: every option")}</h1>
        <p className="co-lede">
          {t(
            "Anthropic（Claude 的公司）不向香港提供服务：它自己的 API、AWS 和微软的渠道都不接受香港的账单账号，OpenRouter 也按账单地址和付款卡拦截。所以你们新开的 OpenRouter 账号能用 Qwen、Kimi 等模型，但会被 Claude 和 GPT 拒绝。这不是设置问题，和 VPN 也无关。",
            "Anthropic, the company behind Claude, does not serve Hong Kong: its own API and the AWS and Microsoft channels all refuse Hong Kong billing accounts, and OpenRouter blocks by billing address and card. That is why your new OpenRouter account works for Qwen, Kimi and others but is refused by Claude and GPT. Nothing was set up wrong, and a VPN does not change it.",
          )}
        </p>
        <p className="co-lede">{t("下面是所有可行的路。选一个告诉 Ryan，接入和测试由我们来做。", "Below is every route that exists. Pick one and tell Ryan; we do the connecting and testing.")}</p>

        <section className="co-now">
          <div className="co-now-title">{t("现在的状态", "Where things stand today")}</div>
          <ul>
            <li>{t("平台正常运行：Qwen、Kimi、DeepSeek、GLM 用的是你们自己的账号。", "The platform is running: Qwen, Kimi, DeepSeek and GLM use your own account.")}</li>
            <li>{t("Claude 已经可以选用，走的是方案 A。", "Claude can already be selected; it runs on option A.")}</li>
          </ul>
        </section>

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
          <h2>{t("我们的建议", "What we suggest")}</h2>
          <ul>
            <li>{t("想马上用、不想操心：选 A。今天就能用，你们什么都不用做。", "To use it now with no effort: A. It works today and asks nothing of you.")}</li>
            <li>{t("想用自己的账号付款：B（Orbio）或 C（B.AI）。告诉我们选哪个，我们先接入测试，确认好用再给你们用。", "To pay through your own account: B (Orbio) or C (B.AI). Tell us which; we connect and test it first, and hand it over once it is confirmed.")}</li>
            <li>{t("想要一条官方认可、不会被切断的海外模型：E（Azure 的 GPT），可以和上面任何一个同时用。", "For an officially permitted overseas model that will not be cut off: E (GPT on Azure), alongside any of the above.")}</li>
          </ul>
          <p>{t("无论选哪个，平台都会保留自动切换：一个模型用不了，就换另一个回答，工作不会停。", "Whichever you choose, the platform keeps its automatic fallback: if one model is unavailable another answers, so work does not stop.")}</p>
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
.co-card ol { margin: 0; padding-left: 20px; }
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
