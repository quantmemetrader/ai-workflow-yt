import { requireModule } from "@/lib/auth/dal";
import { pipelineToday } from "@/lib/home/pipeline";
import { AUTOMATIONS, readAutomations } from "@/lib/automations/service";
import { FlowScreen } from "@/components/flow/FlowScreen";

export const metadata = { title: "自动化流程 · Flow" };

/**
 * 自动化流程 — the whole line of work on one page, with its switches.
 *
 * Gated on Chat like Home is: it is a picture of what the employees do in
 * the channels, not a module of its own.
 */
export default async function FlowPage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [pipeline, automations] = await Promise.all([pipelineToday(viewer, zh), readAutomations()]);

  return (
    <FlowScreen
      zh={zh}
      pipeline={pipeline}
      canEdit={viewer.role === "owner" || viewer.role === "admin"}
      automations={AUTOMATIONS.map((def) => ({
        key: def.key,
        name: def.name,
        nameEn: def.nameEn,
        what: def.what,
        whatEn: def.whatEn,
        scheduled: def.scheduled,
        value: automations[def.key],
      }))}
    />
  );
}
