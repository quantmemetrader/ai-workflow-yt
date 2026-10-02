import "server-only";
import { JOB_OWNER, jobName, type readHome } from "@/lib/home/service";
import { OFFICE_KEYS } from "@/components/office/looks";
import type { OfficeMember } from "@/components/office/text";

/**
 * Each desk's status and line, from the same readHome the board uses; a
 * running job adds what it is ("正在渲染") and how far it has got. 法务,
 * 财务 and the assistant have nothing there, so they show 空闲. Shared by
 * AI 同事 and 首页 (owner, 2 Oct: the office on the home page too).
 */
export function officeMembers(home: Awaited<ReturnType<typeof readHome>>, zh: boolean): OfficeMember[] {
  const byKey = new Map(home.agents.map((a) => [a.key, a]));
  return OFFICE_KEYS.map((key) => {
    if (key === "host") return { key, status: "idle", task: null, line: null, progress: null };
    const a = byKey.get(key);
    const status = a?.status ?? "idle";
    const job = status === "working" ? home.running.find((j) => JOB_OWNER[j.type] === key) : undefined;
    return {
      key,
      status,
      task: job ? jobName(job.type, zh) : null,
      line: a?.line ?? null,
      progress: job && job.status === "running" && job.progress > 0 ? Math.round(Math.min(1, job.progress) * 100) : null,
    };
  });
}
