import { agentOverride } from "./names";
/**
 * Who the AI employees are, in a form the browser is allowed to hold.
 *
 * `lib/agents/index.ts` is `server-only` — it makes user rows, grants
 * entitlements and posts as them. None of that belongs in a bundle, but the
 * composer's @-picker has to be able to *name* the three of them, and the
 * message list has to be able to tell an agent's words from a person's. So the
 * names, the roles and the rule for reading a tag live here, where both sides
 * can import them, and the server file builds its definitions on top.
 *
 * The Chinese name is the real one: the studio works in Chinese and tags
 * `@视频助理`, not `@Video agent`. The English forms are aliases so a message
 * typed on an English keyboard still reaches the right employee.
 */
export type AgentKey = "research" | "planning" | "script" | "video" | "article" | "legal" | "finance";

/** In the order the picker lists them, which is the order the work goes in:
 * find out, decide, write, cut, and write it up — then the two who look after
 * the studio rather than the film, 法务 and 财务. */
export const AGENT_KEYS = [
  "research",
  "planning",
  "script",
  "video",
  "article",
  "legal",
  "finance",
] as const satisfies readonly AgentKey[];

/**
 * The five who make the videos: a topic found, planned, written, cut and
 * published. Home's job tabs, a person's work role, the morning plan and the
 * automations are about this line and nobody else.
 *
 * Listed rather than read off `AGENT_KEYS`, because 法务 and 财务 are
 * colleagues in chat and are not a step of a video: a Home tab for 财务 with
 * "videos in hand", or the morning plan handing 法务 a script, would be the
 * roster leaking into the pipeline.
 */
export const PRODUCTION_KEYS = ["research", "planning", "script", "video", "article"] as const satisfies readonly AgentKey[];
export type ProductionKey = (typeof PRODUCTION_KEYS)[number];

export const isProductionKey = (value: unknown): value is ProductionKey =>
  typeof value === "string" && (PRODUCTION_KEYS as readonly string[]).includes(value);

export type AgentLabel = {
  name: string;
  nameLocal: string;
  /** The name as a person would say it in English — "Researcher", not
   *  "Research agent". What `<AgentName>` shows beside the Chinese when
   *  Chrome translates the page (components/ui/Tr.tsx), and what the English
   *  UI prints where an employee is named. */
  nameEn: string;
  /** What the message list prints beside the name, so "who is this" is
   * answered without clicking anything. */
  title: string;
  titleEn: string;
  /** One line on what to tag it for, shown in the picker. */
  hint: string;
  hintEn: string;
};

/** The built-in names and lines; what the studio renamed reads through `AGENT_LABELS` below. */
export const AGENT_DEFAULT_LABELS: Record<AgentKey, AgentLabel> = {
  research: {
    name: "Research agent",
    nameLocal: "研究员",
    nameEn: "Researcher",
    title: "AI 员工 · 研究",
    titleEn: "AI employee · Research",
    hint: "趋势、选题、对标账号、每日晨报",
    hintEn: "Trends, topics, channels to watch, the morning brief",
  },
  planning: {
    name: "Planning agent",
    nameLocal: "策划",
    nameEn: "Planner",
    title: "AI 员工 · 策划",
    titleEn: "AI employee · Planning",
    hint: "把调研变成计划：今日待办、选题决定、派活",
    hintEn: "Turns research into a plan: today's to-dos, topic picks, who does what",
  },
  script: {
    name: "Script agent",
    nameLocal: "文案",
    nameEn: "Scriptwriter",
    title: "AI 员工 · 脚本",
    titleEn: "AI employee · Script",
    hint: "写脚本、改脚本、审批前的检查",
    hintEn: "Writing, rewriting and checking a 脚本",
  },
  video: {
    name: "Video agent",
    nameLocal: "剪辑师",
    nameEn: "Editor",
    title: "AI 员工 · 视频",
    titleEn: "AI employee · Video",
    hint: "粗剪、字幕、图形、渲染",
    hintEn: "First cut, subtitles, graphics, renders",
  },
  article: {
    name: "Article agent",
    nameLocal: "撰稿人",
    nameEn: "Writer",
    title: "AI 员工 · 文章",
    titleEn: "AI employee · Writing",
    hint: "长文、发布记录、按平台改写",
    hintEn: "Long-form, publishing logs, rewriting per platform",
  },
  legal: {
    name: "Legal agent",
    nameLocal: "法务",
    nameEn: "Legal",
    title: "AI 员工 · 法务",
    titleEn: "AI employee · Legal",
    hint: "合同起草、合同审阅、合规清单",
    hintEn: "Drafting contracts, comparing them to the template, compliance checklists",
  },
  finance: {
    name: "Finance agent",
    nameLocal: "财务",
    nameEn: "Finance",
    title: "AI 员工 · 财务",
    titleEn: "AI employee · Finance",
    hint: "预算、支出审批、财务报表",
    hintEn: "Budget against actuals, spend requests, the monthly report",
  },
};

/**
 * The labels every screen, prompt and @mention use. Each name and hint reads
 * the studio's own choice first (`lib/agents/names.ts`, set on AI 同事 › 训练),
 * then the built-in one, so a rename lands everywhere at once.
 */
export const AGENT_LABELS: Record<AgentKey, AgentLabel> = Object.fromEntries(
  AGENT_KEYS.map((key) => {
    const base = AGENT_DEFAULT_LABELS[key];
    const label: AgentLabel = {
      name: base.name,
      get nameLocal() {
        return agentOverride(key).zh ?? base.nameLocal;
      },
      get nameEn() {
        return agentOverride(key).en ?? base.nameEn;
      },
      title: base.title,
      titleEn: base.titleEn,
      get hint() {
        return agentOverride(key).hint ?? base.hint;
      },
      get hintEn() {
        return agentOverride(key).hintEn ?? base.hintEn;
      },
    };
    return [key, label];
  }),
) as Record<AgentKey, AgentLabel>;

/**
 * The colour that follows each employee around: its icon, its stage on the
 * strip, its node in the flow, the dot beside its name. Hues far enough
 * apart to be told at a glance, none of them the blue the product uses for
 * links. 法务 is brass and 财务 a leaf green: the orange and the teal are the
 * nearest, and both sit well clear of them in hue and in weight.
 */
export const AGENT_COLORS: Record<AgentKey, string> = {
  research: "#0f5bd5",
  planning: "#6a3fc4",
  script: "#b3420e",
  video: "#0b7a63",
  article: "#9d1d52",
  legal: "#7a5a0c",
  finance: "#3b7a16",
};

/**
 * The light version of each colour, for the square behind an employee's
 * mark: the studio's palette, steps 3–4 (blue, violet, orange, teal, pink,
 * brass, green). The glyph is drawn in the full colour on top.
 */
export const AGENT_TINTS: Record<AgentKey, string> = {
  research: "#d5e7fb",
  planning: "#dcd6fb",
  script: "#f8dcc6",
  video: "#c3e6e0",
  article: "#f5d4e6",
  legal: "#f1e5c0",
  finance: "#d9edca",
};

/** Which employee an agent user is, from the address every agent row has. */
export function agentKeyFromEmail(email: string | null | undefined): AgentKey | null {
  if (!email) return null;
  const key = email.split("@")[0];
  return AGENT_KEYS.includes(key as AgentKey) && email.endsWith("@agents.invalid") ? (key as AgentKey) : null;
}

/** How an agent is written when it is tagged in a message. */
export const agentTag = (key: AgentKey): string => `@${AGENT_LABELS[key].nameLocal}`;

/**
 * Everything that counts as tagging one of them.
 *
 * Chinese is matched as a *prefix* further down, because Chinese has no spaces:
 * `@视频助理帮我看看` is one run of characters and the tag is only the first
 * four of them. Latin aliases are matched whole, with `-` and `_` ignored, so
 * `@video-agent`, `@VideoAgent` and `@video` all arrive at the same employee.
 */
const ALIASES: Record<AgentKey, string[]> = {
  /* The first entry is the tag the picker writes. The rest are what somebody
     might type instead — including the names these five had before the studio
     renamed them, because those are in messages already and a tag that stops
     routing is a colleague who stopped answering. */
  research: ["研究员", "研究助理", "调研助理", "研究", "调研", "researchagent", "research"],
  planning: ["策划", "策划助理", "企划", "planningagent", "planning", "planner"],
  script: ["文案", "编剧", "脚本助理", "脚本", "scriptagent", "script", "writer"],
  video: ["剪辑师", "视频助理", "剪辑", "视频", "videoagent", "video", "editor"],
  article: ["撰稿人", "文章助理", "撰稿", "文章", "articleagent", "article"],
  /* No bare "法律" or "合同", and no "lawyer": a Chinese alias matches as a
     prefix, so `@合同…` would tag 法务 from any sentence that starts with the
     word, and 法务 is not a lawyer and must not answer to being one. */
  legal: ["法务", "法务助理", "legalagent", "legal"],
  finance: ["财务", "财务助理", "会计", "financeagent", "finance"],
};

/** Every name an employee answers to — the picker searches all of them, so
 *  `@r`, `@研`, `@edit` and `@剪` all find the same colleague. */
export const agentAliases = (key: AgentKey): string[] => [...ALIASES[key]];

/** Latin aliases, longest first, so `videoagent` is not read as `video`. */
const LATIN: { key: AgentKey; alias: string }[] = AGENT_KEYS.flatMap((key) =>
  ALIASES[key].filter((a) => /^[a-z]+$/.test(a)).map((alias) => ({ key, alias })),
).sort((a, b) => b.alias.length - a.alias.length);

/** Chinese aliases, longest first, for the same reason: `视频助理` before `视频`. */
const HAN: { key: AgentKey; alias: string }[] = AGENT_KEYS.flatMap((key) =>
  ALIASES[key].filter((a) => !/^[a-z]+$/.test(a)).map((alias) => ({ key, alias })),
).sort((a, b) => b.alias.length - a.alias.length);

/** A run of characters that can follow an `@`. Matches the pill the message
 * list draws, so what is highlighted and what is routed are the same thing. */
const TOKEN = /@([A-Za-z0-9_一-鿿-]+)/g;

/**
 * What may sit immediately before a tag.
 *
 * Without this, `bob@video.com` tags the video agent — which is not a typo
 * anybody would notice until an AI employee answered an email address. A tag
 * starts a word: the beginning of the message, a space, or the punctuation
 * Chinese writes instead of one.
 *
 * Written as a test on the preceding character rather than a lookbehind,
 * because a lookbehind is a *parse* error on an old Safari and would take the
 * whole chat bundle down rather than one message's pills.
 */
const BEFORE_TAG = /[\s(（【「『《,，。、;；:：!！?？~～]/;

export const isTagStart = (body: string, at: number): boolean =>
  at === 0 || BEFORE_TAG.test(body[at - 1] ?? "");

/** The agent one `@…` token addresses, or null if it names a person. */
export function agentFromTag(token: string): AgentKey | null {
  /* The studio's own names first (AI 同事 › 训练): "@小文" reaches whoever was renamed 小文. */
  const flatTok = token.toLowerCase().replace(/[-_]/g, "");
  for (const key of AGENT_KEYS) {
    const o = agentOverride(key);
    if (o.zh && token.startsWith(o.zh)) return key;
    if (o.en && flatTok === o.en.toLowerCase().replace(/[-_\s]/g, "")) return key;
  }
  const han = HAN.find((a) => token.startsWith(a.alias));
  if (han) return han.key;

  const flat = token.toLowerCase().replace(/[-_]/g, "");
  return LATIN.find((a) => a.alias === flat)?.key ?? null;
}

/**
 * Which agents a message tags, in the order they were tagged and without
 * repeats — so `@视频助理 @视频助理` is one hand-off, not two.
 */
export function parseAgentMentions(body: string): AgentKey[] {
  const found: AgentKey[] = [];
  for (const m of body.matchAll(TOKEN)) {
    if (!isTagStart(body, m.index ?? 0)) continue;
    const key = agentFromTag(m[1]);
    if (key && !found.includes(key)) found.push(key);
  }
  return found;
}

/** Splits a message into its plain runs and its `@…` tags, for rendering.
 * An agent's tag is drawn differently from a person's, which is the whole
 * point of knowing which is which. */
export function splitMentions(body: string): { text: string; agent: AgentKey | null; isTag: boolean }[] {
  const parts: { text: string; agent: AgentKey | null; isTag: boolean }[] = [];
  let at = 0;
  for (const m of body.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > at) parts.push({ text: body.slice(at, start), agent: null, isTag: false });

    const token = m[1];
    const key = isTagStart(body, start) ? agentFromTag(token) : null;
    if (key) {
      // Only the alias is the tag; `@视频助理帮我看看` pills the first four
      // characters and leaves the sentence alone.
      const alias = ALIASES[key].find((a) => token.startsWith(a)) ?? token;
      parts.push({ text: `@${alias}`, agent: key, isTag: true });
      const rest = token.slice(alias.length);
      if (rest) parts.push({ text: rest, agent: null, isTag: false });
    } else {
      // A person's tag, or an `@` mid-word like an email address: pilled only
      // when it actually starts one.
      parts.push({ text: m[0], agent: null, isTag: isTagStart(body, start) });
    }
    at = start + m[0].length;
  }
  if (at < body.length) parts.push({ text: body.slice(at), agent: null, isTag: false });
  return parts;
}

/**
 * The employee whose screen it is: the assistant panel on a Research screen
 * answers as 研究员, on Script as 编剧, on Video as 剪辑师, on Publish as 撰稿人.
 * Screens not listed (Home, Chat, the business modules) keep the personal
 * assistant, who acts as the person.
 */
export const SCREEN_AGENT: Record<string, AgentKey> = {
  research: "research",
  script: "script",
  article: "article",
  video: "video",
  publish: "article",
};

/** The same, from a path such as "/research/inbox" or "/video". */
export function screenAgentForPath(pathname: string): AgentKey | null {
  const seg = pathname.split("/")[1] ?? "";
  return SCREEN_AGENT[seg] ?? null;
}
