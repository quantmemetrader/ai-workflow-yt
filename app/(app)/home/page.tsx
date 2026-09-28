import { requireModule } from "@/lib/auth/dal";
import { HomeToday } from "@/components/home/HomeToday";
import { readToday } from "@/lib/home/today";

export const metadata = { title: "首页 · Home" };

/**
 * 首页: what is waiting on you, a box to start a new video, the videos under
 * way. Rebuilt on 28 Sep for people who are not technical — the role tabs,
 * suggestion strips, idea lists, chat feed, colleagues and job queue that
 * used to share this page each have their own page now (选题, 消息, AI 员工).
 */
export default async function HomePage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const today = await readToday(viewer, zh);
  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", background: "#f6f5f2" }}>
      <HomeToday zh={zh} me={(zh && viewer.nameLocal) || viewer.name} greeting={greeting(zh)} today={today} />
    </div>
  );
}

function greeting(zh: boolean): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", hour12: false }).format(new Date()));
  if (zh) return hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return hour < 11 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
