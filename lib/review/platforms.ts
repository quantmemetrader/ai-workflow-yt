import "server-only";
import { OWN_ACCOUNTS } from "@/lib/social/own-accounts";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { tikhubRequest } from "@/lib/social/tikhub";
import type { OwnAccount } from "@/lib/social/own-accounts";
import { EMPTY_STATS, type AccountPost, type AccountStats, type Stats } from "@/lib/review/types";

/**
 * Reading the studio's own numbers off TikHub — public numbers only, the
 * same reads anybody's profile gives (the owner asked for these accounts to
 * be tracked, 28 Sep). Every call here is billed, so only `lib/review/service`
 * calls these, and only when its cached reading is older than its limit or
 * somebody pressed 刷新.
 *
 * Checked against the live accounts on 28 Sep 2026:
 *   抖音     profile gives followers / total likes / works; the posts list gives
 *            likes, comments, shares, saves — never plays (always 0 publicly)
 *   小红书   user info gives fans / likes+saves / notes; notes give likes, saves,
 *            comments, shares (views 0 publicly)
 *   B站      relation stat → followers, up stat → plays and likes, the posts
 *            list → per-video plays and comments
 *   视频号   the sph id has to be turned into a finder username first; the
 *            lookup is a search and returned somebody else's account for this
 *            id, so a match is only trusted when the nickname is the studio's.
 */

type J = Record<string, unknown>;

/** A number from whatever the platform sent: 123, "123", "1.2万", "3.4w". */
export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/,/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(万|w|W|亿|k|K)?\+?$/);
  if (!m) return null;
  const base = Number(m[1]);
  const mult = m[2] === "万" || m[2] === "w" || m[2] === "W" ? 1e4 : m[2] === "亿" ? 1e8 : m[2] === "k" || m[2] === "K" ? 1e3 : 1;
  return Math.round(base * mult);
}

/** The first value under any of these keys, anywhere in the object (breadth first). */
export function deepFind(obj: unknown, keys: string[], maxNodes = 4000): unknown {
  const queue: unknown[] = [obj];
  let seen = 0;
  while (queue.length && seen < maxNodes) {
    const cur = queue.shift();
    seen += 1;
    if (!cur || typeof cur !== "object") continue;
    if (!Array.isArray(cur)) {
      for (const k of keys) {
        const v = (cur as J)[k];
        if (v !== undefined && v !== null && v !== "") return v;
      }
    }
    for (const v of Array.isArray(cur) ? cur : Object.values(cur as J)) if (v && typeof v === "object") queue.push(v);
  }
  return undefined;
}

const zeroIsUnknown = (n: number | null) => (n === 0 ? null : n);
const iso = (secs: unknown) => {
  const n = num(secs);
  if (!n) return null;
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
};
const clip = (s: unknown, n = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function remember<T>(key: string): Promise<T | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return (row?.value as T) ?? null;
}
async function keep(key: string, value: unknown) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

// ------------------------------------------------------------------ accounts

export type AccountReading = { stats: AccountStats; posts: AccountPost[] };

export class ManualOnly extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ManualOnly";
  }
}

async function douyinSecId(a: OwnAccount): Promise<string> {
  const key = `review:douyin-sec:${a.id}`;
  const cached = await remember<string>(key);
  if (cached) return cached;
  if (!a.url) throw new ManualOnly("没有抖音主页链接");
  const sec = await tikhubRequest<string>("/api/v1/douyin/web/get_sec_user_id", { url: a.url });
  if (typeof sec !== "string" || !sec.startsWith("MS4")) throw new Error("抖音主页链接解析不出账号");
  await keep(key, sec);
  return sec;
}

function douyinPost(a: J): AccountPost {
  const st = (a.statistics ?? {}) as J;
  const id = String(a.aweme_id ?? "");
  return {
    id,
    title: clip(a.desc) || id,
    url: id ? `https://www.douyin.com/video/${id}` : null,
    at: iso(a.create_time),
    stats: { plays: zeroIsUnknown(num(st.play_count)), likes: num(st.digg_count), comments: num(st.comment_count), shares: num(st.share_count), collects: num(st.collect_count) },
  };
}

async function readDouyin(a: OwnAccount): Promise<AccountReading> {
  const sec = await douyinSecId(a);
  const [prof, posts] = await Promise.all([
    tikhubRequest<J>("/api/v1/douyin/web/handler_user_profile", { sec_user_id: sec }),
    tikhubRequest<J>("/api/v1/douyin/app/v3/fetch_user_post_videos", { sec_user_id: sec, count: 12 }).catch(() => ({}) as J),
  ]);
  const u = ((prof.user ?? prof) as J) || {};
  const list = (Array.isArray(posts.aweme_list) ? (posts.aweme_list as J[]) : []).map(douyinPost);
  return {
    stats: { followers: num(u.follower_count), likes: num(u.total_favorited), works: num(u.aweme_count), views: null },
    posts: list.sort((x, y) => (y.at ?? "").localeCompare(x.at ?? "")).slice(0, 10),
  };
}

function xhsPost(n: J): AccountPost {
  const id = String(n.id ?? n.note_id ?? "");
  return {
    id,
    title: clip(n.display_title || n.title || n.desc) || id,
    url: id ? `https://www.xiaohongshu.com/explore/${id}` : null,
    at: iso(n.create_time ?? n.timestamp),
    stats: {
      plays: zeroIsUnknown(num(n.view_count)),
      likes: num(n.likes ?? n.liked_count),
      comments: num(n.comments_count ?? n.comment_count),
      shares: num(n.share_count ?? n.shared_count),
      collects: num(n.collected_count),
    },
  };
}

async function readXhs(a: OwnAccount): Promise<AccountReading> {
  const key = `review:xhs-user:${a.id}`;
  let userId = await remember<string>(key);
  const info = await tikhubRequest<J>("/api/v1/xiaohongshu/app_v2/get_user_info", userId ? { user_id: userId } : { share_text: a.url ?? "" });
  const d = ((info.data ?? info) as J) || {};
  if (!userId && typeof d.userid === "string") {
    userId = d.userid;
    await keep(key, userId);
  }
  const stat = (d.note_num_stat ?? {}) as J;
  const inter = Array.isArray(d.interactions) ? (d.interactions as J[]) : [];
  const likesAndSaves = num(inter.find((i) => i.type === "interaction")?.count);
  const notes = userId ? await tikhubRequest<J>("/api/v1/xiaohongshu/app_v2/get_user_posted_notes", { user_id: userId }).catch(() => ({}) as J) : ({} as J);
  const nd = ((notes.data ?? notes) as J) || {};
  const list = (Array.isArray(nd.notes) ? (nd.notes as J[]) : []).map(xhsPost);
  return {
    stats: { followers: num(d.fans), likes: likesAndSaves ?? num(stat.liked), works: num(stat.posted ?? d.ndiscovery), views: null },
    posts: list.sort((x, y) => (y.at ?? "").localeCompare(x.at ?? "")).slice(0, 10),
  };
}

function biliPost(v: J): AccountPost {
  const bv = String(v.bvid ?? "");
  return {
    id: bv,
    title: clip(v.title) || bv,
    url: bv ? `https://www.bilibili.com/video/${bv}` : null,
    at: iso(v.created),
    stats: { plays: num(v.play), likes: null, comments: num(v.comment), shares: null, collects: null },
  };
}

async function readBilibili(a: OwnAccount): Promise<AccountReading> {
  const [rel, up, posts] = await Promise.all([
    tikhubRequest<J>("/api/v1/bilibili/web/fetch_user_relation_stat", { uid: a.id }),
    tikhubRequest<J>("/api/v1/bilibili/web/fetch_user_up_stat", { uid: a.id }),
    tikhubRequest<J>("/api/v1/bilibili/web/fetch_user_post_videos", { uid: a.id, ps: 10, order: "pubdate" }).catch(() => ({}) as J),
  ]);
  const inner = (x: J) => ((x.data && typeof x.data === "object" && !Array.isArray(x.data) ? x.data : x) as J);
  const r = inner(rel);
  const u = inner(up);
  const p = inner(posts);
  const list = ((p.list as J | undefined)?.vlist as J[] | undefined) ?? [];
  return {
    stats: { followers: num(r.follower), likes: num(u.likes), works: num((p.page as J | undefined)?.count), views: num((u.archive as J | undefined)?.view) },
    posts: list.map(biliPost).slice(0, 10),
  };
}

async function wechatUsername(a: OwnAccount): Promise<string> {
  const key = `review:wx-username:${a.id}`;
  const cached = await remember<{ username: string | null; checkedAt: string }>(key);
  if (cached?.username) return cached.username;
  if (cached && Date.now() - Date.parse(cached.checkedAt) < 7 * 86400_000) throw new ManualOnly("视频号暂时读不到，请手动填写");
  const r = await tikhubRequest<J>("/api/v1/wechat_channels/v2/fetch_channel_id_to_username", {}, { channel_id: a.id, raw: false }).catch(() => ({}) as J);
  const nick = String(r.nickname ?? "");
  /* The lookup is a search: it answers with *an* account. Only one named like ours is ours. */
  const ours = a.name.split(/[-·\s]/).filter((s) => s.length >= 2);
  const username = typeof r.username === "string" && ours.some((s) => nick.includes(s)) ? r.username : null;
  await keep(key, { username, checkedAt: new Date().toISOString() });
  if (!username) throw new ManualOnly("视频号暂时读不到，请手动填写");
  return username;
}

async function readWechat(a: OwnAccount): Promise<AccountReading> {
  const username = await wechatUsername(a);
  const [prof, vids] = await Promise.all([
    tikhubRequest<J>("/api/v1/wechat_channels/v2/fetch_user_profile", {}, { username, raw: false }),
    tikhubRequest<J>("/api/v1/wechat_channels/v2/fetch_user_videos", {}, { username, raw: false }).catch(() => ({}) as J),
  ]);
  const list = (Array.isArray(vids.videos) ? (vids.videos as J[]) : []).map((v) => ({
    id: String(v.id ?? ""),
    title: clip(v.title) || String(v.id ?? ""),
    url: null,
    at: iso(v.create_time),
    stats: { plays: zeroIsUnknown(num(v.read_count)), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.forward_count), collects: num(v.fav_count) },
  }));
  return {
    stats: { followers: zeroIsUnknown(num(prof.fans_count)), likes: num(prof.like_count), works: num(prof.feeds_count), views: null },
    posts: list.slice(0, 10),
  };
}

export async function readAccount(a: OwnAccount): Promise<AccountReading> {
  switch (a.platform) {
    case "douyin":
      return readDouyin(a);
    case "xiaohongshu":
      return readXhs(a);
    case "bilibili":
      return readBilibili(a);
    case "wechat_channels":
      return readWechat(a);
  }
}

// ------------------------------------------------------------------ one post

/** The id a post link carries, per platform, for matching against an account's latest posts. */
export async function postIdOf(platform: string, url: string): Promise<string | null> {
  let u = url;
  if (/b23\.tv|xhslink\.|v\.douyin\.com/.test(url)) {
    try {
      const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      u = r.headers.get("location") ?? url;
    } catch {
      /* the short link stays as it is */
    }
  }
  if (platform === "douyin") return u.match(/(?:video|note)\/(\d{8,})/)?.[1] ?? null;
  if (platform === "xiaohongshu") return u.match(/(?:explore|item|discovery\/item)\/([0-9a-f]{24})/)?.[1] ?? null;
  if (platform === "bilibili") return u.match(/(BV[0-9A-Za-z]{10})/)?.[1] ?? null;
  return null;
}

export type PostReading = { title: string | null; stats: Stats };

export async function readPost(platform: string, url: string): Promise<PostReading> {
  if (platform === "douyin") {
    const d = await tikhubRequest<J>("/api/v1/douyin/app/v3/fetch_one_video_by_share_url", { share_url: url });
    const a = ((d.aweme_detail ?? deepFind(d, ["aweme_detail"]) ?? d) as J) || {};
    const p = douyinPost(a);
    return { title: p.title, stats: p.stats };
  }
  if (platform === "xiaohongshu") {
    const d = await tikhubRequest<J>("/api/v1/xiaohongshu/app_v2/get_video_note_detail", { share_text: url });
    const f = (k: string[]) => num(deepFind(d, k));
    return {
      title: clip(deepFind(d, ["display_title", "title", "desc"])) || null,
      stats: { plays: zeroIsUnknown(f(["view_count", "viewed_count"])), likes: f(["liked_count", "likes"]), comments: f(["comments_count", "comment_count"]), shares: f(["shared_count", "share_count"]), collects: f(["collected_count"]) },
    };
  }
  if (platform === "bilibili") {
    const bv = await postIdOf("bilibili", url);
    if (!bv) throw new Error("链接里找不到 BV 号");
    const d = await tikhubRequest<J>("/api/v1/bilibili/web/fetch_one_video", { bv_id: bv });
    const v = ((d.data && typeof d.data === "object" ? d.data : d) as J) || {};
    const st = (v.stat ?? deepFind(d, ["stat"]) ?? {}) as J;
    return { title: clip(v.title) || null, stats: { plays: num(st.view), likes: num(st.like), comments: num(st.reply), shares: num(st.share), collects: num(st.favorite) } };
  }
  if (platform === "shipinhao") {
    const d = await tikhubRequest<J>("/api/v1/wechat_channels/v2/fetch_video_detail", {}, { share_url: url, raw: false });
    /* The video's author is our own account: its finder username unlocks the
       account's profile and video list, which the channel-id lookup could not
       (it answered with somebody else's account). Remembered for the tile. */
    try {
      const username = String(deepFind(d, ["username", "finder_username", "author_username", "finderUsername"]) ?? "");
      const nick = String(deepFind(d, ["nickname", "author_nickname", "author_name", "nick_name"]) ?? "");
      const own = OWN_ACCOUNTS.find((a) => a.platform === "wechat_channels");
      if (own && /^v2_[0-9a-fA-F]+@finder$/.test(username) && own.name.split(/[-·\s]/).filter((x) => x.length >= 2).some((x) => nick.includes(x))) {
        await keep(`review:wx-username:${own.id}`, { username, checkedAt: new Date().toISOString() });
      }
    } catch {
      /* the reading itself is what matters */
    }
    return {
      title: clip(d.title) || null,
      stats: { plays: zeroIsUnknown(num(d.read_count)), likes: num(d.like_count), comments: num(d.comment_count), shares: num(d.forward_count), collects: num(d.fav_count) },
    };
  }
  throw new ManualOnly("这个平台读不到数据，请手动填写");
}

export const READABLE_POST_PLATFORMS = new Set(["douyin", "xiaohongshu", "bilibili", "shipinhao"]);
export { EMPTY_STATS };
