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
export type AgentKey = "research" | "planning" | "script" | "video" | "article";

/** In the order the picker lists them, which is the order the work goes in:
 * find out, decide, write, cut, and write it up. */
export const AGENT_KEYS = ["research", "planning", "script", "video", "article"] as const satisfies readonly AgentKey[];

export type AgentLabel = {
  name: string;
  nameLocal: string;
  /** What the message list prints beside the name, so "who is this" is
   * answered without clicking anything. */
  title: string;
  titleEn: string;
  /** One line on what to tag it for, shown in the picker. */
  hint: string;
  hintEn: string;
};

export const AGENT_LABELS: Record<AgentKey, AgentLabel> = {
  research: {
    name: "Research agent",
    nameLocal: "研究员",
    title: "AI 员工 · 研究",
    titleEn: "AI employee · Research",
    hint: "趋势、选题、对标账号、每日晨报",
    hintEn: "Trends, topics, channels to watch, the morning brief",
  },
  planning: {
    name: "Planning agent",
    nameLocal: "策划",
    title: "AI 员工 · 策划",
    titleEn: "AI employee · Planning",
    hint: "把调研变成计划：今日待办、选题决定、派活",
    hintEn: "Turns research into a plan: today's to-dos, topic picks, who does what",
  },
  script: {
    name: "Script agent",
    nameLocal: "编剧",
    title: "AI 员工 · 脚本",
    titleEn: "AI employee · Script",
    hint: "写脚本、改脚本、审批前的检查",
    hintEn: "Writing, rewriting and checking a 脚本",
  },
  video: {
    name: "Video agent",
    nameLocal: "剪辑师",
    title: "AI 员工 · 视频",
    titleEn: "AI employee · Video",
    hint: "粗剪、字幕、图形、渲染",
    hintEn: "First cut, subtitles, graphics, renders",
  },
  article: {
    name: "Article agent",
    nameLocal: "撰稿人",
    title: "AI 员工 · 文章",
    titleEn: "AI employee · Writing",
    hint: "长文、发布记录、按平台改写",
    hintEn: "Long-form, publishing logs, rewriting per platform",
  },
};

/**
 * The colour that follows each employee around: its icon, its stage on the
 * strip, its node in the flow, the dot beside its name. Five hues far enough
 * apart to be told at a glance, none of them the blue the product uses for
 * links.
 */
export const AGENT_COLORS: Record<AgentKey, string> = {
  research: "#0f5bd5",
  planning: "#6a3fc4",
  script: "#b3420e",
  video: "#0b7a63",
  article: "#9d1d52",
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
  script: ["编剧", "脚本助理", "脚本", "scriptagent", "script", "writer"],
  video: ["剪辑师", "视频助理", "剪辑", "视频", "videoagent", "video", "editor"],
  article: ["撰稿人", "文章助理", "撰稿", "文章", "articleagent", "article"],
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
