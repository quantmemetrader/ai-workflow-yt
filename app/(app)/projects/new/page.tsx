import { requireModule } from "@/lib/auth/dal";
import { StartProject } from "@/components/projects/StartProject";
import { latestDigest } from "@/lib/home/pulse";

export const metadata = { title: "新项目 · New project" };

/**
 * A project from a link: `/projects/new?title=…&brief=…&from=…`.
 *
 * For the places that can only link (a button under a chat message, the
 * morning brief): it shows what the project will be and starts it on one
 * press, never on the page load, so a link opened twice makes one project.
 */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ title?: string; brief?: string; from?: string; ask?: string; signal?: string }> }) {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const q = await searchParams;
  /* From the morning brief: the signal by its number in today's brief. */
  if (q.signal !== undefined) {
    const digest = await latestDigest(viewer.tenantId);
    const sg = digest?.signals[Number(q.signal)];
    if (sg) {
      const brief = `${sg.whyNow}\n开头：「${sg.hook}」`;
      const ask = `@编剧 按这个信号写脚本初稿《${sg.title}》。开头第一句：「${sg.hook}」。`;
      return <StartProject zh={zh} title={sg.title.slice(0, 80)} brief={brief} from="digest" ask={ask} />;
    }
  }
  return <StartProject zh={zh} title={(q.title ?? "").slice(0, 80)} brief={(q.brief ?? "").slice(0, 600)} from={(q.from ?? "").slice(0, 40)} ask={(q.ask ?? "").slice(0, 400)} />;
}
