"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BacklogScreen, type BacklogItem, type Person, type Stage } from "@/components/canvas/BacklogScreen";
import { decideAction, moveStageAction, planAction } from "@/app/(app)/research/actions";
import { scriptFromTopicAction } from "@/app/(app)/script/actions";

/**
 * Live wiring for the Topic backlog.
 *
 * Hand-off to Script now actually hands off: the topic becomes a brief in the
 * Script module and the producer is taken to it. Someone without the Script
 * module gets told that, rather than a button that silently fails.
 */
export function BacklogView({
  items,
  people,
  channels,
  locale,
  region,
  model,
}: {
  items: BacklogItem[];
  people: Person[];
  channels: string[];
  locale: string;
  region: string;
  model: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();

  return (
    <BacklogScreen
      items={items}
      people={people}
      channels={channels}
      locale={locale}
      region={region}
      model={model}
      onAsk={(prompt) => router.push(`/chat?q=${encodeURIComponent(prompt)}`)}
      onAssign={(topicId, patch) =>
        start(async () => {
          const res = await planAction(topicId, patch);
          if (res.error) globalThis.alert(res.error);
          router.refresh();
        })
      }
      onMoveStage={(topicId, stage: Stage) =>
        start(async () => {
          const res = await moveStageAction(topicId, stage);
          if (res.error) globalThis.alert(res.error);
          router.refresh();
        })
      }
      /**
       * The hand-off to Script.
       *
       * This used to be an alert box explaining that Script did not exist. It
       * does now: the topic's name, angle and target channel become a brief,
       * and the producer lands in it. A second press opens the script that was
       * already made rather than making another.
       */
      onHandOff={(topicId) =>
        start(async () => {
          const res = await scriptFromTopicAction(topicId);
          if ("error" in res && res.error) {
            globalThis.alert(res.error);
            return;
          }
          if ("id" in res && res.id) router.push(`/script/${res.id}`);
        })
      }
      onDrop={(topicId) =>
        start(async () => {
          await decideAction(topicId, "save");
          router.refresh();
        })
      }
    />
  );
}
