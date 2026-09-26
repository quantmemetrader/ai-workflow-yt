"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BacklogScreen, type BacklogItem, type Person, type Stage } from "@/components/canvas/BacklogScreen";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { decideAction, moveStageAction, planAction } from "@/app/(app)/research/actions";
import { scriptFromTopicAction } from "@/app/(app)/script/actions";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";

/**
 * Live wiring for the Topic backlog.
 *
 * Hand-off to Script now actually hands off: the topic becomes a brief in the
 * Script module and the producer is taken to it. Someone without the Script
 * module gets told that, rather than a button that silently fails.
 *
 * `canWriteScripts` is whether this person holds the Script module. Without
 * it the press stops here with that said: it used to start a project (its
 * chat, script and video) that nobody asked for, and then send them to a
 * script page that bounced them to Home without a word.
 */
export function BacklogView({
  items,
  people,
  channels,
  locale,
  region,
  model,
  canWriteScripts,
}: {
  items: BacklogItem[];
  people: Person[];
  channels: string[];
  locale: string;
  region: string;
  model: string;
  canWriteScripts: boolean;
}) {
  const zh = locale.startsWith("zh");
  const router = useRouter();
  /* The agent answers here. Asking used to push to /chat, which took the
   * screen you were asking about off the screen. */
  const agent = useInlineAgent({ module: "research" });
  const [, start] = useTransition();

  return (
    <BacklogScreen
      items={items}
      people={people}
      channels={channels}
      locale={locale}
      region={region}
      model={model}
      onAsk={(prompt) => void agent.send(prompt)}
      thread={
        <InlineAgentThread
          messages={agent.messages}
          notice={agent.notice}
          conversationId={agent.conversationId}
          zh={locale.startsWith("zh")}
        />
      }
      onAssign={(topicId, patch) =>
        start(async () => {
          const res = await planAction(topicId, patch);
          if (res.error) notify(res.error);
          router.refresh();
        })
      }
      onMoveStage={(topicId, stage: Stage) =>
        start(async () => {
          const res = await moveStageAction(topicId, stage);
          if (res.error) notify(res.error);
          router.refresh();
        })
      }
      /**
       * The hand-off to Script.
       *
       * The topic becomes a project (its chat, its script, its video), the
       * script starts with the topic's name, angles and headlines, and 编剧
       * writes the first draft while the producer lands on it. A second press
       * opens the project already started from the topic. Without Chat there
       * is no project to make, so the old hand-off (a brief in Script) is
       * what that person gets.
       */
      onHandOff={(topicId) => {
        if (!canWriteScripts) {
          notify(zh ? "把选题交给脚本需要脚本模块的权限，没有开项目。请管理员开通后再试。" : "Handing a topic to Script needs the Script module, so no project was started. Ask an admin to turn it on.");
          return;
        }
        start(async () => {
          const res = await startFromTopicAction({ kind: "topic", id: topicId }, { write: true });
          if ("error" in res && res.error) {
            if (res.error !== "Not allowed") {
              notify(res.error);
              return;
            }
            const old = await scriptFromTopicAction(topicId);
            if ("error" in old && old.error) notify(old.error);
            else if ("id" in old && old.id) router.push(`/script/${old.id}`);
            return;
          }
          /* Why no draft is coming (the script is locked, or Script was taken
             away since the page was drawn) is said, not dropped; the notice
             lives in the layout, so it stays up across the move. */
          if ("note" in res && res.note) notify(res.note, "info");
          if ("scriptId" in res && res.scriptId) router.push(`/script/${res.scriptId}${res.writing ? "?writing=1" : ""}`);
          else if ("projectId" in res && res.projectId) router.push(`/projects/${res.projectId}`);
        });
      }}
      onDrop={(topicId) =>
        start(async () => {
          await decideAction(topicId, "save");
          router.refresh();
        })
      }
    />
  );
}
