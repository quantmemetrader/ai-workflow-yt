/**
 * What each platform accepts, and the extras it asks for.
 *
 * Its own file rather than a constant in `service.ts`: the picker and the
 * composer that draw this are client components, and `service.ts` is
 * `server-only`. A value imported from there would pull the database client
 * into the browser bundle and fail the build; a type imported from there is
 * erased and does not.
 *
 * **Why these numbers are here and not the vendor's.** Zernio publishes
 * `/v1/tools/validate/post`, and it answers `{"valid": true}` for 3,200
 * characters on LinkedIn (limit 3,000) and on X (limit 280) — verified
 * against the live endpoint. A validator that passes everything is worse than
 * none, because it looks like a check. So the studio keeps its own numbers and
 * calls the vendor's as a *second* opinion that can add findings and never
 * clear ours.
 *
 * These are the platforms' published limits and they change. They are here to
 * catch a mistake before a post is queued, not to be the last word — the
 * platform itself is that, at send time, and whatever it says is kept intact
 * in the publish log.
 */
export const CONNECTABLE = [
  "youtube",
  "tiktok",
  "instagram",
  "linkedin",
  "facebook",
  "x",
  "threads",
  "pinterest",
] as const;

/** One extra a platform asks for, and how the composer should draw it. */
export type PlatformField = {
  key: string;
  label: string;
  labelZh: string;
  kind: "text" | "select" | "toggle";
  /** For `select`. The first is the default. */
  options?: { value: string; label: string; labelZh: string }[];
  placeholder?: string;
  max?: number;
  /** Why it exists, in the words somebody filling it in would want. */
  note?: string;
  noteZh?: string;
};

export type PlatformSpec = {
  key: string;
  name: string;
  /** Characters the body may be. The one limit every platform has. */
  bodyMax: number;
  /** Characters the title may be, where a platform has titles at all. */
  titleMax?: number;
  /** Hashtags the platform counts rather than ignores. */
  tagMax?: number;
  fields: PlatformField[];
};

export const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  youtube: {
    key: "youtube",
    name: "YouTube",
    titleMax: 100,
    bodyMax: 5000,
    tagMax: 500,
    fields: [
      {
        key: "categoryId",
        label: "Category",
        labelZh: "分类",
        kind: "select",
        options: [
          { value: "28", label: "Science & Technology", labelZh: "科学与技术" },
          { value: "22", label: "People & Blogs", labelZh: "人物与博客" },
          { value: "24", label: "Entertainment", labelZh: "娱乐" },
          { value: "27", label: "Education", labelZh: "教育" },
          { value: "25", label: "News & Politics", labelZh: "新闻与政治" },
          { value: "26", label: "Howto & Style", labelZh: "教程与风格" },
        ],
      },
      {
        key: "privacyStatus",
        label: "Visibility",
        labelZh: "可见性",
        kind: "select",
        options: [
          { value: "public", label: "Public", labelZh: "公开" },
          { value: "unlisted", label: "Unlisted", labelZh: "不公开列出" },
          { value: "private", label: "Private", labelZh: "私享" },
        ],
      },
      {
        key: "madeForKids",
        label: "Made for kids",
        labelZh: "面向儿童",
        kind: "toggle",
        note: "YouTube requires an answer on every upload, and gets it wrong by default more often than not.",
        noteZh: "YouTube 每次上传都必须回答这一项，默认值经常是错的。",
      },
    ],
  },
  instagram: {
    key: "instagram",
    name: "Instagram",
    bodyMax: 2200,
    tagMax: 30,
    fields: [
      {
        key: "firstComment",
        label: "First comment",
        labelZh: "首条评论",
        kind: "text",
        max: 2200,
        placeholder: "#hashtags, links, credits",
        note: "Posted straight after. Where hashtags go if you want them out of the caption.",
        noteZh: "发布后立即评论。想把话题标签移出正文时放这里。",
      },
    ],
  },
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    bodyMax: 2200,
    fields: [
      {
        key: "privacyLevel",
        label: "Who can see it",
        labelZh: "可见范围",
        kind: "select",
        options: [
          { value: "PUBLIC_TO_EVERYONE", label: "Everyone", labelZh: "所有人" },
          { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends", labelZh: "好友" },
          { value: "SELF_ONLY", label: "Only me", labelZh: "仅自己" },
        ],
      },
      { key: "disableComment", label: "Turn comments off", labelZh: "关闭评论", kind: "toggle" },
      { key: "disableDuet", label: "Turn duets off", labelZh: "关闭合拍", kind: "toggle" },
      { key: "disableStitch", label: "Turn stitch off", labelZh: "关闭拼接", kind: "toggle" },
    ],
  },
  linkedin: {
    key: "linkedin",
    name: "LinkedIn",
    bodyMax: 3000,
    fields: [
      {
        key: "visibility",
        label: "Visibility",
        labelZh: "可见性",
        kind: "select",
        options: [
          { value: "PUBLIC", label: "Anyone", labelZh: "所有人" },
          { value: "CONNECTIONS", label: "Connections only", labelZh: "仅人脉" },
        ],
      },
    ],
  },
  facebook: { key: "facebook", name: "Facebook", bodyMax: 63206, fields: [] },
  x: {
    key: "x",
    name: "X",
    bodyMax: 280,
    fields: [],
  },
  threads: { key: "threads", name: "Threads", bodyMax: 500, fields: [] },
  pinterest: {
    key: "pinterest",
    name: "Pinterest",
    titleMax: 100,
    bodyMax: 800,
    fields: [
      {
        key: "link",
        label: "Destination link",
        labelZh: "目标链接",
        kind: "text",
        max: 2048,
        placeholder: "https://",
        note: "Where the pin sends people. Without it a pin is a picture.",
        noteZh: "别人点开会去哪里。没有它，Pin 就只是一张图。",
      },
    ],
  },
};

export const specFor = (platform: string): PlatformSpec | null =>
  PLATFORM_SPECS[platform.trim().toLowerCase()] ?? null;

export type PlatformIssue = {
  /** `error` stops an approval; `warning` is said and allowed. */
  level: "error" | "warning";
  text: string;
  textZh: string;
};

/**
 * What this platform would refuse, checked before anybody approves it.
 *
 * Length is a hard error: a post 400 characters over X's limit is not going to
 * be published and putting it in the queue only delays finding that out.
 * Everything else is a warning, because a platform's own rules change faster
 * than any list of them and a product that blocks on a stale rule is a product
 * people work around.
 */
export function checkForPlatform(
  platform: string,
  input: { title?: string | null; body: string; tags?: string[] },
): PlatformIssue[] {
  const spec = specFor(platform);
  if (!spec) return [];

  const issues: PlatformIssue[] = [];
  const body = input.body ?? "";

  if (body.length > spec.bodyMax) {
    const over = body.length - spec.bodyMax;
    issues.push({
      level: "error",
      text: `${spec.name} allows ${spec.bodyMax.toLocaleString()} characters; this is ${over.toLocaleString()} over.`,
      textZh: `${spec.name} 最多 ${spec.bodyMax.toLocaleString()} 字符，现在超出 ${over.toLocaleString()}。`,
    });
  }

  if (spec.titleMax && input.title && input.title.length > spec.titleMax) {
    issues.push({
      level: "error",
      text: `${spec.name} titles stop at ${spec.titleMax} characters; this one is ${input.title.length}.`,
      textZh: `${spec.name} 标题最多 ${spec.titleMax} 字符，现在是 ${input.title.length}。`,
    });
  }

  if (spec.key === "instagram" && (input.tags?.length ?? 0) > 30) {
    issues.push({
      level: "warning",
      text: "Instagram counts the first 30 hashtags and ignores the rest.",
      textZh: "Instagram 只计前 30 个话题标签，其余会被忽略。",
    });
  }

  if (spec.key === "x" && body.length > 240 && body.length <= spec.bodyMax) {
    issues.push({
      level: "warning",
      text: "Close to X's 280. A link shortens to 23 characters whatever its length, which is not counted here.",
      textZh: "接近 X 的 280 上限。链接无论多长都按 23 字符计，这里没有计入。",
    });
  }

  if (body.trim().length === 0) {
    issues.push({
      level: "error",
      text: `Nothing to publish to ${spec.name}.`,
      textZh: `没有要发布到 ${spec.name} 的内容。`,
    });
  }

  return issues;
}
