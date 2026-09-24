"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { SayToAgent } from "@/components/flow/SayToAgent";
import { AGENT_COLORS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { Pipeline, Stage } from "@/lib/home/pipeline";
import { useRouter } from "next/navigation";
import { FlowScreen, type AutomationRow } from "@/components/flow/FlowScreen";

/**
 * Today's video as the studio describes it, in six steps and one row:
 *
 *   collect data from every source → suggest one or two topics → write the
 *   script → wait for the host's clips → edit → hand the finished video back.
 *
 * Read from `pipelineToday` (the same records the full flow reads); only the
 * grouping is simpler. Every step opens what it is about and has a line to
 * talk to whoever owns it. The full board is one big button away.
 */
type Owner = AgentKey | "you";
type Step = { key: string; n: number; label: string; owner: Owner; ownerName?: string; state: Stage["state"]; line: string; href: string | null; ask: AgentKey };

function steps(p: Pipeline, zh: boolean): Step[] {
  const t = (a: string, b: string) => (zh ? a : b);
  const S = (k: Stage["key"]) => p.stages.find((s) => s.key === k)!;
  const topic = S("topic"), script = S("script"), approve = S("approve"), cut = S("cut"), exp = S("export"), publish = S("publish");

  const fresh = p.collectedAt ? Date.now() - new Date(p.collectedAt).getTime() < 3 * 3_600_000 : false;
  const hhmm = p.collectedAt ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit" }).format(new Date(p.collectedAt)) : null;

  const scriptStep: Step =
    approve.state === "you"
      ? { key: "script", n: 3, label: t("写脚本", "Script"), owner: "script", state: "you", line: t("写好了，等你批准", "Written; waiting for your OK"), href: approve.href, ask: "script" }
      : { key: "script", n: 3, label: t("写脚本", "Script"), owner: "script", state: approve.state === "done" ? "done" : script.state, line: approve.state === "done" ? approve.line : script.line, href: script.href, ask: "script" };

  const footageIn = cut.state === "running" || cut.state === "done" || exp.state !== "todo";
  const waitingFootage = !footageIn && (approve.state === "done" || p.projectId !== null);
  const footage: Step = {
    key: "footage",
    n: 4,
    label: t("主持人", "Host"),
    owner: "you",
    ownerName: t("上传素材", "Upload clips"),
    state: footageIn ? "done" : waitingFootage ? "you" : "todo",
    line: footageIn ? t("素材已到", "Clips are in") : waitingFootage ? t("等主持人上传素材", "Waiting for the host to upload") : t("脚本批准后", "After the script is approved"),
    href: p.projectId ? `/video?project=${p.projectId}` : "/video",
    ask: "video",
  };

  const edit: Step = {
    key: "edit",
    n: 5,
    label: t("剪辑", "Edit"),
    owner: "video",
    state: exp.state === "done" ? "done" : exp.state === "running" || cut.state === "running" ? "running" : cut.state === "done" ? "running" : "todo",
    line: exp.state === "done" ? exp.line : exp.state === "running" ? exp.line : cut.state === "running" ? cut.line : cut.state === "done" ? t(`粗剪好了 · ${cut.line}`, `Rough cut in · ${cut.line}`) : t("素材到了就开始", "Starts when the clips arrive"),
    href: exp.href ?? cut.href,
    ask: "video",
  };

  const deliver: Step = {
    key: "deliver",
    n: 6,
    label: t("交付", "Deliver"),
    owner: "you",
    state: publish.state === "done" ? "done" : exp.state === "done" ? "you" : "todo",
    line: publish.state === "done" ? publish.line : exp.state === "done" ? t("成片已出，拿去发", "The master is ready to post") : t("剪完之后", "After the edit"),
    href: exp.state === "done" ? (exp.href ?? "/video") : null,
    ask: "article",
  };

  return [
    { key: "data", n: 1, label: t("收集数据", "Collect data"), owner: "research", state: fresh ? "done" : "todo", line: hhmm ? t(`${hhmm} 已从各平台收集`, `Collected from every platform at ${hhmm}`) : t("每小时自动收集", "Collected every hour"), href: "/research", ask: "research" },
    { key: "topics", n: 2, label: t("选 1–2 个题", "Pick 1–2 topics"), owner: "research", state: topic.state, line: topic.state === "done" ? (p.title ? `${topic.line} · ${p.title}` : topic.line) : topic.line, href: topic.href, ask: "research" },
    scriptStep,
    footage,
    edit,
    deliver,
  ];
}

export function MiniFlow({ pipeline, zh, bare = false, automations = [] }: { pipeline: Pipeline; zh: boolean; /** Inside a Fold, which draws the frame. */ bare?: boolean; /** For the preview of the full flow. */ automations?: AutomationRow[] }) {
  const router = useRouter();
  const t = (a: string, b: string) => (zh ? a : b);
  const [talking, setTalking] = React.useState<string | null>(null);
  const list = steps(pipeline, zh);
  const doneCount = list.filter((x) => x.state === "done").length;
  const yours = list.find((x) => x.state === "you") ?? null;
  const live = (x: Step) => x.state === "running" || x.state === "you";

  return (
    <section style={bare ? {} : { background: "#ffffff", border: "1px solid #e2e2e2", borderRadius: 14, padding: "16px 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, minWidth: 0 }}>
        {bare ? null : <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{t("今天这条片走到哪了", "Where today's video is")}</span>}
        <span style={{ fontSize: 12.5, color: "#525252", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("数据 → 选题 → 脚本 → 上传素材 → 剪辑 → 交付", "Data → topic → script → upload clips → edit → deliver")}
        </span>
        <span style={{ flexGrow: 1 }} />
        <span style={{ fontSize: 12, color: "#999999", whiteSpace: "nowrap" }}>{t(`${doneCount}/6 步完成`, `${doneCount}/6 done`)}</span>
      </div>

      {/* Three and three, the second row running back under the first, the
          way the board draws it; fits the right-hand column. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 20px minmax(0,1fr) 20px minmax(0,1fr)", rowGap: 4, paddingBottom: talking ? 64 : 0 }}>
        {[list[0], list[1], list[2]].flatMap((x, i) => [
          ...(i ? [<Arrow key={`a${i}`} dir="→" on={live(x)} />] : []),
          <StepCard key={x.key} step={x} zh={zh} talking={talking === x.key} onTalk={() => setTalking(talking === x.key ? null : x.key)} alignRight={i === 2} />,
        ])}
        <div style={{ gridColumn: "5", display: "flex", justifyContent: "center", height: 18, alignItems: "center", color: live(list[3]) ? "#0f5bd5" : "#3d3d3d", fontSize: 17, fontWeight: 700 }} aria-hidden>
          ↓
        </div>
        {[list[5], list[4], list[3]].flatMap((x, i, arr) => [
          ...(i ? [<Arrow key={`b${i}`} dir="←" on={live(arr[i - 1])} />] : []),
          <StepCard key={x.key} step={x} zh={zh} talking={talking === x.key} onTalk={() => setTalking(talking === x.key ? null : x.key)} alignRight={i === 2} />,
        ])}
      </div>

      {/* A div, not a link: the preview inside is the real flow page, whose
          nodes are links, and a link inside a link is not allowed. */}
      <div
        role="link"
        tabIndex={0}
        onClick={() => router.push("/flow")}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push("/flow");
        }}
        onMouseEnter={() => router.prefetch("/flow")}
        style={{ marginTop: 14, display: "block", borderRadius: 12, overflow: "hidden", color: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.14)", border: "1px solid #171717", cursor: "pointer" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "linear-gradient(180deg, #2b2b2b, #111111)" }}>
          <AgentIcon size={34} radius={9} />
          <span style={{ minWidth: 0, flexGrow: 1 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{t("打开全部流程", "Open the full flow")}</span>
            <span style={{ display: "block", fontSize: 12, color: "#b3b3b3", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {yours ? t(`下一步需要你：${yours.label}。`, `Next it needs you: ${yours.label}.`) : t("没有人吩咐的时候，这些事也会发生。黑色是需要你点头的地方。", "These happen with nobody asking. Black is where you nod.")}
            </span>
          </span>
          <span style={{ fontSize: 20, lineHeight: 1 }}>→</span>
        </span>
        <ScaledFlow pipeline={pipeline} automations={automations} zh={zh} />
      </div>
    </section>
  );
}

function Arrow({ dir, on }: { dir: string; on: boolean }) {
  return (
    <div aria-hidden style={{ display: "flex", alignItems: "center", justifyContent: "center", color: on ? "#0f5bd5" : "#3d3d3d", fontSize: 17, fontWeight: 700 }}>
      {dir}
    </div>
  );
}

function StepCard({ step: x, zh, talking, onTalk, alignRight }: { step: Step; zh: boolean; talking: boolean; onTalk: () => void; alignRight: boolean }) {
  const you = x.owner === "you";
  const color = you ? "#171717" : AGENT_COLORS[x.owner as AgentKey];
  const todo = x.state === "todo";
  const running = x.state === "running";
  const needsYou = x.state === "you";
  const owner = x.ownerName ?? (you ? (zh ? "你" : "You") : zh ? AGENT_LABELS[x.owner as AgentKey].nameLocal : AGENT_LABELS[x.owner as AgentKey].name);

  const frame: React.CSSProperties = needsYou
    ? { background: "#171717", color: "#fff", border: "1px solid #171717" }
    : running
      ? { border: "1px solid transparent", background: "linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, #278f5e, #0f5bd5) border-box" }
      : todo
        ? { border: "1px dashed #d9d9d9", background: "#fbfbfa" }
        : { border: "1px solid #e2e2e2", background: "#fff" };

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ opacity: todo ? 0.5 : 1, display: "flex" }}>
          <AgentIcon agent={you ? null : (x.owner as AgentKey)} size={26} radius={7} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 11, color: needsYou ? "#b3b3b3" : "#999999", whiteSpace: "nowrap" }}>
            {x.n} · {x.label}
          </span>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: needsYou ? "#fff" : todo ? "#999999" : color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{owner}</span>
        </span>
      </div>
      <div style={{ fontSize: 11.5, marginTop: 7, lineHeight: 1.4, color: needsYou ? "#fff" : running ? color : todo ? "#b3b3b3" : "#525252", fontWeight: running || needsYou ? 500 : 400, minHeight: 32, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {running ? <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: color, marginRight: 5, verticalAlign: "1px", animation: "auraPulse 1.6s ease-in-out infinite" }} /> : null}
        {x.line}
      </div>
    </>
  );

  return (
    <div style={{ minWidth: 0, position: "relative" }}>
      <div style={{ ...frame, borderRadius: 10, padding: "10px 10px 8px", height: "100%", boxSizing: "border-box" }}>
        {x.href ? (
          <Link href={x.href} title={x.line} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
            {body}
          </Link>
        ) : (
          body
        )}
        <button
          type="button"
          onClick={onTalk}
          aria-expanded={talking}
          style={{ marginTop: 6, height: 22, padding: "0 8px", borderRadius: 6, border: `1px solid ${needsYou ? "#4a4a4a" : "#e2e2e2"}`, background: needsYou ? "transparent" : "#fafafa", color: needsYou ? "#d9d9d9" : "#525252", fontFamily: "inherit", fontSize: 11, cursor: "pointer", letterSpacing: "inherit" }}
        >
          {talking ? (zh ? "收起" : "Close") : zh ? "说一句" : "Comment"}
        </button>
      </div>
      {talking ? (
        <div style={{ position: "absolute", ...(alignRight ? { right: 0 } : { left: 0 }), top: "calc(100% + 4px)", width: 300, zIndex: 5 }}>
          <SayToAgent agent={x.ask} about={x.label} zh={zh} onDone={onTalk} />
        </div>
      ) : null}
    </div>
  );
}


/**
 * The full flow page itself, shrunk to the width it is given.
 *
 * Not a drawing of it: the same `FlowScreen` the /flow page renders, from
 * the same data, scaled down and made inert, so the preview can never look
 * different from the page it opens.
 */
const BOARD_W = 1254;
const BOARD_H = 860;
/** How much of the board shows, and from how far down it starts. */
const CROP = 0.2;
const TOP = 84;

function ScaledFlow({ pipeline, automations, zh }: { pipeline: Pipeline; automations: AutomationRow[]; zh: boolean }) {
  const box = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(0.55);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / BOARD_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    /* A strip, not the whole board: the first row of nodes, cut off and
       faded, enough to show what is behind the button. */
    <div ref={box} aria-hidden style={{ position: "relative", width: "100%", height: Math.round(BOARD_H * scale * CROP), overflow: "hidden", background: "#f4f3f0" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: BOARD_W, height: BOARD_H, display: "flex", transform: `translateY(${-TOP * scale}px) scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }}>
        <FlowScreen pipeline={pipeline} automations={automations} zh={zh} canEdit={false} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "45%", background: "linear-gradient(rgba(244,243,240,0), #f4f3f0)" }} />
    </div>
  );
}
