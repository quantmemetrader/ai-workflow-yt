"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScriptDetailScreen } from "@/components/canvas/ScriptDetailScreen";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import type { ScriptDetail, ScriptListItem } from "@/lib/script/service";
import {
  checkConformanceAction,
  commentAction,
  cutVersionAction,
  decideApprovalAction,
  generateDraftAction,
  requestApprovalAction,
  restoreVersionAction,
  rewriteAction,
  saveBriefAction,
  saveDraftAction,
  suggestionAction,
  unlockAction,
} from "@/app/(app)/script/actions";
import { sendScriptToVideoAction } from "@/app/(app)/home/actions";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";
import { RunPanel } from "@/components/script/RunPanel";
import type { ScriptRun } from "@/lib/script/run";

/**
 * Live wiring for one script.
 *
 * The tab is in the URL: an approver sent a link should land on the Approval
 * tab, not on the draft.
 *
 * `onRewrite` is the one callback that hands something back rather than just
 * refreshing. The screen owns the selection, so the rewritten text is returned
 * for it to apply; this layer only carries the call and the error.
 */
type Tab = "brief" | "draft" | "versions" | "approval";

const TABS: Tab[] = ["brief", "draft", "versions", "approval"];

export function DetailView({
  detail,
  siblings,
  approvers,
  viewerId,
  locale,
  model,
  shareSheet,
  canMakeVideo = false,
  flow,
}: {
  /** Where this script is in the line of work, for the panel. */
  flow?: ScriptRun | null;
  detail: ScriptDetail;
  siblings: Record<string, ScriptListItem[]>;
  approvers: { id: string; name: string }[];
  viewerId: string;
  locale: string;
  model: string;
  /** Holds the Video module, so the script can be handed to a cut. */
  canMakeVideo?: boolean;
  /** The sharing sheet, rendered on the server so it arrives with who this
   * script is already shared with. */
  shareSheet?: React.ReactNode;
}) {
  const router = useRouter();
  /* The agent answers here. Asking used to push to /chat, which took the
   * screen you were asking about off the screen. */
  const agent = useInlineAgent({ module: "script", scriptId: detail?.script?.id });
  const params = useSearchParams();
  const [, start] = useTransition();
  const zh = locale.startsWith("zh");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);

  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : detail.locked ? "approval" : "draft";

  /*
   * 编剧 writing a draft into this script, after a topic was chosen on Home,
   * in Research or in the backlog. The server knows (`detail.writing`); a
   * page opened with `?writing=1` straight after the press trusts the
   * button until the first answer from the pulse. It asks
   * `/api/script/[id]/pulse` every three seconds and refreshes once, when
   * the draft has landed (or failed), instead of re-rendering on a timer.
   */
  const arrivedWriting = params.get("writing") === "1";
  const [writing, setWriting] = useState(detail.writing || arrivedWriting);
  const scriptId = detail.script.id;
  useEffect(() => {
    if (!writing) return;
    const until = Date.now() + 10 * 60_000;
    let stopped = false;
    const id = setInterval(async () => {
      if (stopped) return;
      if (Date.now() > until) {
        clearInterval(id);
        setWriting(false);
        return;
      }
      const r = await fetch(`/api/script/${scriptId}/pulse`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { writing: boolean }) : null;
      if (!j || stopped) return;
      if (!j.writing) {
        stopped = true;
        clearInterval(id);
        setWriting(false);
        /* Drop `?writing=1` so a reload does not claim it again. */
        if (params.get("writing")) {
          const q = new URLSearchParams(params.toString());
          q.delete("writing");
          router.replace(q.toString() ? `/script/${scriptId}?${q.toString()}` : `/script/${scriptId}`, { scroll: false });
        }
        /* Once, for the beats (or 编剧's note on why there are none). */
        router.refresh();
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [writing, scriptId, router, params]);


  const run = useCallback(
    (id: string, work: () => Promise<{ error?: string } | Record<string, unknown>>) => {
      setPending(id);
      setError(null);
      start(async () => {
        try {
          const res = await work();
          if (res && typeof res === "object" && "error" in res && typeof res.error === "string") {
            setError(res.error);
          } else {
            router.refresh();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setPending(null);
        }
      });
    },
    [router],
  );

  const id = detail.script.id;

  /* "按选题重写": the project's draft again from its topic, written after
     the response like the first one. A script outside any project has no
     snapshot to write from, so it regenerates from its brief (which now
     carries the backlog topic's headlines). */
  const projectId = detail.topic?.project?.id ?? null;
  const rewriteFromTopic = detail.locked
    ? undefined
    : () => {
        if (!projectId) {
          run("generate", () => generateDraftAction(scriptId));
          return;
        }
        setPending("topic");
        setError(null);
        start(async () => {
          try {
            const res = await startFromTopicAction({ kind: "project", id: projectId }, { write: true, rewrite: true });
            if ("error" in res && res.error) {
              setError(res.error);
              return;
            }
            if ("writing" in res && res.writing) setWriting(true);
            else if ("note" in res && res.note) notify(res.note);
          } finally {
            setPending(null);
          }
        });
      };

  return (
    <ScriptDetailScreen
      locale={locale}
      detail={detail}
      siblings={siblings}
      approvers={approvers}
      viewerId={viewerId}
      shareSheet={shareSheet}
      topic={detail.topic ?? null}
      writing={writing}
      onRewriteFromTopic={detail.topic ? rewriteFromTopic : undefined}
      tab={tab}
      compareVersion={compareVersion}
      model={model}
      pending={pending}
      error={error}
      onTab={(next) => {
        const q = new URLSearchParams(params.toString());
        q.set("tab", next);
        router.replace(`/script/${id}?${q.toString()}`, { scroll: false });
      }}
      onOpenScript={(scriptId) => router.push(`/script/${scriptId}`)}
      onSaveBrief={(form) => run("brief", () => saveBriefAction(id, form))}
      onSaveDraft={(beats) => run("draft", () => saveDraftAction(id, beats))}
      onGenerate={() => run("generate", () => generateDraftAction(id))}
      onCheckConformance={() => run("conformance", () => checkConformanceAction(id))}
      onRewrite={(selection, instruction) =>
        run("rewrite", async () => {
          const res = await rewriteAction(selection, instruction);
          // The screen holds the selection, so it is the only thing that can
          // put the answer back. Handed over through a custom event rather
          // than a prop, so the screen stays a pure transcription.
          if ("text" in res && res.text) {
            globalThis.dispatchEvent(new CustomEvent("script:rewritten", { detail: { text: res.text } }));
          }
          return res;
        })
      }
      onSuggestion={(suggestionId, action) => run(suggestionId, () => suggestionAction(suggestionId, action))}
      onCutVersion={(note) => run("version", () => cutVersionAction(id, note))}
      onRestoreVersion={(versionNo) => run(`v${versionNo}`, () => restoreVersionAction(id, versionNo))}
      onCompare={setCompareVersion}
      onRequestApproval={(approverId, note) => run("approval", () => requestApprovalAction(id, approverId, note))}
      onDecideApproval={(approvalId, decision, note) =>
        run(approvalId, () => decideApprovalAction(approvalId, decision, note))
      }
      onUnlock={() => run("unlock", () => unlockAction(id))}
      onComment={(body, beatOrd) => run("comment", () => commentAction(id, body, beatOrd))}
      onMakeVideo={
        canMakeVideo
          ? () =>
              start(async () => {
                /* Makes the project and tells 剪辑师 in #制作, in one press —
                   "script can send to ai directly to start processing
                   video". The employee answers there and starts the moment
                   there is footage. */
                const res = await sendScriptToVideoAction(id);
                if ("error" in res && res.error) {
                  notify(res.error);
                  return;
                }
                notify(zh ? "已交给剪辑师，它在 #制作 里回复" : "Handed to the video agent; it answers in #制作", "ok");
                if ("projectId" in res && res.projectId) router.push(`/video?project=${res.projectId}`);
              })
          : undefined
      }
      onAsk={(prompt) => void agent.send(prompt)}
      run={
        flow ? (
          <RunPanel
            run={flow}
            zh={zh}
            /* The live answer (the pulse flips it the moment the draft
               lands), so the flow step and the banner above the beats
               never disagree about whether 编剧 is still writing. */
            writing={writing}
            onApprove={() => {
              const q = new URLSearchParams(params.toString());
              q.set("tab", "approval");
              router.replace(`/script/${id}?${q.toString()}`, { scroll: false });
            }}
          />
        ) : undefined
      }
      thread={
        <InlineAgentThread
          messages={agent.messages}
          notice={agent.notice}
          conversationId={agent.conversationId}
          zh={locale.startsWith("zh")}
        />
      }
    />
  );
}
