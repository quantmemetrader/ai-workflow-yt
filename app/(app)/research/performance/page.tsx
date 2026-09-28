import { redirect } from "next/navigation";

/** 内容表现 moved to 作品复盘 → 已连接渠道 (the review comes after publishing, not inside trend research). */
export default async function OldPerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (typeof v === "string") q.set(k, v);
  const s = q.toString();
  redirect(s ? `/review/channels?${s}` : "/review/channels");
}
