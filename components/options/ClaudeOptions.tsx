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

type Tier = "try" | "maybe" | "no";
type Other = {
  name: string;
  href?: string;
  tier: Tier;
  /** What the service's own documents say about source and regions. */
  says: Record<L, string>;
  pay: Record<L, string>;
  price: Record<L, string>;
  watch: Record<L, string>;
};

const TIER: Record<Tier, { zh: string; en: string; tone: string; headZh: string; headEn: string }> = {
  try: { zh: "值得先试", en: "Worth trying first", tone: "ok", headZh: "值得先试的", headEn: "Worth trying first" },
  maybe: { zh: "可以一试，资料较少", en: "Possible, less is known", tone: "warn", headZh: "可以一试，但公开资料较少的", headEn: "Possible, but less is known" },
  no: { zh: "不建议", en: "Not advised", tone: "bad", headZh: "不建议的", headEn: "Not advised" },
};

/**
 * The wider field (9 Oct): every other service we could find that sells
 * Claude through an OpenAI-style API, read from its own documents and terms.
 * None was paid for or tested with a key; where a fact comes from a
 * third-party listing rather than the service itself, the text says so.
 */
const OTHERS: Other[] = [
  {
    name: "AiHubMix",
    href: "https://aihubmix.com/",
    tier: "try",
    says: {
      zh: "它的文档写明 Claude 来自 Anthropic 官方、AWS 和 Azure，并声明不主动保存对话内容。没有找到地区限制条款。我们的服务器连得上，模型列表里有 Sonnet 5.5 和 Opus 5.5。",
      en: "Its documentation names Anthropic, AWS and Azure as the sources of its Claude and says it does not actively store prompts or answers. No regional restriction found. Our server reaches it, and its list has Sonnet 5.5 and Opus 5.5.",
    },
    pay: {
      zh: "第三方资料称支持支付宝、微信支付、信用卡和 PayPal；它自己的文档没有写，以充值页面为准。",
      en: "Third-party listings report Alipay, WeChat Pay, cards and PayPal; its own documentation does not say, so the top-up page decides.",
    },
    price: { zh: "约等于官方价，部分型号贵一成。", en: "About list price; some models 10% above." },
    watch: {
      zh: "公司据称是美国注册的 AIHubMix, LLC，这一点我们没能在它自己的网站上核实。",
      en: "Reported to be AIHubMix, LLC, registered in the US; we could not confirm that on its own site.",
    },
  },
  {
    name: "Vercel AI Gateway",
    href: "https://vercel.com/ai-gateway",
    tier: "try",
    says: {
      zh: "美国大公司 Vercel 的服务，用它自己与 Anthropic 等的合约供货。文档和服务条款里没有地区限制，只有一般的制裁名单条款。请求完成后即删除内容。",
      en: "Run by Vercel, a large US company, on its own contracts with Anthropic and others. Its documentation and terms name no restricted regions, only a general sanctions clause. Content is deleted once the request completes.",
    },
    pay: {
      zh: "需要开 Vercel 团队账号并绑定信用卡，预充额度。香港能否作为账单地区、香港的卡能否通过，要实际操作才知道；有用户反映绑卡后仍被拒（403）。",
      en: "Needs a Vercel team account with a card on file and prepaid credits. Whether Hong Kong is accepted as a billing country, and a Hong Kong card passes, is only known by trying; some users report a 403 even with a card on file.",
    },
    price: { zh: "官方价，不加价。", en: "List price, no markup." },
    watch: {
      zh: "大公司最可能在 Anthropic 要求时加上地区限制，就像 OpenRouter 那样。",
      en: "A large vendor is the most likely to add a region rule if Anthropic asks, as OpenRouter did.",
    },
  },
  {
    name: "Requesty",
    href: "https://www.requesty.ai/",
    tier: "try",
    says: {
      zh: "自己供货的模型网关。帮助文档里没有地区限制的页面；它的服务条款页面我们打不开，没能读到。我们的服务器连得上，列表里有最新的 Claude。",
      en: "A gateway that sells its own capacity. Its help pages have nothing on regions; its terms page would not load for us, so it is unread. Our server reaches it and it lists current Claude.",
    },
    pay: {
      zh: "信用卡（Stripe），可用人民币等币种充值，可开发票。没有列出支付宝、微信支付和银联。",
      en: "Cards through Stripe, top-ups in several currencies including CNY, invoices available. Alipay, WeChat Pay and UnionPay are not listed.",
    },
    price: { zh: "每次充值加收 5% 手续费。", en: "A 5% fee on each top-up." },
    watch: { zh: "公司背景和数据保存规则没有查到。", en: "Company background and data-retention rules not found." },
  },
  {
    name: "OhMyGPT",
    href: "https://www.ohmygpt.com/",
    tier: "try",
    says: {
      zh: "2023 年起运营，经营方是 DogeNet LLC。第三方资料称它的标准通道走 Anthropic 官方。我们的服务器连得上，列表里有 Sonnet 5.5 和 Opus 5.5。",
      en: "Operating since 2023, run by DogeNet LLC. Third-party listings describe its standard channel as official Anthropic. Our server reaches it, and its list has Sonnet 5.5 and Opus 5.5.",
    },
    pay: {
      zh: "第三方资料称支持支付宝、微信支付、信用卡和 PayPal，可开发票。",
      en: "Third-party listings report Alipay, WeChat Pay, cards and PayPal, with invoices.",
    },
    price: { zh: "标准通道约为官方价的 1.1 倍。", en: "About 1.1 times list on the standard channel." },
    watch: {
      zh: "只能用标准通道。它另有一条两折的低价通道，它自己的文档说会因封号而不稳定、不建议商用，不要用。",
      en: "Standard channel only. It also sells a channel at 20% of list which its own documentation says suffers account bans and is not for business use; do not use that one.",
    },
  },
  {
    name: "CloseAI",
    href: "https://www.closeai-asia.com/",
    tier: "try",
    says: {
      zh: "面向企业，文档写明所有模型 100% 来自官方原生接口。服务条款适用香港法律，在香港国际仲裁中心仲裁。没有找到地区限制。",
      en: "Aimed at companies; its documentation says every model comes 100% from official native APIs. Its terms are under Hong Kong law with arbitration at HKIAC. No regional restriction found.",
    },
    pay: { zh: "付款方式没有查到；每笔订单可下载正式的发票和收据。", en: "Payment methods not found; every order has a proper invoice and receipt." },
    price: { zh: "没有查到。", en: "Not found." },
    watch: {
      zh: "条款没有写明签约公司是哪一家，退款由它酌情决定。充值前先问清签约主体。",
      en: "The terms do not name the contracting company, and refunds are at its discretion. Ask who you are contracting with before paying.",
    },
  },
  {
    name: "Helicone",
    href: "https://www.helicone.ai/",
    tier: "maybe",
    says: {
      zh: "美国公司，买它的额度后由它代管 Anthropic 等的密钥。服务条款里没有地区限制。",
      en: "A US company; with its credits it manages the Anthropic and other keys for you. Its terms contain no regional restriction.",
    },
    pay: { zh: "信用卡，需要账单地址。其他方式没有查到。", en: "Card with a billing address. Nothing else found." },
    price: { zh: "官方价，不加价。", en: "List price, no markup." },
    watch: {
      zh: "它本身是记录和分析请求的工具，用之前要确认能关闭内容记录。",
      en: "It is at heart a tool for logging and analysing requests; confirm that content logging can be turned off.",
    },
  },
  {
    name: "AIMLAPI",
    href: "https://aimlapi.com/",
    tier: "maybe",
    says: {
      zh: "服务条款适用爱沙尼亚法律，里面没有地区限制或制裁条款。我们的服务器连得上，列表里有最新的 Claude。",
      en: "Its terms are under Estonian law and contain no regional or sanctions clause. Our server reaches it and it lists current Claude.",
    },
    pay: { zh: "信用卡，由 Stripe 代收。", en: "Cards, collected by Stripe." },
    price: { zh: "没有查到。", en: "Not found." },
    watch: { zh: "Claude 的来源和数据保存规则没有写明。", en: "Where its Claude comes from and how long data is kept are not stated." },
  },
  {
    name: "CometAPI",
    href: "https://www.cometapi.com/",
    tier: "maybe",
    says: {
      zh: "服务条款适用香港法律，没有地区限制，声明不保存输入和输出，未用完的额度可申请退款。",
      en: "Its terms are under Hong Kong law with no regional restriction; it says it does not store inputs or outputs, and unused credit can be refunded on request.",
    },
    pay: { zh: "信用卡（Stripe），最低充值 10 美元。", en: "Cards through Stripe, minimum top-up US$10." },
    price: { zh: "官方价的八折。", en: "20% below list." },
    watch: {
      zh: "比官方便宜却没有说明 Claude 从哪里来；条款里也没有写公司名称。",
      en: "Cheaper than list with no explanation of where its Claude comes from; the terms do not name the company.",
    },
  },
  {
    name: "302.AI",
    href: "https://302.ai/",
    tier: "maybe",
    says: {
      zh: "服务条款写明「平台不受地区限制」。经营方是 Univerads Technology Limited。",
      en: "Its terms say the platform is not subject to geographic restrictions. Run by Univerads Technology Limited.",
    },
    pay: { zh: "预充值，具体付款方式没有查到。", en: "Prepaid; specific methods not found." },
    price: { zh: "没有查到。", en: "Not found." },
    watch: { zh: "已付款项不退。Claude 的来源没有写明。", en: "No refunds on anything paid. Source of its Claude is not stated." },
  },
  {
    name: "Eden AI",
    href: "https://www.edenai.co/",
    tier: "maybe",
    says: {
      zh: "法国公司（里昂），适用法国法律，条款里没有地区限制，默认不保存输入和输出。",
      en: "A French company in Lyon under French law; no regional restriction in its terms, and inputs and outputs are not stored by default.",
    },
    pay: { zh: "没有查到；已付款项不退。", en: "Not found; payments are non-refundable." },
    price: { zh: "没有查到。", en: "Not found." },
    watch: { zh: "付款方式和加价都要先问清楚。", en: "Ask about payment methods and markup first." },
  },
  {
    name: "OpenRouter",
    tier: "no",
    says: {
      zh: "它的条款写明会执行上游模型公司的地区限制。你们用香港信用卡开的账号已经被 Claude 和 GPT 拒绝。",
      en: "Its terms say it enforces the model companies' regional limits. Your account, paid with a Hong Kong card, is already refused by Claude and GPT.",
    },
    pay: { zh: "信用卡、支付宝。", en: "Cards, Alipay." },
    price: { zh: "官方价，充值加收 5.5%。", en: "List price plus 5.5% on top-ups." },
    watch: { zh: "继续用它跑 Qwen、Kimi、DeepSeek、GLM 没有问题。", en: "Still fine for Qwen, Kimi, DeepSeek and GLM." },
  },
  {
    name: "Portkey",
    tier: "no",
    says: {
      zh: "它只是转发工具，要求自带 Anthropic 或 AWS 的密钥，而香港正是拿不到这些密钥。",
      en: "Only a relay: you must bring your own Anthropic or AWS key, which is exactly what Hong Kong cannot get.",
    },
    pay: { zh: "不适用。", en: "Not applicable." },
    price: { zh: "不适用。", en: "Not applicable." },
    watch: { zh: "对你们没有用。", en: "No use to you." },
  },
  {
    name: "Poe",
    tier: "no",
    says: { zh: "Quora 的服务。接口里只有 Claude Sonnet 和 Haiku，没有 Opus。", en: "Quora's service. Its API has Claude Sonnet and Haiku only, no Opus." },
    pay: { zh: "没有查到。", en: "Not found." },
    price: { zh: "没有查到。", en: "Not found." },
    watch: { zh: "接口条款对地区、付款、数据保存都没有说明。", en: "Its API terms say nothing on regions, payment or data retention." },
  },
  {
    name: "PPQ.ai",
    tier: "no",
    says: { zh: "条款只排除受禁运的地区，香港不在其中。", en: "Its terms exclude only embargoed regions, which Hong Kong is not." },
    pay: { zh: "信用卡或加密货币，充值不可提现。", en: "Card or crypto; deposits cannot be withdrawn." },
    price: { zh: "没有查到。", en: "Not found." },
    watch: { zh: "条款里没有公司主体和适用法律，联系方式是个人邮箱。", en: "No legal entity or governing law in its terms; the contact is a personal email address." },
  },
  {
    name: "laozhang.ai",
    tier: "no",
    says: {
      zh: "新加坡公司。条款写明可按「上游服务商规则」排除某些地区，这一条随时可以用在香港身上。",
      en: "A Singapore company. Its terms allow it to exclude regions under upstream provider rules, a clause that could be applied to Hong Kong at any time.",
    },
    pay: { zh: "信用卡（Stripe），第三方资料称也支持支付宝和微信支付。", en: "Cards through Stripe; third-party listings add Alipay and WeChat Pay." },
    price: { zh: "曾宣传比官方便宜三到七成。", en: "Has advertised 30 to 70% below list." },
    watch: { zh: "价格远低于官方又不说明来源，是危险信号。", en: "Far below list with no stated source is a warning sign." },
  },
  {
    name: "DMXAPI",
    tier: "no",
    says: {
      zh: "面向内地的平台，公开出售非官方渠道的模型，Claude 的来源没有写明。",
      en: "A mainland-facing service that openly sells models from unofficial channels; the source of its Claude is not stated.",
    },
    pay: { zh: "微信支付，人民币计价。", en: "WeChat Pay, priced in RMB." },
    price: { zh: "官方价的七到八折。", en: "20 to 30% below list." },
    watch: { zh: "不适合让合同和财务内容经过。", en: "Not somewhere to send contracts and finance documents." },
  },
  {
    name: "API2D",
    tier: "no",
    says: {
      zh: "面向内地的平台，2023 年起运营。它自己的网站我们读不到，第三方资料称其渠道来源无法核实。",
      en: "A mainland-facing service operating since 2023. Its own site would not load for us; a third-party listing calls its source not verifiable.",
    },
    pay: { zh: "第三方资料称支持微信支付、支付宝、银行转账和信用卡。", en: "Third-party listings report WeChat Pay, Alipay, bank transfer and cards." },
    price: { zh: "约为官方价的 1.5 倍，点数 180 天过期。", en: "About 1.5 times list; points expire after 180 days." },
    watch: { zh: "贵，而且来源不明。", en: "Expensive, with an unknown source." },
  },
  {
    name: "APIVAI、OpenAI-HK",
    tier: "no",
    says: {
      zh: "两家都查不到经营主体、服务条款和 Claude 的来源。",
      en: "For both, no operating company, terms of service or source of Claude could be found.",
    },
    pay: { zh: "支付宝、加密货币等。", en: "Alipay, crypto and similar." },
    price: { zh: "远低于官方价。", en: "Far below list." },
    watch: { zh: "不要用。", en: "Do not use." },
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

        <section className="co-others">
          <h2>{t("其他查过的平台", "Other services we looked into")}</h2>
          <p className="co-note">
            {t(
              "下面每一家，我们都读了它自己的文档和服务条款，看它对地区、付款和数据怎么写。没有一家写明拒绝香港，也没有一家写明欢迎香港。我们一家都没有付费实测过：在香港能不能付款、Claude 能不能用，只有充一小笔、拿密钥测一次才知道。",
              "For each service below we read its own documentation and terms for what it says about regions, payment and data. None says it refuses Hong Kong, and none says it welcomes Hong Kong. We have not paid for or tested any of them: whether a Hong Kong payment goes through and Claude answers is only known by topping up a small amount and testing the key.",
            )}
          </p>
          {(["try", "maybe", "no"] as Tier[]).map((tier) => (
            <div key={tier} className="co-tier">
              <h3>
                <span className={`co-pill co-${TIER[tier].tone}`}>{t(TIER[tier].headZh, TIER[tier].headEn)}</span>
              </h3>
              {OTHERS.filter((x) => x.tier === tier).map((x) => (
                <div key={x.name} className="co-other">
                  <div className="co-other-name">
                    {x.href ? (
                      <a href={x.href} target="_blank" rel="noopener noreferrer">
                        {x.name} ↗
                      </a>
                    ) : (
                      x.name
                    )}
                  </div>
                  <p>{x.says[lang]}</p>
                  <dl>
                    <div>
                      <dt>{t("付款", "Payment")}</dt>
                      <dd>{x.pay[lang]}</dd>
                    </div>
                    <div>
                      <dt>{t("价格", "Price")}</dt>
                      <dd>{x.price[lang]}</dd>
                    </div>
                    <div>
                      <dt>{t("要留意", "Watch for")}</dt>
                      <dd>{x.watch[lang]}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          ))}
          <p className="co-note">
            {t(
              "所有这些平台有一个共同的风险：Anthropic 不向香港提供服务，任何一家都可能像 OpenRouter 那样，某天开始按账单地区拦截，而且不会提前通知。另外，价格低于官方一半的「Claude」很可能不是真的 Claude，或者来自共享账号，不要用。",
              "All of them share one risk: Anthropic does not serve Hong Kong, so any of them may one day start blocking by billing region, as OpenRouter did, without notice. And a Claude priced under half of list is likely not genuine Claude, or comes from shared accounts; do not use it.",
            )}
          </p>
        </section>

        <section className="co-advice">
          <h2>{t("怎么选", "How to choose")}</h2>
          <ul>
            <li>{t("无论选哪一家，先充一小笔，把密钥发给 Ryan。我们用真实请求测 Claude，确认能用再正式接入。", "Whichever you pick, top up a small amount first and send the key to Ryan. We test Claude with real requests and connect it only once it works.")}</li>
            <li>{t("想用支付宝或微信支付：先看 B.AI、AiHubMix、OhMyGPT。", "To pay with Alipay or WeChat Pay: look at B.AI, AiHubMix and OhMyGPT first.")}</li>
            <li>{t("想用信用卡、要知名的公司：先看 Vercel AI Gateway、Requesty。", "To pay by card with a better-known company: look at Vercel AI Gateway and Requesty first.")}</li>
            <li>{t("不要一次充很多。这些平台的规则随时会变。", "Do not top up a large amount at once. Any of these can change its rules at any time.")}</li>
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
