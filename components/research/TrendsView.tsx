"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TrendsScreen, type SourceStatus, type TrendTopic } from "@/components/canvas/TrendsScreen";
import { addTopicAction, decideAction } from "@/app/(app)/research/actions";

/** Live wiring for the Trends dashboard: category filtering in the URL (so a
 * filtered view can be sent to someone), and adopt/reject/save writing through
 * to the ranking. */
export function TrendsView({
  topics,
  sources,
  categories,
  activeCategories,
  region,
  locale,
}: {
  topics: TrendTopic[];
  sources: SourceStatus[];
  categories: { key: string; label: string }[];
  activeCategories: string[];
  region: string;
  locale: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();

  return (
    <TrendsScreen
      topics={topics}
      sources={sources}
      categories={categories}
      activeCategories={activeCategories}
      region={region}
      locale={locale}
      onToggleCategory={(key) => {
        const next = activeCategories.includes(key)
          ? activeCategories.filter((c) => c !== key)
          : [...activeCategories, key];
        const sp = new URLSearchParams(params.toString());
        if (next.length) sp.set("cat", next.join(","));
        else sp.delete("cat");
        router.replace(`/research${sp.toString() ? `?${sp}` : ""}`);
      }}
      onDecide={(topicId, action) =>
        start(async () => {
          const res = await decideAction(topicId, action);
          if (res.error) globalThis.alert(res.error);
          router.refresh();
        })
      }
      onAddTopic={(query) =>
        start(async () => {
          const res = await addTopicAction(query);
          if (res.error) globalThis.alert(res.error);
          router.refresh();
        })
      }
    />
  );
}
