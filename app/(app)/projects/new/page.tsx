import { requireModule } from "@/lib/auth/dal";
import { StartProject } from "@/components/projects/StartProject";
import { resolveTopicRef } from "@/lib/projects/service";
import { briefText, evidenceLine } from "@/lib/projects/topic";

export const metadata = { title: "新项目 · New project" };

/**
 * A project from a link: `/projects/new?title=…&brief=…&from=…`, or from a
 * morning-brief card, `/projects/new?signal=<n>&date=<YYYY-MM-DD>`.
 *
 * For the places that can only link (a button under a chat message, the
 * morning brief): it shows what the project will be and starts it on one
 * press, never on the page load, so a link opened twice makes one project.
 *
 * A signal is read by its brief's date: an index alone pointed into
 * whichever brief was newest, so yesterday's card opened today's signal.
 * Links from before the date was added still work, against the latest brief.
 */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ title?: string; brief?: string; from?: string; ask?: string; signal?: string; date?: string }> }) {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const q = await searchParams;
  const canWrite = viewer.modules.includes("script");
  if (q.signal !== undefined && /^\d{1,2}$/.test(q.signal)) {
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : null;
    const found = await resolveTopicRef(viewer, { kind: "signal", date, index: Number(q.signal) }).catch(() => null);
    if (found?.source.signal) {
      return (
        <StartProject
          zh={zh}
          title={found.title}
          brief={briefText(found.source, found.title)}
          from="digest"
          ask=""
          signal={found.source.signal}
          evidence={(found.source.evidence ?? []).slice(0, 3).map(evidenceLine)}
          canWrite={canWrite}
        />
      );
    }
  }
  return <StartProject zh={zh} title={(q.title ?? "").slice(0, 80)} brief={(q.brief ?? "").slice(0, 600)} from={(q.from ?? "").slice(0, 40)} ask={(q.ask ?? "").slice(0, 400)} canWrite={canWrite} />;
}
