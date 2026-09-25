"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TrendsScreen, type SourceStatus, type TrendTopic } from "@/components/canvas/TrendsScreen";
import { addTopicAction, decideAction, suggestAnglesAction } from "@/app/(app)/research/actions";
import { notify } from "@/lib/client/notify";
import { beginWork } from "@/lib/client/busy";
import { CompetitorPanel } from "@/components/research/CompetitorPanel";
import { DiscoverChannels } from "@/components/research/DiscoverChannels";
import { LiveNow, type LiveVideo, type Pick } from "@/components/research/LiveNow";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { AgentHistory } from "@/components/shell/AgentHistory";
import { ScriptSheet } from "@/components/research/ScriptSheet";
import { CreatorMemory } from "@/components/research/CreatorMemory";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import type { CompetitorRow } from "@/lib/social/service";
import type { CreatorMemoryState } from "@/lib/creator/service";

/** Live wiring for the Trends dashboard: category filtering in the URL (so a
 * filtered view can be sent to someone), and adopt/reject/save writing through
 * to the ranking. */
export function TrendsView({
  topics,
  sources,
  categories,
  activeCategories,
  region,
  competitors,
  ourMedian,
  tikhubConfigured,
  locale,
  model,
  trending,
  watching,
  watchingNote,
  digest,
  creator,
  creatorSyncing,
  canWriteScripts,
  canAdmin,
  picks,
}: {
  /** What the employees already proposed today, for the top of the strip. */
  picks: Pick[];
  topics: TrendTopic[];
  sources: SourceStatus[];
  categories: { key: string; label: string }[];
  activeCategories: string[];
  region: string;
  /** The channels the studio watches from the outside, and how it compares. */
  competitors: CompetitorRow[];
  ourMedian: number | null;
  tikhubConfigured: boolean;
  locale: string;
  model: string;
  /** What the region is searching for today, for the picker to suggest. */
  trending: { phrase: string; traffic: string | null; headline: string | null; region?: string }[];
  /** What the region is watching today, from YouTube's own chart. */
  watching: LiveVideo[];
  /** Why `watching` is empty, when it is. */
  watchingNote: string | null;
  /** This morning's brief, first line, for the top of the page. */
  digest?: { topic: string | null; why: string | null; date: string | null } | null;
  /** The creator's own channel, as the assistant's memory of it. */
  creator: CreatorMemoryState;
  creatorSyncing: boolean;
  /** Holds the Script module, so a topic can become a script from here. */
  canWriteScripts: boolean;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();
  const zh = locale.startsWith("zh");
  /* The brief's own line is folded into `picks` now; the prop stays for the
     page that already passes it. */
  void digest;
  /* The thread is kept per screen, so coming back to Research finds the same
     conversation; History and New sit above the composer as they do in Video. */
  const agent = useInlineAgent({ module: "research" }, { key: "research" });
  const [anglesBusy, setAnglesBusy] = useState<string | null>(null);
  /* One decision in flight at a time: a double press on Adopt used to write
     two events, and the ranking weights counted both. */
  const [deciding, setDeciding] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /* The "Write the script" sheet, for one topic at a time. */
  const [scripting, setScripting] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const scriptingTopic = scripting ? topics.find((x) => x.id === scripting) ?? null : null;

  /*
   * A first collection takes about a minute: the worker asks GDELT, Hacker
   * News and Google News, each of which answers in its own time. Until now the
   * topic simply appeared with a heat of zero and stayed that way until
   * somebody reloaded the page by hand, which reads as a button that did
   * nothing.
   *
   * So the page asks again while anything is still being collected, and stops
   * the moment nothing is — there is nothing to poll for on a dashboard of
   * settled numbers.
   */
  const collecting = topics.some((t) => t.collecting) || creatorSyncing;
  useEffect(() => {
    if (!collecting) return;
    // Bounded: a collection that never lands (a source down for the day) must
    // not keep the page refreshing every six seconds for as long as it is open.
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > 5 * 60_000) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, 6000);
    return () => clearInterval(id);
  }, [collecting, router]);

  /*
   * Collection outlives the click that started it. `onAddTopic` held the
   * indicator for as long as the server action took — a second or two — and
   * then let go, while the actual work ran on the worker for another minute
   * with nothing on screen saying so. Whatever is still being collected is
   * named in the corner, by name, until it lands.
   */
  const collectingNames = topics
    .filter((t) => t.collecting)
    .map((t) => t.name)
    .join("\u0000");
  useEffect(() => {
    if (!collectingNames) return;
    const stops = collectingNames
      .split("\u0000")
      .map((name) => beginWork(zh ? `收集“${name}”` : `Collecting “${name}”`));
    return () => {
      for (const stop of stops) stop();
    };
  }, [collectingNames, zh]);

  /* Watching a phrase, from wherever it was picked: the toolbar search, a
     trending chip in the strip above the board, a suggestion in the list. */
  const addTopic = (query: string) =>
    start(async () => {
      setAdding(true);
      const done = beginWork(zh ? `收集“${query}”` : `Collecting “${query}”`);
      try {
        /*
         * Two things went wrong when a beat filter was on.
         *
         * The phrase was created with no beat at all, and the board was
         * showing only one beat, so the topic somebody had just asked for did
         * not match the filter and vanished on the next render — leaving
         * "0 topics" and a control that looked broken. (The server now guesses
         * a beat from the phrase, but a guess is not what somebody filtering
         * to one beat asked for.)
         *
         * So: a phrase added while exactly one beat is selected belongs to
         * that beat, which is what somebody filtering to Semiconductors and
         * typing "nvidia" plainly means. With several selected there is no
         * such answer, so it is filed under none and the filter is cleared
         * below rather than hiding it.
         */
        const category = activeCategories.length === 1 ? activeCategories[0] : null;
        const res = await addTopicAction(query, undefined, category);
        if (res.error) {
          notify(res.error);
          return;
        }

        // If it still would not be visible here, show the board that does
        // contain it rather than an empty one.
        if (activeCategories.length > 0 && category === null) {
          router.replace("/research");
        }

        notify(
          zh
            ? `正在收集“${query}”，大约需要一分钟。`
            : `Collecting “${query}”. It takes about a minute across the sources.`,
          "ok",
        );
        router.refresh();
      } finally {
        done();
        setAdding(false);
      }
    });

  return (
    /* One viewport, not a page that grows.
       This used to be an `overflowY: auto` column with the board, the
       competitor panel and channel discovery stacked inside it — so a studio
       watching twenty topics had to scroll past all of them to reach the
       agent, and the watchlist scrolled away with the page. Everything now
       scrolls inside the pane it belongs to. */
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
      onDecide={(topicId, action) => {
        if (deciding) return;
        setDeciding(topicId);
        start(async () => {
          try {
            const res = await decideAction(topicId, action);
            if (res.error) notify(res.error);
            router.refresh();
          } finally {
            setDeciding(null);
          }
        });
      }}
      trending={trending}
      adding={adding}
      live={
        <LiveNow
          searches={trending}
          videos={watching}
          region={region}
          zh={zh}
          note={watchingNote}
          picks={picks}
          canWriteScripts={canWriteScripts}
          onWatch={(phrase) => addTopic(phrase)}
        />
      }
      anglesBusy={anglesBusy}
      below={
        <>
          <CreatorMemory state={creator} syncing={creatorSyncing} zh={zh} canAdmin={canAdmin} />
          <CompetitorPanel
            competitors={competitors}
            ourMedian={ourMedian}
            configured={tikhubConfigured}
            zh={zh}
          />

          {/* And the half the board could not do: finding a channel worth
              watching without already knowing its id. */}
          <DiscoverChannels
            zh={zh}
            watching={competitors.map((c) => c.externalId)}
            suggestion={topics[0]?.name ?? null}
          />
        </>
      }
      onSuggestAngles={(topicId) =>
        start(async () => {
          setAnglesBusy(topicId);
          const done = beginWork(zh ? "正在构思切入角度" : "Thinking of angles");
          try {
            const res = await suggestAnglesAction(topicId);
            if ("error" in res && res.error) {
              notify(res.error);
              return;
            }
            router.refresh();
          } finally {
            done();
            setAnglesBusy(null);
          }
        })
      }
      agent={
        <ResearchAgentPanel
          dock
          accent="#007be0"
          zh={zh}
          scope={
            activeCategories.length === 0
              ? zh
                ? `全部领域 · ${topics.length}`
                : `All beats · ${topics.length}`
              : zh
                ? `${activeCategories.length} 个领域`
                : `${activeCategories.length} beats`
          }
          note={
            zh
              ? "可以问它这些选题里哪些值得做，或者为什么某个词突然涨了。"
              : "Ask which of these is worth making, or why one of them moved."
          }
          placeholder={zh ? "询问这个看板…" : "Ask about this board…"}
          model={model}
          onAsk={(prompt) => void agent.send(prompt)}
          tools={<AgentHistory zh={zh} current={agent.conversationId} onPick={(id) => void agent.load(id)} onNew={agent.reset} />}
          thread={
            <InlineAgentThread
              messages={agent.messages}
              notice={agent.notice}
              conversationId={agent.conversationId}
              zh={zh}
            />
          }
        />
      }
      onAddTopic={addTopic}
      onWriteScript={canWriteScripts ? (topicId) => { setWriteError(null); setScripting(topicId); } : undefined}
    />

    {scriptingTopic ? (
      <ScriptSheet
        topic={{ id: scriptingTopic.id, name: scriptingTopic.name }}
        angles={scriptingTopic.angles}
        busy={writing || anglesBusy === scriptingTopic.id}
        error={writeError}
        zh={zh}
        onClose={() => {
          if (!writing) setScripting(null);
        }}
        onSuggestAngles={() =>
          start(async () => {
            setAnglesBusy(scriptingTopic.id);
            const done = beginWork(zh ? "正在构思切入角度" : "Thinking of angles");
            try {
              const res = await suggestAnglesAction(scriptingTopic.id);
              if ("error" in res && res.error) notify(res.error);
              router.refresh();
            } finally {
              done();
              setAnglesBusy(null);
            }
          })
        }
        onWrite={(input) =>
          start(async () => {
            setWriting(true);
            setWriteError(null);
            try {
              /* A project around it, like every other start: the topic's
                 snapshot (summary, angles, headlines) goes with it, the
                 chips shape the script, and 编剧 writes after the response
                 while the person watches it land on the script. The topic
                 names the script; the angle is the angle. */
              const res = await startFromTopicAction(
                { kind: "topic", id: scriptingTopic.id },
                { write: true, chips: { angle: input.angle, channel: input.channel, aspect: input.aspect, seconds: input.seconds, language: input.language, subtitleLanguage: input.subtitleLanguage } },
              );
              if ("error" in res && res.error) {
                setWriteError(res.error);
                return;
              }
              if ("projectId" in res && res.projectId) {
                if (res.existed && !res.writing) notify(zh ? "这个选题已经有项目了，打开的是它的脚本。" : "This topic already has a project; opening its script.", "info");
                setScripting(null);
                router.push(res.scriptId ? `/script/${res.scriptId}${res.writing ? "?writing=1" : ""}` : `/projects/${res.projectId}`);
              }
            } finally {
              setWriting(false);
            }
          })
        }
      />
    ) : null}
    </div>
  );
}
