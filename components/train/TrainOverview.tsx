import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Card, MUTED, PageBody, smallButton } from "@/components/projects/kit";
import { Ago } from "@/components/ui/Ago";
import type { TrainSummary } from "@/lib/agents/training";
import type { TrainKey } from "@/lib/agents/train-keys";
import { trainHint, trainName } from "@/components/train/names";
import { ExampleDrop } from "@/components/train/ExampleDrop";

/**
 * AI 训练's first page: what it is for in one sentence and three steps,
 * then one row per employee — 文案 first, the one the client asked about —
 * with how much it has been taught and a 训练 button.
 */
export function TrainOverview({ zh, summaries, canTrain = true }: { zh: boolean; summaries: TrainSummary[]; /** `mayTrain(viewer)`: training is admin-only, so a member reads. */ canTrain?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const order: TrainKey[] = ["script", "assistant", "research", "planning", "video", "article", "legal", "finance"];
  const byKey = new Map(summaries.map((s) => [s.key, s]));
  const steps = [
    t("写工作说明：它必须遵守的要求", "Write the standing instructions it must follow"),
    t("上传几篇你们满意的范例", "Upload a few examples you are happy with"),
    t("在「试一试」里看效果，不满意就再改", "Check the result under Try it, and adjust"),
  ];
  return (
    <PageBody width={960}>
      <Card
        icon="spark"
        tone="accent"
        title={t("AI 训练", "Train the AI")}
        sub={t("给每位 AI 员工写长期说明、上传范例，它以后每次干活都会照着做。范例文件可以直接拖到下面对应员工的卡片上。", "Give each AI employee standing instructions and examples; it follows them in every job from now on. Drop example files straight onto an employee\u2019s card below.")}
      >
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {steps.map((s, i) => (
            <li key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#333", background: "#fff", border: "1px solid #d6e4fb", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, background: "#1f6feb", color: "#fff", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        {!canTrain ? (
          <div style={{ marginTop: 10, fontSize: 13, color: "#95590a" }}>{t("只有管理员可以修改训练内容，你可以点进去查看。", "Only admins can change the training; you can open each one to look.")}</div>
        ) : null}
      </Card>
      {order.map((key) => {
        const s = byKey.get(key);
        const trained = Boolean(s && (s.instructionChars || s.styleChars || s.examples));
        return (
          <ExampleDrop key={key} agent={key} name={trainName(key, zh)} zh={zh} enabled={canTrain}>
          <Card
            title={
              <Link href={`/train/${key}`} prefetch={false} style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none" }}>
                <AgentIcon agent={key === "assistant" ? null : key} size={30} />
                {trainName(key, zh)}
                {key === "script" ? <span style={{ fontSize: 11, fontWeight: 600, color: "#95590a", background: "#fff4df", borderRadius: 99, padding: "0 8px", lineHeight: "20px" }}>{t("最常用", "Most used")}</span> : null}
              </Link>
            }
            sub={trainHint(key, zh)}
            right={
              <Link href={`/train/${key}`} prefetch={false} style={smallButton(canTrain && !trained)}>
                {!canTrain ? t("查看", "View") : trained ? t("继续训练", "Keep training") : t("开始训练", "Start training")}
                <span aria-hidden>→</span>
              </Link>
            }
          >
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: trained ? "#333" : MUTED }}>
              {trained && s ? (
                <>
                  <span>{t("工作说明", "Instructions")} <b>{s.instructionChars}</b> {t("字", "chars")}</span>
                  <span>{t("风格", "Style")} <b>{s.styleChars}</b> {t("字", "chars")}</span>
                  <span>
                    {t("范例", "Examples")} <b>{s.examples}</b> {t("篇", "")}
                    {s.examplesOff ? <span style={{ color: MUTED }}>{t(`（另有 ${s.examplesOff} 篇已停用）`, ` (+${s.examplesOff} off)`)}</span> : null}
                  </span>
                  {s.updatedAt ? (
                    <span style={{ color: MUTED }}>
                      {t("上次更新", "Updated")} <Ago iso={s.updatedAt} zh={zh} />
                      {s.updatedByName ? ` · ${s.updatedByName}` : ""}
                    </span>
                  ) : null}
                </>
              ) : (
                <span>{t("还没有训练过：它现在按默认的方式干活。", "Not trained yet: it works the default way.")}</span>
              )}
            </div>
          </Card>
          </ExampleDrop>
        );
      })}
    </PageBody>
  );
}
