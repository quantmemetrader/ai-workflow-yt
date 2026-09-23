"use client";

import { useCallback, useState, useTransition } from "react";
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
import { projectFromScriptAction } from "@/app/(app)/video/actions";
import { notify } from "@/lib/client/notify";

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
}: {
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
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);

  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : detail.locked ? "approval" : "draft";

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

  return (
    <ScriptDetailScreen
      locale={locale}
      detail={detail}
      siblings={siblings}
      approvers={approvers}
      viewerId={viewerId}
      shareSheet={shareSheet}
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
                const res = await projectFromScriptAction(id);
                if ("error" in res && res.error) {
                  notify(res.error);
                  return;
                }
                if ("id" in res && res.id) router.push(`/video?project=${res.id}`);
              })
          : undefined
      }
      onAsk={(prompt) => void agent.send(prompt)}
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
