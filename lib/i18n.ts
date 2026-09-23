/**
 * Strings (spec §8: everything externalised, zh is the default, English is a
 * toggle). Keyed by the English string so a missing translation degrades to
 * readable English rather than to a key like `chat.header.title`.
 *
 * The dictionary lives here rather than in a runtime file so it type-checks
 * and ships in the same bundle as the components that use it.
 */
export type Locale = "zh-CN" | "zh-HK" | "en";

export const DEFAULT_LOCALE: Locale = "zh-CN";

const ZH_CN: Record<string, string> = {
  // Shell
  "Chat": "聊天",
  "Files": "文件",
  "Market Research": "市场调研",
  "Script": "剧本",
  "Video Edit": "视频剪辑",
  "Publish": "发布",
  "Accounting": "会计",
  "Finance": "财务",
  "Legal": "法务",
  "HR": "人事",
  "Admin": "管理",
  "Search everything you can read": "搜索你有权查看的内容",
  "Sign out": "退出登录",
  "Settings": "设置",

  // Roles (lib/db/schema/core.ts `user_role`), shown on the account card.
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  guest: "访客",

  "English": "English",
  "Simplified Chinese": "简体中文",
  "Design preview": "设计预览",

  // Login
  "Sign in": "登录",
  "Signing in…": "正在登录…",
  "Email": "邮箱",
  "Password": "密码",
  "Work email": "工作邮箱",
  "That email and password do not match.": "邮箱或密码不正确。",
  "Your account is not active. Ask an admin.": "账号未启用，请联系管理员。",
  "Aura Farmers workspace": "光环农夫工作台",
  "One agent per person. Everything you can see, and nothing you cannot.":
    "每人一个助理。只看你有权看的内容。",

  // Agent / chat
  "Your agent": "你的助理",
  "Ask your agent": "问你的助理",
  "Ask anything about the studio's work": "询问工作室的任何事情",
  "Send": "发送",
  "Stop": "停止",
  "New chat": "新对话",
  "Sources": "来源",
  "Ran": "已执行",
  "This answer may be partial — some matches are outside your access.":
    "此回答可能不完整：部分匹配内容超出你的权限范围。",
  "Thinking…": "思考中…",
  "Channels": "频道",
  "Direct messages": "私信",
  "Message": "发消息",
  "Today": "今天",
  "Yesterday": "昨天",

  // Files
  "Name": "名称",
  "Owner": "所有者",
  "Size": "大小",
  "Modified": "修改时间",
  "Upload": "上传",
  "Uploading": "上传中",
  "New folder": "新建文件夹",
  "Share": "共享",
  "Delete": "删除",
  "Restore": "恢复",
  "Download": "下载",
  "Versions": "版本",
  "Nothing here yet": "这里还没有内容",
  "Nothing you can see here": "这里没有你有权查看的内容",
  "You can share up to": "你最多可以共享",
  "Can edit": "可编辑",
  "Can comment": "可评论",
  "Can view": "可查看",
  "Shared with the studio": "与工作室共享",
  "You cannot share this.": "你无权共享此项。",
  "Shared with": "已共享给",
  until: "有效期至",
  Remove: "移除",

  // Spend
  "AI spend": "AI 支出",
  "of": "／",
  "this period": "本期",
  "No cap set": "未设置上限",
  "Budget reached — the assistant has stopped": "已达预算上限，助理已停止",
};

const DICTS: Partial<Record<Locale, Record<string, string>>> = { "zh-CN": ZH_CN };

export type T = (s: string) => string;

export function makeT(locale: Locale | null | undefined): T {
  const dict = DICTS[locale ?? DEFAULT_LOCALE];
  if (!dict) return (s) => s;
  return (s) => dict[s] ?? s;
}

/** Dates the way each locale writes them. */
export function formatDate(d: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatBytes(n: number, locale: Locale = "en"): string {
  if (!n) return locale === "en" ? "—" : "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Where a person's language is remembered *before* they are signed in.
 *
 * The account's own `locale` is the truth once there is a session — but the
 * sign-in screen has no session, so it fell back to Chinese for everybody and
 * an English-speaking employee had to switch it on every visit. Signing in
 * writes this cookie from the account, so the screen matches the person the
 * next time they see it.
 */
export const LANG_COOKIE = "af-lang";
export const LANG_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
