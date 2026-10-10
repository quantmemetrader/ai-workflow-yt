"use client";

import * as React from "react";

/**
 * 「怎么用上 Claude」: every route the studio can take, on one page (client
 * request, 9 Oct: "a site featuring all potential solutions that they can choose
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
  ran: { zh: "已用它跑通过 Claude", en: "Claude has run on it", tone: "ok" },
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
      zh: "一个买 AI 额度的平台：一个密钥就能用 Claude、GPT、Gemini。我们的平台已经用 Orbio 的密钥实际跑通过 Claude。",
      en: "A marketplace for AI credits: one key for Claude, GPT and Gemini. Our platform has actually run Claude on an Orbio key.",
    },
    you: {
      zh: ["打开 orbio.so，填金额，点 Buy", "点「Sign in to buy」，登录并付款", "在 Orbio 里创建 API 密钥", "在平台里选 Orbio、粘贴密钥、点测试（见下方图文指南）"],
      en: ["Open orbio.so, enter an amount, press Buy", "Press Sign in to buy, sign in and pay", "Create an API key on Orbio", "Choose Orbio on the platform, paste the key, press Test (picture guide below)"],
    },
    pay: {
      zh: "在网页上付款。10 月 10 日页面显示：20 美元的额度实付 10.08 美元（含平台费和结账费）。",
      en: "Paid on the site. On 10 Oct the page showed US$20 of credit for US$10.08, fees included.",
    },
    chance: {
      zh: "Claude 能用：我们已用 Orbio 的密钥实际跑通。香港的卡能不能付款，要付一次才知道。",
      en: "Claude works: we have run it on an Orbio key. Whether a Hong Kong card pays is only known by paying once.",
    },
    risk: {
      zh: "这是一家新公司，建在 OpenRouter 之上。它能运营多久我们不确定，无法保证它一直存在；每次只充小额，用多少充多少。",
      en: "It is a new company, built on top of OpenRouter. We do not know how long it will exist and cannot guarantee it; top up small amounts only.",
    },
    link: { href: "https://www.orbio.so/", label: "orbio.so" },
  },
  {
    key: "b",
    name: { zh: "B.AI", en: "B.AI" },
    claude: true,
    status: "untested",
    what: {
      zh: "一个模型平台。它的文档列出了 Claude Sonnet 5.5、Opus 5.5，价格和官方一样（Sonnet 5.5 每百万字输入 2 美元、输出 10 美元）。",
      en: "A model platform. Its documentation lists Claude Sonnet 5.5 and Opus 5.5 at the official prices (Sonnet 5.5: US$2 in, US$10 out per million tokens).",
    },
    you: {
      zh: ["打开 b.ai，点「TRY BAI」，用 Google 等方式登录", "点左边「充值」，充一小笔", "点左边「API」，创建密钥", "在平台里选 B.AI、粘贴密钥、点测试（见下方图文指南）"],
      en: ["Open b.ai, press TRY BAI, sign in with Google or another way", "Press 充值 (Top up) on the left and add a small amount", "Press API on the left and create a key", "Choose B.AI on the platform, paste the key, press Test (picture guide below)"],
    },
    pay: {
      zh: "它的文档写明支持信用卡、微信支付、支付宝、银联；实际能选哪些，以充值页面显示为准。",
      en: "Its documentation names cards, WeChat Pay, Alipay and UnionPay; the top-up page shows which are offered.",
    },
    chance: {
      zh: "它的文档没有列出任何不支持的地区。我们还没有用 B.AI 的密钥实测过 Claude，按「测试」才能确认。",
      en: "Its documentation lists no unsupported regions. We have not yet run Claude on a B.AI key; pressing Test confirms it.",
    },
    risk: {
      zh: "我们在它的网站上没有找到服务条款和隐私政策；公司较新。",
      en: "We found no terms of service or privacy policy on its site; the company is young.",
    },
    link: { href: "https://b.ai/", label: "b.ai" },
  },
];

type Step = { img?: string; zh: string; en: string };

/* Screenshots taken 10 Oct 2026 of each service's public pages and of the platform's own keys screen. */
const G = "/guide/claude/";
const GUIDES: { id: string; name: string; steps: Step[] }[] = [
  {
    id: "orbio",
    name: "Orbio",
    steps: [
      { img: "orbio-1.jpg", zh: "打开 orbio.so，在右边「Buy credits」里填想买的额度（建议先买 20 美元），点 Buy。", en: "Open orbio.so, enter the amount of credit under Buy credits on the right (start with US$20), and press Buy." },
      { img: "orbio-2.jpg", zh: "页面会显示实际要付的钱（截图当天：20 美元额度付 10.08 美元）。点「Sign in to buy」，登录后付款。", en: "It shows what you actually pay (on the day of this screenshot, US$20 of credit cost US$10.08). Press Sign in to buy, sign in and pay." },
      { img: "orbio-3.jpg", zh: "付款后回到 Orbio 首页：你的密钥（sk-orbio- 开头）就在左边的卡片里，点旁边的复制按钮。卡片下方显示剩余额度。", en: "After paying, go back to the Orbio home page: your key (starting sk-orbio-) is in the card on the left; press the copy button beside it. The card also shows the credit left." },
    ],
  },
  {
    id: "bai",
    name: "B.AI",
    steps: [
      { img: "bai-1.jpg", zh: "打开 b.ai，点右上角「TRY BAI」。", en: "Open b.ai and press TRY BAI at the top right." },
      { img: "bai-3b.jpg", zh: "用 Google 账号登录，或者点「其它登录方式」选别的方式。", en: "Sign in with Google, or choose one of the other sign-in methods." },
      { img: "bai-3.jpg", zh: "登录后点左边的「充值」，先充一小笔。付款方式以页面显示为准。", en: "Once signed in, press 充值 (Top up) on the left and add a small amount. The page shows which payment methods you can use." },
      { img: "bai-4.jpg", zh: "点左边的「API」，创建一把 API 密钥并复制下来。", en: "Press API on the left, create an API key and copy it." },
    ],
  },
];

const PLATFORM: Step[] = [
  { img: "tg-1.jpg", zh: "用管理员账号登录平台，点左边「后台 › 员工管理」，再点上面的「渠道与凭据」。", en: "Sign in to the platform as an admin, open 后台 › 员工管理 (People) on the left, then the 渠道与凭据 (Channels & credentials) tab." },
  { img: "tg-3.jpg", zh: "找到「Claude 通道：用哪家平台」，点「设置」，在下拉框里选你买的那家（Orbio、B.AI 等），点「验证并保存」。", en: "Find Claude 通道：用哪家平台 (Claude gateway: which service), press 设置 (Set), choose the service you bought from (Orbio, B.AI and so on) and press 验证并保存 (Check and save)." },
  { img: "tg-5.jpg", zh: "在下一行「Claude 通道密钥」点「更换」，粘贴刚才复制的密钥（图里是一把示例密钥），点「验证并保存」。平台会先用这把密钥真的问 Claude 一句，通过了才保存。", en: "On the next row, Claude 通道密钥 (Claude gateway key), press 更换 (Replace), paste the key you copied and press 验证并保存. The platform first asks Claude a real question with it and saves it only if that works." },
  { img: "tg-6.jpg", zh: "以后随时可以点「测试」看 Claude 还能不能用。保存后 30 秒内，在模型列表里就能选 Claude 了。", en: "Press 测试 (Test) any time to check Claude still works. Within 30 seconds of saving, Claude can be picked in the model list." },
];

function Shot({ step, n, lang }: { step: Step; n: number; lang: L }) {
  return (
    <li className="co-step">
      <div className="co-step-text">
        <span className="co-step-n">{n}</span>
        <span>{step[lang]}</span>
      </div>
      {step.img ? (
        <a href={G + step.img} target="_blank" rel="noopener noreferrer" className="co-shot">
          <img src={G + step.img} alt={step[lang]} loading="lazy" width={1600} height={1000} />
        </a>
      ) : null}
    </li>
  );
}

function Guide({ lang }: { lang: L }) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [pick, setPick] = React.useState(GUIDES[0].id);
  const g = GUIDES.find((x) => x.id === pick) ?? GUIDES[0];
  return (
    <section className="co-guide" id="guide">
      <h2>{t("图文指南：从买额度到用上 Claude", "Picture guide: from buying credit to using Claude")}</h2>
      <p className="co-note">{t("先在所选平台买额度、拿密钥，再把密钥填进我们的平台。点图片可以看大图。", "First buy credit and get a key from the service you chose, then put the key into the platform. Click a picture to see it full size.")}</p>
      <div className="co-lang co-guide-pick" role="tablist" aria-label={t("选择平台", "Choose a service")}>
        {GUIDES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === pick} data-on={x.id === pick ? "" : undefined} onClick={() => setPick(x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      <h3>{t(`第一部分：在 ${g.name} 买额度、拿密钥`, `Part 1: buy credit and get a key from ${g.name}`)}</h3>
      <ol className="co-steps">
        {g.steps.map((s, i) => (
          <Shot key={g.id + i} step={s} n={i + 1} lang={lang} />
        ))}
      </ol>
      <h3>{t("第二部分：把密钥填进平台", "Part 2: put the key into the platform")}</h3>
      <ol className="co-steps">
        {PLATFORM.map((s, i) => (
          <Shot key={"p" + i} step={s} n={g.steps.length + i + 1} lang={lang} />
        ))}
      </ol>
    </section>
  );
}

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

        <Guide lang={lang} />

        <section className="co-advice">
          <h2>{t("怎么做", "What to do")}</h2>
          <ul>
            <li>{t("先充一小笔，按上面的图文指南把密钥填进平台，点「测试」。测试通过，Claude 就能用了。", "Top up a small amount, put the key into the platform as the guide above shows, and press Test. If it passes, Claude is ready.")}</li>
            <li>{t("测试没通过也不影响工作：平台会照常用其他模型回答。", "If the test fails, nothing stops: the platform keeps answering with the other models.")}</li>
          </ul>
        </section>

        <footer className="co-foot">{t("最后更新：2026 年 10 月 10 日", "Last updated 10 Oct 2026")}</footer>
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
.co-bad { background: #fbe4e1; color: #8f1d14; }
.co-others { margin-top: 30px; }
.co-others h2 { font-size: 20px; font-weight: 650; margin: 0 0 8px; }
.co-note { margin: 0 0 6px; color: #3b3934; font-size: 14px; }
.co-tier { margin-top: 18px; }
.co-tier h3 { margin: 0 0 8px; font-size: 13px; }
.co-other { margin-top: 10px; padding: 16px 18px; background: #fff; border: 1px solid #e3e0d7; border-radius: 12px; }
.co-other-name { font-size: 16px; font-weight: 650; }
.co-other-name a { color: #1c1b19; text-decoration: none; }
.co-other-name a:hover { text-decoration: underline; }
.co-other p { margin: 4px 0 10px; color: #3b3934; font-size: 14px; }
.co-other dl { margin: 0; display: grid; gap: 6px; font-size: 13.5px; }
.co-other dl > div { display: grid; grid-template-columns: 76px 1fr; gap: 10px; padding-top: 6px; border-top: 1px solid #f0eee7; }
.co-other dt { font-size: 12.5px; font-weight: 600; color: #6b675f; }
.co-other dd { margin: 0; }
.co-guide { margin-top: 30px; padding: 20px; background: #fff; border: 1px solid #e3e0d7; border-radius: 14px; scroll-margin-top: 16px; }
.co-guide h2 { font-size: 20px; font-weight: 650; margin: 0 0 8px; }
.co-guide h3 { font-size: 15.5px; font-weight: 650; margin: 22px 0 6px; }
.co-guide-pick { margin: 8px 0 2px; }
.co-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px; }
.co-step-text { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
.co-step-n { flex-shrink: 0; width: 24px; height: 24px; border-radius: 999px; background: #1c1b19; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 600; margin-top: 2px; }
.co-shot { display: block; border: 1px solid #e3e0d7; border-radius: 10px; overflow: hidden; background: #f7f6f2; }
.co-shot img { display: block; width: 100%; height: auto; }
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
  .co-other dl > div { grid-template-columns: 1fr; gap: 0; }
  .co h1 { font-size: 22px; }
  .co-card dl > div { grid-template-columns: 1fr; gap: 2px; }
  .co-card { padding: 16px; }
}
`;
