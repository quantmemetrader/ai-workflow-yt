"use client";

import { Icon } from "@/components/ui/Icon";
import * as React from "react";
import type { Measurement, ScriptDetail, ScriptListItem } from "@/lib/script/service";
import { useResizable } from "@/components/ui/Resizer";

/**
 * ScriptDetailScreen — a transcription of the five Script document artboards,
 * which are one screen with four tabs:
 *
 *   design/canvas/Script-Brief.dc.html     the Brief tab
 *   design/canvas/Script-Editor.dc.html    the Draft tab
 *   design/canvas/Script-Versions.dc.html  the Versions tab
 *   design/canvas/Script-Lock.dc.html      the Approval tab
 *   design/canvas/Script-Locked.dc.html    the same screen, once locked
 *
 * Everything after the artboards' 52px rail: the "Jump to a script" module
 * sidebar, the header bar, the tab strip, each tab's body and the artboards'
 * right-hand panel. Markup, nesting, class names, SVG paths, pixel values and
 * colours are the artboards'; only the content is lifted into props. The
 * artboards are the source of truth — when they change, change this file with
 * them, and do not "improve" anything here that they do not do.
 *
 * What the artboards draw and this file does not, because no prop carries it:
 *
 *   — The brief's "heat 94" card, its sparkline, its adopted/due/sensitivity
 *     rows and the "Research carried over" list. The screen knows a script
 *     came from a topic (`script.topicId`) and nothing else about the topic,
 *     so it says only that.
 *   — The brief's Tone chips and "Things to avoid" list. There is no column
 *     for either, and a chip that cannot be saved is a lie about state.
 *   — Per-point ticks on the mandatory points. The count covered is real
 *     (`versions[0].mandatoryCovered`); which beat covers which point is not
 *     known here, so the count is shown and the ticks are not.
 *   — The Versions tab's word-level diff. `VersionRow` carries counts, not
 *     beats, so the page-preview well renders the version's own facts (title,
 *     author, date, counts, note) rather than invented lines.
 *   — "New project 004" on the Approval tab. The project does not exist until
 *     the lock happens, and its number is not ours to guess.
 *   — The editor toolbar's bold/italic/list glyphs. Beats are plain text in
 *     the schema; a formatting button with nothing behind it is worse than no
 *     button (the call Files and Agent already made).
 *
 * The script's own words are never translated: `locale` moves the chrome, and
 * whatever language the writer wrote in stays as written.
 */

export type ScriptDetailScreenProps = {
  locale: string;
  detail: ScriptDetail;
  /** the "Jump to a script" rail, grouped by status */
  siblings: Record<string, ScriptListItem[]>;
  /** people who may be asked to approve (never includes the current viewer) */
  approvers: { id: string; name: string }[];
  /** the signed-in person, for "you are the designated approver" */
  viewerId: string;
  tab: "brief" | "draft" | "versions" | "approval";
  /** version being previewed on the Versions tab, or null for the current draft */
  compareVersion: number | null;
  model: string;
  pending: string | null;
  error: string | null;

  onTab: (tab: ScriptDetailScreenProps["tab"]) => void;
  onOpenScript: (scriptId: string) => void;
  onSaveBrief: (form: FormData) => void;
  onSaveDraft: (beats: { visual: string; voiceover: string; subtitle: string; naturalSound: boolean }[]) => void;
  onGenerate: () => void;
  onCheckConformance: () => void;
  onRewrite: (selection: string, instruction: string) => void;
  onSuggestion: (suggestionId: string, action: "accepted" | "rejected" | "moved") => void;
  onCutVersion: (note?: string) => void;
  onRestoreVersion: (versionNo: number) => void;
  onCompare: (versionNo: number | null) => void;
  onRequestApproval: (approverId: string, note?: string) => void;
  onDecideApproval: (approvalId: string, decision: "approved" | "rejected", note?: string) => void;
  onUnlock: () => void;
  onComment: (body: string, beatOrd: number | null) => void;
  /** A cut for this script in Video Edit, made or found. Absent for somebody without Video. */
  onMakeVideo?: () => void;
  onAsk: (prompt: string) => void;
  /** The conversation so far, in the panel. It used to hand the question to
   * /chat, which took the script off the screen to discuss the script. */
  thread?: React.ReactNode;
  /** Where this script is in the line of work — the panel's first tab when
   * the page can read it. */
  run?: React.ReactNode;
  /** The sharing dialog, dropped under the header's Share button. Omitted for
   * somebody who holds nothing to share with, in which case the button says
   * so rather than opening a sheet that can do nothing. */
  shareSheet?: React.ReactNode;
};

/** The artboards' `accent` prop, at its default (#007BE0). */
const ACCENT = "#007be0";

/* --------------------------------------------------------------------- css */

/**
 * The artboards' own <style>, verbatim and in source order (the five share one
 * block, duplicate rules and all, so the cascade inside is unchanged), minus
 * the rail rules (.r — the rail is not ours) and the html/body rules (the
 * artboard is a 1440x900 frame, the product fills the viewport). Every
 * selector is scoped to [data-script-screen] — the roots below — so these
 * one-letter class names cannot collide with, or be overridden by, the rest of
 * the app, which defines its own .n / .lbl / .btn.
 */
const CSS = `
[data-script-screen] { font-family: Inter, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; color: #171717; }
[data-script-screen] * { box-sizing: border-box; }
[data-script-screen] a { color: #007be0; text-decoration: none; }
[data-script-screen] img { display: block; }
[data-script-screen] p { margin: 0; }

/* sidebar */
[data-script-screen] .n { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; transition: background .16s ease; }
[data-script-screen] .n.on { background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); color: #171717; font-weight: 500; }
[data-script-screen] .n b { margin-left: auto; font-size: 11.5px; font-weight: 500; color: #999999; }
[data-script-screen] .lbl { font-size: 11.5px; font-weight: 500; color: #999999; padding: 0 9px; }

/* generic */
[data-script-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-script-screen] .h1 { font-size: 15px; font-weight: 500; }
[data-script-screen] .mut { font-size: 12.5px; color: #999999; }
[data-script-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
[data-script-screen] .btn.p { background: #007be0; color: #fff; font-weight: 500; }
[data-script-screen] .btn.s { border: 1px solid #ededed; color: #525252; }
[data-script-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-script-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 8px; font-size: 12.5px; color: #4a5763; white-space: nowrap; }
[data-script-screen] .chip svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-script-screen] .bd { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11.5px; font-weight: 500; white-space: nowrap; }
[data-script-screen] .gray { background: #f3f3f3; color: #525252 }
[data-script-screen] .blue { background: #e6f4ff; color: #007be0 }
[data-script-screen] .grn  { background: #e4faeb; color: #278f5e }
[data-script-screen] .amb  { background: #fff7d3; color: #db7706 }
[data-script-screen] .red  { background: #ffe7e7; color: #e03636 }
[data-script-screen] .card { border: 1px solid #ededed; border-radius: 12px; background: #fff; padding: 16px; }
[data-script-screen] .kv { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; border-bottom: 1px solid #f3f3f3; font-size: 12.5px; }
[data-script-screen] .kv span:first-child { color: #999999; }
[data-script-screen] .av { width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
[data-script-screen] .stat { border: 1px solid #ededed; border-radius: 12px; padding: 13px 15px; background: #fff; }
[data-script-screen] .stat i { font-style: normal; display: block; font-size: 11.5px; font-weight: 500; color: #999999; }
[data-script-screen] .stat b { display: block; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; margin-top: 6px; font-variant-numeric: tabular-nums; }

[data-script-screen] .num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
[data-script-screen] .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
[data-script-screen] .body { flex-grow: 1; min-height: 0; padding: 18px 20px; overflow: hidden; }
[data-script-screen] .focus { box-shadow: 0 0 0 3px #EFF6FF; }

[data-script-screen] .tabs { height: 40px; flex-shrink: 0; display: flex; align-items: stretch; gap: 20px; padding: 0 22px; border-bottom: 1px solid #ededed; }
[data-script-screen] .tb { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #7c7c7c; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
[data-script-screen] .tb.on { color: #171717; font-weight: 500; border-color: #171717; }
[data-script-screen] .tb b { font-size: 11.5px; font-weight: 500; color: #999999; }
[data-script-screen] .tb i { font-style: normal; display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 8px; background: #e6f4ff; color: #007be0; font-size: 11px; font-weight: 500; }
[data-script-screen] .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #7c7c7c; }
[data-script-screen] .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
[data-script-screen] .cap { font-size: 11.5px; color: #999999; }
[data-script-screen] .fc { height: 26px; padding: 0 10px; border-radius: 7px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #525252; border: 1px solid #ededed; background: #fff; white-space: nowrap; }
[data-script-screen] .fc b { font-weight: 500; color: #999999; font-size: 11.5px; }
[data-script-screen] .fc.on { background: #171717; border-color: #171717; color: #fff; }
[data-script-screen] .fc.on b { color: #c7c7c7; }
[data-script-screen] .fc svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-script-screen] .dot { width: 7px; height: 7px; border-radius: 4px; flex-shrink: 0; }
[data-script-screen] .kbd { display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: 4px; border: 1px solid #e2e2e2; font-size: 11.5px; color: #7c7c7c; background: #fafafa; }
[data-script-screen] .ck { width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
[data-script-screen] .ck svg { width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
[data-script-screen] .cb { width: 16px; height: 16px; border-radius: 4px; border: 1px solid #999999; background: #fff; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
[data-script-screen] .cb.on { border: none; background: #171717; }
[data-script-screen] .cb svg { width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
[data-script-screen] .li { display: flex; gap: 11px; padding: 11px 0; border-bottom: 1px solid #f3f3f3; }
[data-script-screen] .li .a { font-size: 12.5px; color: #171717; }
[data-script-screen] .li .b { font-size: 11.5px; color: #999999; margin-top: 2px; }

/* Finder-style page previews */
[data-script-screen] .well { height: 176px; border-radius: 10px; background: #f5f5f5; display: flex; align-items: center; justify-content: center; position: relative; }
[data-script-screen] .pg { width: 120px; height: 154px; background: #fff; border-radius: 3px; overflow: hidden; box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.08); position: relative; }
[data-script-screen] .pgi { width: 480px; height: 616px; padding: 38px 36px; transform: scale(.25); transform-origin: 0 0; }
[data-script-screen] .pgi h4 { margin: 0; font-size: 23px; font-weight: 600; line-height: 1.2; color: #171717; letter-spacing: -.01em; }
[data-script-screen] .pgi .pm { font-size: 12.5px; color: #999999; margin-top: 8px; padding-bottom: 14px; border-bottom: 1.5px solid #ededed; }
[data-script-screen] .pgi .pb { display: grid; grid-template-columns: 34px 132px 1fr; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f3f3f3; }
[data-script-screen] .pgi .pb i { font-style: normal; font-size: 11px; color: #999999; font-weight: 600; }
[data-script-screen] .pgi .pb span { font-size: 11.5px; line-height: 1.45; color: #7c7c7c; }
[data-script-screen] .pgi .pb p { font-size: 14.5px; line-height: 1.6; color: #383838; }
[data-script-screen] .pgi .pf { background: #f3f3f3; border-radius: 6px; padding: 9px 11px; margin-top: 10px; }
[data-script-screen] .pgi .pf i { display: block; font-style: normal; font-size: 11px; color: #999999; font-weight: 600; margin-bottom: 4px; }
[data-script-screen] .pgi .pf p { font-size: 13px; color: #383838; line-height: 1.4; }

/* script switcher */
[data-script-screen] .sn { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; }
[data-script-screen] .sn span { flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-script-screen] .sn span.dot { flex-grow: 0; }
[data-script-screen] .sn.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
[data-script-screen] .sg { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500; color: #999999; padding: 0 9px; margin: 14px 0 4px; }
[data-script-screen] .sg svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

/* editor */
/* The beats: the one thing on this screen somebody actually reads, and the
   one the client said was too small. Spoken Chinese is now 16.5px on 1.8,
   which is a reading size rather than an interface size — a 14px Han
   character is about as legible as 11px Latin. The columns beside it move up
   with it so the row still reads as one thing. */
[data-script-screen] .bt { display: grid; grid-template-columns: 58px 228px minmax(0, 1fr); gap: 0 20px; padding: 15px 0; border-bottom: 1px solid #f3f3f3; }
[data-script-screen] .bt .bn { font-size: 12px; font-weight: 500; color: #999999; line-height: 1.5; font-variant-numeric: tabular-nums; }
[data-script-screen] .bt .bn b { display: block; font-weight: 500; color: #c7c7c7; }
[data-script-screen] .bt .vi { font-size: 13.5px; line-height: 1.65; color: #7c7c7c; }
[data-script-screen] .bt .zh { font-size: 16.5px; line-height: 1.8; color: #171717; }
[data-script-screen] .bt .en { font-size: 13.5px; line-height: 1.6; color: #7c7c7c; margin-top: 4px; }
[data-script-screen] .ins { background: #e4faeb; color: #1f7a4d; border-radius: 2px; }
[data-script-screen] .del { background: #ffe7e7; color: #c53030; text-decoration: line-through; border-radius: 2px; }
[data-script-screen] .pop { position: absolute; background: #fff; border: 1px solid #e2e2e2; border-radius: 11px; box-shadow: 0 8px 24px rgba(0,0,0,.1), 0 1px 3px rgba(0,0,0,.06); z-index: 3; }
[data-script-screen] .qc { height: 24px; padding: 0 9px; border-radius: 7px; background: #f3f3f3; display: inline-flex; align-items: center; font-size: 11.5px; color: #525252; white-space: nowrap; }
[data-script-screen] .sug { border: 1px solid #ededed; border-radius: 10px; background: #fff; padding: 10px 11px; }
[data-script-screen] .sug .k { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500; color: #999999; }
[data-script-screen] .sug .q { font-size: 12.5px; color: #171717; margin-top: 5px; line-height: 1.45; }
[data-script-screen] .sug .w { font-size: 11.5px; color: #7c7c7c; margin-top: 3px; line-height: 1.45; }
[data-script-screen] .mb { height: 4px; border-radius: 2px; background: #ededed; margin-top: 6px; position: relative; }
[data-script-screen] .mb div { height: 4px; border-radius: 2px; }
[data-script-screen] .inp { min-height: 32px; border-radius: 8px; background: #f3f3f3; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12.5px; color: #171717; }
[data-script-screen] .inp svg { width: 12px; height: 12px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-script-screen] .fl { font-size: 11.5px; font-weight: 500; color: #7c7c7c; margin-bottom: 6px; display: block; }
[data-script-screen] .vr { display: flex; gap: 10px; padding: 11px 12px; border-radius: 9px; width: 100%; text-align: left; }
[data-script-screen] .vr.on { background: #f8f8f8; }
[data-script-screen] .vr .bd { flex-grow: 0; }
[data-script-screen] .ab { width: 18px; height: 18px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }
[data-script-screen] .shot { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #f3f3f3; }
[data-script-screen] .shot i { font-style: normal; width: 22px; font-size: 11.5px; color: #999999; font-weight: 500; font-variant-numeric: tabular-nums; }
[data-script-screen] .shot span { flex-grow: 1; min-width: 0; font-size: 12.5px; color: #383838; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* the product needs a pointer on what it made clickable; the artboard is static */
[data-script-screen] .btn, [data-script-screen] .chip, [data-script-screen] .rtab, [data-script-screen] .tb, [data-script-screen] .sn, [data-script-screen] .qc, [data-script-screen] .vr { cursor: pointer; }
[data-script-screen] button.btn, [data-script-screen] button.tb, [data-script-screen] button.rtab, [data-script-screen] button.sn, [data-script-screen] button.qc, [data-script-screen] button.vr { border: 0; background: none; font-family: inherit; font-size: inherit; letter-spacing: inherit; padding-top: 0; padding-bottom: 0; }
[data-script-screen] button.btn.s { border: 1px solid #ededed; background: #fff; }
[data-script-screen] button:disabled { cursor: default; opacity: .55; }
[data-script-screen] textarea.cell { width: 100%; border: 0; outline: none; resize: none; padding: 0; margin: 0; background: transparent; font-family: inherit; font-size: inherit; line-height: inherit; letter-spacing: inherit; color: inherit; overflow: hidden; display: block; }
[data-script-screen] input.field, [data-script-screen] textarea.field { border: 0; outline: none; background: transparent; font-family: inherit; font-size: inherit; letter-spacing: inherit; color: #171717; min-width: 0; }
[data-script-screen] textarea.field { resize: vertical; line-height: 1.6; padding: 8px 0; }
`;

/* ---------------------------------------------------------------- language */

/** zh-CN strings for the chrome; English is the artboards' own. The script's
 * own words are never in here — they are whatever the writer wrote. */
const ZH: Record<string, string> = {
  "Flow": "流程",
  "All scripts": "全部脚本",
  "Jump to a script": "跳转到脚本",
  Drafting: "撰写中",
  "Awaiting approval": "待审批",
  Briefs: "简报",
  Brief: "简报",
  Locked: "已锁定",
  Archived: "已归档",
  Draft: "草稿",
  Versions: "版本",
  Approval: "审批",
  Share: "共享",
  "No other scripts here": "这里没有其他脚本",
  "Nothing matches": "没有匹配的脚本",

  "Generate from brief": "根据简报生成",
  "Send for approval": "送审",
  "Save brief": "保存简报",
  "Save draft": "保存草稿",
  "Save a version": "保存一个版本",
  Unlock: "解锁",
  "Start": "开始",

  Topic: "选题",
  "From the topic backlog": "来自选题待办",
  Angle: "角度",
  "Target channel": "目标渠道",
  Aspect: "画幅",
  "Target duration": "目标时长",
  seconds: "秒",
  Tolerance: "容差",
  Language: "语言",
  "Subtitle language": "字幕语言",
  "Mandatory points": "必讲要点",
  "One per line": "每行一条",
  "Checked against every draft": "每一稿都会核对",
  Sources: "来源",
  "sources from the database": "个来自数据库的来源",
  "No sources chosen yet": "还没有选择来源",
  "Brief last changed": "简报最后修改于",

  Beat: "分镜",
  Visual: "画面",
  "Voice-over": "旁白",
  subtitle: "字幕",
  "Natural sound": "现场声",
  "Rewrite selection": "改写选中内容",
  "Select some text first": "请先选中一段文字",
  "What should change?": "要怎么改？",
  Shorter: "更短",
  Warmer: "更亲切",
  "More formal": "更正式",
  Rewrite: "改写",
  Cancel: "取消",
  Accept: "接受",
  Reject: "拒绝",
  "Move to shot list": "移到分镜表",
  Keep: "保留",
  "No beats yet": "还没有分镜",
  "Generate from the brief, or write the first beat": "可以根据简报生成，或者自己写第一个分镜",
  beats: "个分镜",
  words: "字",
  spoken: "口播",
  Saved: "已保存",
  "Read-only": "只读",
  target: "目标",

  "House style": "风格规范",
  Agent: "助理",
  Comments: "评论",
  Record: "记录",
  Suggestions: "建议",
  "Accept all": "全部接受",
  "Reject all": "全部拒绝",
  "Nothing flagged": "没有标记",
  "Spoken duration": "口播时长",
  "Reading level": "阅读难度",
  "Flagged terms": "标记词",
  open: "未处理",
  covered: "已覆盖",
  "not checked yet": "尚未检查",
  "Check conformance": "检查规范",
  "Conformance to the house-style guide": "与风格规范的符合度",
  "Conformance to guide": "与规范的符合度",
  was: "上一版",
  at: "于",
  "no target set": "未设定目标",
  "Answers use only sources you can read": "回答只会使用你有权查看的来源",
  "Ask about this script…": "询问这个脚本…",
  "Write a comment…": "写评论…",
  "No comments yet": "还没有评论",
  Send: "发送",
  Comment: "评论",
  "on beat": "在分镜",
  Resolved: "已处理",

  History: "历史",
  versions: "个版本",
  "No versions yet": "还没有版本",
  "Every save is a version. Locking makes one of them the authorised script.":
    "每次保存都是一个版本。锁定会把其中一个定为正式脚本。",
  Current: "当前",
  Restore: "恢复",
  Open: "打开",
  Words: "字数",
  Spoken: "口播",
  Mandatory: "必讲要点",
  Comparing: "对比",
  "Current draft": "当前草稿",
  "This preview carries the version's own record. The words themselves open in the editor.":
    "这里显示的是该版本自身的记录。正文请在编辑器中查看。",

  "Before you lock": "锁定前确认",
  pass: "项通过",
  "All mandatory points are in the script": "所有必讲要点都已写入脚本",
  "checked against the brief": "已对照简报核对",
  "Length within tolerance of target": "时长在目标容差之内",
  "house-style flags still open": "条风格标记未处理",
  "No house-style flags open": "没有未处理的风格标记",
  "Sources credited": "来源已署名",
  "No sources on the brief": "简报上没有来源",
  "You aren’t the author of this version": "你不是这一版的作者",
  "you are the designated approver": "你是指定审批人",
  "You cannot approve your own version.": "你不能审批自己写的版本。",
  "written by": "作者",
  "What Video Edit receives": "视频剪辑将收到",
  "shot cards": "张分镜卡",
  "Approval record": "审批记录",
  Version: "版本",
  Approver: "审批人",
  "Stored in": "存放于",
  "Audit log · permanent": "审计日志 · 永久保存",
  "Approve & lock": "批准并锁定",
  "Request changes": "要求修改",
  "Ask for approval": "请求审批",
  "Who should approve this?": "由谁审批？",
  "Add a note": "附言",
  "Nobody can be asked to approve yet": "目前没有可以请求审批的人",
  "Waiting on": "等待",
  "No approval has been asked for yet": "还没有请求过审批",
  "Requested": "已请求",
  "Approved": "已批准",
  "Rejected": "已退回",
  "Withdrawn": "已撤回",
  "is the authorised version.": "是正式版本。",
  "Approved by": "批准人",
  "Editing starts a new version, which needs approval again.": "继续编辑会开始新版本，需要重新审批。",
  "Records are permanent · in the audit log": "记录永久保存 · 存于审计日志",
  "Written by": "作者",
  "Length": "过渡时长",
  "Earlier versions": "更早的版本",
  "Nothing to approve": "没有待审批的内容",
};

/* ------------------------------------------------------------------ format */

/** "3:48" — the artboards' timecode and duration format. */
function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** "+3 s" / "−3 s" — the sidebar's drift, U+2212 for a shortfall. */
function driftLabel(seconds: number): string {
  const n = Math.round(seconds);
  if (n === 0) return "0 s";
  return `${n < 0 ? "−" : "+"}${Math.abs(n)} s`;
}

/** "2 Sep 09:40" — the version rows and the approval record. */
function stamp(value: Date | string, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${day} ${time}`;
}

/** "2 Sep" — where the hour would be noise. */
function day(value: Date | string, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

/** "2 minutes ago" — carried on the tab strip's "Saved" line. */
function relative(value: Date | string, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const seconds = (d.getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size || unit === "second") return rtf.format(Math.round(seconds / size), unit);
  }
  return "";
}

/**
 * "sha256 4e1b2c3d…c07a" — the approval record's checksum, first eight and
 * last four, so two versions are told apart at a glance without a person
 * pretending to have read 64 hex characters.
 */
function shortChecksum(checksum: string | null): string | null {
  if (!checksum) return null;
  const hex = checksum.replace(/^sha256[:\s-]*/i, "");
  if (hex.length <= 12) return `sha256 ${hex}`;
  return `sha256 ${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

/** No avatar URL anywhere on ScriptDetail, so the artboards' circles carry initials. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** "01" — the beat column. */
function ord2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/* ------------------------------------------------------------------ status */

type Status = ScriptDetail["script"]["status"];

const STATUS_TONE: Record<string, string> = {
  brief: "gray",
  drafting: "blue",
  awaiting_approval: "amb",
  locked: "grn",
  archived: "gray",
};

const STATUS_DOT: Record<string, string> = {
  brief: "#c7c7c7",
  drafting: "#007be0",
  awaiting_approval: "#db7706",
  locked: "#278f5e",
  archived: "#c7c7c7",
};

/** The artboards' four sidebar groups, in their order. */
const GROUP_ORDER: Status[] = ["drafting", "awaiting_approval", "brief", "locked"];

/* ------------------------------------------------------------------- icons */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function DocIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, flexShrink: 0, ...STROKE, stroke: color, strokeWidth: 1.7 }}>
      <path d="M6.5 3.5h7.2L18.5 8v12.5h-12z" />
      <path d="M13.5 3.5V8h5" />
      <path d="M9.2 12.4h6.1M9.2 15.6h6.1" />
    </svg>
  );
}

function LockIcon({ size, color, width = 2 }: { size: number; color: string; width?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, flexShrink: 0, ...STROKE, stroke: color, strokeWidth: width }}>
      <path d="M6.8 10.5h10.4v8H6.8z" />
      <path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5" />
    </svg>
  );
}

function SparkIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, flexShrink: 0, ...STROKE, stroke: color }}>
      <path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
    </svg>
  );
}

function AgentIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size, flexShrink: 0, ...STROKE, stroke: color }}>
      <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
      <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
    </svg>
  );
}

function TickGlyph() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M3.6 8.3 6.5 11.2 12.4 5.1" />
    </svg>
  );
}

function WarnGlyph() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M8 4.2v4.6M8 11.4v.2" />
    </svg>
  );
}

/* ----------------------------------------------------------------- pieces */

/** Layout effect on the client, a plain effect on the server, where there is
 * no layout to measure and the hook would only warn. */
const useMeasure = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * One editable cell of the beats table. The artboard draws text; a script that
 * cannot be typed into is a picture of a script, so each cell is a textarea
 * wearing the artboard's own type (the class is the artboard's) and growing
 * with its content.
 */
function Cell(props: {
  className: string;
  value: string;
  ariaLabel: string;
  placeholder?: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onSelectText: (text: string) => void;
}): React.JSX.Element {
  const { className, value, ariaLabel, placeholder, onChange, onCommit, onSelectText } = props;
  const ref = React.useRef<HTMLTextAreaElement>(null);

  useMeasure(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={`${className} cell`}
      rows={1}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onSelect={(e) => {
        const el = e.currentTarget;
        onSelectText(el.value.slice(el.selectionStart, el.selectionEnd));
      }}
    />
  );
}

/** The artboards' composer: a box, the model's own name, and a send button. */
function Composer(props: {
  placeholder: string;
  sendLabel: string;
  note: string;
  onSend: (text: string) => void;
}): React.JSX.Element {
  const { placeholder, sendLabel, note, onSend } = props;
  const [text, setText] = React.useState("");
  const send = () => {
    if (text.trim() === "") return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div style={{ flexShrink: 0, padding: "11px 13px 9px" }}>
      <div
        style={{
          border: "1px solid #e2e2e2",
          borderRadius: 10,
          background: "#fff",
          padding: "9px 10px 7px",
          boxShadow: "0 1px 2px rgba(0,0,0,.06)",
        }}
      >
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          aria-label={placeholder}
          placeholder={placeholder}
          style={{ width: "100%", fontSize: 12 }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11 }}>
          <span style={{ fontSize: 11.5, color: "#999999" }}>{note}</span>
          <button
            type="button"
            aria-label={sendLabel}
            onClick={send}
            style={{
              width: 25,
              height: 25,
              borderRadius: 7,
              background: ACCENT,
              border: 0,
              padding: 0,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, ...STROKE, stroke: "#fff", strokeWidth: 2.3 }}>
              <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- component */

export function ScriptDetailScreen(props: ScriptDetailScreenProps): React.JSX.Element {
  const {
    locale,
    detail,
    siblings,
    approvers,
    viewerId,
    tab,
    compareVersion,
    model,
    pending,
    error,
    onTab,
    onOpenScript,
    onSaveBrief,
    onSaveDraft,
    onGenerate,
    onCheckConformance,
    onRewrite,
    onSuggestion,
    onCutVersion,
    onRestoreVersion,
    onCompare,
    onRequestApproval,
    onDecideApproval,
    onUnlock,
    onComment,
    onAsk,
    thread,
    run,
    shareSheet,
    onMakeVideo,
  } = props;

  const { script, beats, versions, suggestions, approvals, comments, owner, live, locked } = detail;

  const zh = locale.startsWith("zh");
  const t = (key: string): string => (zh ? (ZH[key] ?? key) : key);

  /* "Jump to a script" — a list of titles, and a title is as long as the
   * writer made it. Draggable, and remembered, like every other column. */
  const { width: jumpWidth, handle: jumpHandle } = useResizable("script-jump", {
    min: 180,
    max: 420,
    initial: 240,
    edge: "right",
  });
  const ids = React.useId();

  /* ---------------------------------------------------------- local state */

  /** The draft as it stands in the browser. Saved with the whole beat list,
   * which is what `onSaveDraft` asks for and what the table means: beats are
   * ordered, so one cell cannot be saved without the order it sits in. */
  type DraftBeat = { visual: string; voiceover: string; subtitle: string; naturalSound: boolean };
  const fromProps = React.useCallback(
    (): DraftBeat[] =>
      beats.map((b) => ({
        visual: b.visual,
        voiceover: b.voiceover,
        subtitle: b.subtitle,
        naturalSound: b.naturalSound,
      })),
    [beats],
  );
  const signature = beats
    .map((b) => [b.id, b.visual, b.voiceover, b.subtitle, b.naturalSound].join("\x00"))
    .join("\x01");

  /* The sharing sheet is a popover, so it closes on Escape and on a click
     anywhere else — a panel that can only be dismissed by the button that
     opened it is the sort of thing people end up navigating away from. */
  const [shareOpen, setShareOpen] = React.useState(false);
  React.useEffect(() => {
    if (!shareOpen) return;
    const away = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-share-anchor]")) return;
      setShareOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShareOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [shareOpen]);

  const [rows, setRows] = React.useState<DraftBeat[]>(fromProps);
  const [applied, setApplied] = React.useState(signature);
  if (applied !== signature) {
    /* Incoming beats changed under us (a save landed, or the agent wrote a
     * draft). React's own "derive state during render" pattern, so a server
     * round trip does not need an effect to show up. */
    setApplied(signature);
    setRows(fromProps());
  }

  const [selection, setSelection] = React.useState("");
  const [rewriteOpen, setRewriteOpen] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [panel, setPanel] = React.useState<"run" | "style" | "agent" | "comments">(run ? "run" : "style");
  const [openSuggestion, setOpenSuggestion] = React.useState<string | null>(null);
  const [focusBeat, setFocusBeat] = React.useState<number | null>(null);
  const [filter, setFilter] = React.useState("");
  const [approverId, setApproverId] = React.useState("");
  const [approvalNote, setApprovalNote] = React.useState("");

  const busy = pending !== null;

  /* ------------------------------------------------------------- derived */

  const tone = STATUS_TONE[script.status] ?? "gray";
  const statusLabel =
    script.status === "awaiting_approval"
      ? t("Awaiting approval")
      : script.status === "brief"
        ? t("Brief")
        : script.status === "drafting"
          ? t("Drafting")
          : script.status === "locked"
            ? t("Locked")
            : t("Archived");
  /** A script with no version yet reads "Brief", not "v0". */
  const versionTag = script.version > 0 ? `v${script.version} · ${statusLabel}` : statusLabel;

  const channelLine = [script.targetChannel, script.aspect].filter(Boolean).join(" · ");
  const ownerName = owner === null ? null : ((zh && owner.nameLocal) || owner.name);

  /** Everyone this screen can put a name to. Ids it cannot name stay unnamed
   * rather than becoming "someone". */
  const nameOf = (id: string | null): string | null => {
    if (id === null) return null;
    if (id === viewerId) return zh ? "你" : "you";
    if (id === script.ownerId && ownerName !== null) return ownerName;
    return approvers.find((p) => p.id === id)?.name ?? null;
  };

  const latest = versions.length > 0 ? versions[0] : null;
  const previous = versions.length > 1 ? versions[1] : null;
  const selectedVersion =
    compareVersion === null ? latest : (versions.find((v) => v.versionNo === compareVersion) ?? latest);

  const lockedVersion = script.lockedVersion;
  const lockedRow = lockedVersion === null ? null : (versions.find((v) => v.versionNo === lockedVersion) ?? null);

  /** The approval in play: the newest request still waiting, else the newest. */
  const requested = approvals.find((a) => a.state === "requested") ?? null;
  const newestApproval = approvals.length > 0 ? approvals[0] : null;
  const approvedRecord = approvals.find((a) => a.state === "approved") ?? null;
  const viewerIsApprover = requested !== null && requested.approverId === viewerId;
  /**
   * "You aren't the author of this version".
   *
   * `VersionRow` carries the author's *name*, not their id, so this cannot be
   * the id comparison the contract describes. The two ids the screen does hold
   * are the owner of the script and whoever asked for this approval, and
   * either one being the viewer means the viewer is on the writing side of it.
   */
  const viewerIsAuthor = script.ownerId === viewerId || (requested !== null && requested.requestedBy === viewerId);

  const openFlags = suggestions.length;
  const mandatoryTotal = script.mandatoryPoints.length;

  const pointsCovered = latest === null ? null : latest.mandatoryCovered;
  const conformance = latest === null ? null : latest.conformance;
  const readingLevel = latest === null ? null : latest.readingLevel;
  const guideVersion = latest === null ? null : latest.guideVersion;

  const suggestionByBeat = new Map<number, typeof suggestions>();
  for (const s of suggestions) {
    if (s.beatOrd === null) continue;
    const list = suggestionByBeat.get(s.beatOrd) ?? [];
    list.push(s);
    suggestionByBeat.set(s.beatOrd, list);
  }
  const activeSuggestionId =
    suggestions.find((s) => s.id === openSuggestion)?.id ?? (suggestions.length > 0 ? suggestions[0].id : null);

  const kindLabel = (kind: string): string => {
    const map: Record<string, [string, string]> = {
      house_style: ["House style", "风格规范"],
      length: ["Length", "过渡时长"],
      register: ["Register", "语体"],
      clarity: ["Clarity", "清晰度"],
      sound_direction: ["Sound direction", "声音指示"],
      fact_check: ["Fact check", "事实核查"],
    };
    const pair = map[kind];
    return pair === undefined ? kind : zh ? pair[1] : pair[0];
  };
  const kindDot = (kind: string): string =>
    kind === "length" || kind === "clarity"
      ? "#007be0"
      : kind === "fact_check"
        ? "#e03636"
        : kind === "register"
          ? "#c7c7c7"
          : "#db7706";

  /* ------------------------------------------------------------- actions */

  const commitDraft = () => {
    if (locked) return;
    const same =
      rows.length === beats.length &&
      rows.every(
        (r, i) =>
          r.visual === beats[i].visual &&
          r.voiceover === beats[i].voiceover &&
          r.subtitle === beats[i].subtitle &&
          r.naturalSound === beats[i].naturalSound,
      );
    if (same) return;
    onSaveDraft(rows);
  };

  const patch = (index: number, next: Partial<DraftBeat>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...next } : r)));
  };

  const runRewrite = (text: string) => {
    if (selection.trim() === "" || text.trim() === "") return;
    onRewrite(selection, text.trim());
    setRewriteOpen(false);
    setInstruction("");
  };

  const submitBrief = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSaveBrief(new FormData(e.currentTarget));
  };

  /* -------------------------------------------------------------- header */

  const primaryAction = (() => {
    if (locked) {
      /* The locked artboard offers "Start v7". Starting the next version is
         exactly what unlocking is, so the label says what happens and the
         call is the one the contract gives. */
      return (
        <button type="button" className="btn s" onClick={onUnlock} disabled={busy}>
          <svg viewBox="0 0 24 24">
            <path d="M12 6v12M6 12h12" />
          </svg>
          {zh ? `解锁并开始 v${script.version + 1}` : `Unlock to start v${script.version + 1}`}
        </button>
      );
    }
    if (tab === "brief") {
      return (
        <button
          type="button"
          className="btn"
          onClick={onGenerate}
          disabled={busy}
          style={{ background: ACCENT, color: "#fff", fontWeight: 500 }}
        >
          <SparkIcon size={13} color="currentColor" />
          {t("Generate from brief")}
        </button>
      );
    }
    if (tab === "draft") {
      return (
        <button
          type="button"
          className="btn"
          onClick={() => onTab("approval")}
          disabled={busy}
          style={{ background: ACCENT, color: "#fff", fontWeight: 500 }}
        >
          {t("Send for approval")}
        </button>
      );
    }
    if (tab === "versions") {
      return (
        <button
          type="button"
          className="btn"
          onClick={() => {
            onCompare(null);
            onTab("draft");
          }}
          disabled={busy}
          style={{ background: ACCENT, color: "#fff", fontWeight: 500 }}
        >
          {script.version > 0 ? `${t("Open")} v${script.version}` : t("Open")}
        </button>
      );
    }
    /* Approval: the decision is the primary action, and only the person who
       was asked ever sees it. */
    if (viewerIsApprover && requested !== null) {
      return (
        <button
          type="button"
          className="btn"
          onClick={() => onDecideApproval(requested.id, "approved", approvalNote.trim() || undefined)}
          disabled={busy}
          style={{ background: ACCENT, color: "#fff", fontWeight: 500 }}
        >
          <LockIcon size={13} color="currentColor" />
          {`${t("Approve & lock")} v${requested.versionNo ?? script.version}`}
        </button>
      );
    }
    return null;
  })();

  const secondaryAction = (() => {
    if (locked) return null;
    if (tab === "versions" && compareVersion !== null && compareVersion !== script.version) {
      return (
        <button type="button" className="btn s" onClick={() => onRestoreVersion(compareVersion)} disabled={busy}>
          {`${t("Restore")} v${compareVersion}`}
        </button>
      );
    }
    if (tab === "approval" && viewerIsApprover && requested !== null) {
      return (
        <button
          type="button"
          className="btn s"
          onClick={() => onDecideApproval(requested.id, "rejected", approvalNote.trim() || undefined)}
          disabled={busy}
        >
          {t("Request changes")}
        </button>
      );
    }
    if (tab === "draft") {
      return (
        <button type="button" className="btn s" onClick={() => onCutVersion()} disabled={busy}>
          {t("Save a version")}
        </button>
      );
    }
    return null;
  })();

  const header = (
    <div className="bar" style={{ height: 52, gap: 10 }}>
      <DocIcon size={16} color="#7c7c7c" />
      <span
        className="h1"
        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}
        title={script.title}
      >
        {(zh && script.titleLocal) || script.title}
      </span>
      {locked ? (
        <span className={`bd ${tone}`} style={{ gap: 4 }}>
          <LockIcon size={10} color="currentColor" width={2.2} />
          {`v${lockedVersion} · ${t("Locked")}`}
        </span>
      ) : (
        <span className={`bd ${tone}`}>{versionTag}</span>
      )}
      {channelLine === "" ? null : (
        <span className="mut" style={{ whiteSpace: "nowrap" }}>
          {channelLine}
        </span>
      )}
      <div style={{ flexGrow: 1 }}></div>
      {ownerName === null ? null : (
        <div
          className="av"
          title={ownerName}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            background: "#f3f3f3",
            color: "#7c7c7c",
            fontSize: 9.5,
            fontWeight: 500,
            letterSpacing: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 2px #fff",
          }}
        >
          {initials(ownerName)}
        </div>
      )}
      {onMakeVideo ? (
        /* The other end of the pipeline: a cut in Video Edit tied to this
           script, so the director reads the beats as the shape the footage
           was shot to. */
        <>
          {/* The clips are what the script waits for: one press opens this
              script's video project with the upload in front. */}
          <button type="button" className="btn s" onClick={onMakeVideo} disabled={busy}>
            <Icon name="upload" size={14} /> {zh ? "添加素材" : "Add clips"}
          </button>
          <button type="button" className="btn p" onClick={onMakeVideo} disabled={busy} style={{ background: "#171717" }}>
            {zh ? "去剪辑 →" : "Make the video →"}
          </button>
        </>
      ) : null}
      {/* The artboards' Share button. Per-script sharing rides the same
          `relation_tuples` Files uses, so a script shared with somebody shows
          up under "Shared with me" in their library. */}
      {shareSheet ? (
        <span data-share-anchor="" style={{ position: "relative" }}>
          <button
            type="button"
            className="btn s"
            aria-expanded={shareOpen}
            onClick={() => setShareOpen((v) => !v)}
          >
            {t("Share")}
          </button>
          {shareOpen ? (
            <div
              /* Anchored to the button and above everything else, because the
                 header sits in a scrolling column: rendered in flow it would
                 shove the tab strip down every time it opened. */
              style={{
                position: "absolute",
                top: "calc(100% + 7px)",
                right: 0,
                zIndex: 40,
                width: 368,
                maxWidth: "min(368px, 84vw)",
                background: "#ffffff",
                /* No border of its own: the sheet inside draws one, and two
                   rings 4px apart look like a mistake. */
                borderRadius: 12,
                boxShadow: "0 12px 34px rgba(0,0,0,0.13)",
              }}
            >
              {shareSheet}
            </div>
          ) : null}
        </span>
      ) : (
        <span
          className="btn s"
          role="note"
          title={zh ? "你无权共享这份脚本" : "You cannot share this script"}
        >
          {t("Share")}
        </span>
      )}
      {secondaryAction}
      {primaryAction}
    </div>
  );

  /* ---------------------------------------------------------- tab strip */

  const tabNote = (() => {
    if (locked) {
      const at = approvedRecord?.decidedAt ?? null;
      return (
        <span className="cap">
          {t("Read-only")}
          {at === null ? "" : ` · ${zh ? "批准于" : "approved"} ${stamp(at, locale)}`}
        </span>
      );
    }
    if (tab === "brief") {
      return script.briefUpdatedAt === null ? null : (
        <span className="cap">{`${t("Brief last changed")} ${day(script.briefUpdatedAt, locale)}`}</span>
      );
    }
    if (tab === "draft") {
      return (
        <>
          <span className="cap">{`${t("Saved")} · ${relative(script.updatedAt, locale)}`}</span>
          <DurationBadge live={live} t={t} />
        </>
      );
    }
    if (tab === "versions") {
      return compareVersion === null ? null : (
        <>
          <span className="cap">{t("Comparing")}</span>
          <span className="chip" style={{ height: 26 }}>
            <span className="ab" style={{ background: "#ffe7e7", color: "#e03636" }}>
              A
            </span>
            {`v${compareVersion}`}
          </span>
          <span className="chip" style={{ height: 26 }}>
            <span className="ab" style={{ background: "#e4faeb", color: "#278f5e" }}>
              B
            </span>
            {`v${script.version}`}
          </span>
        </>
      );
    }
    if (requested !== null) {
      const who = nameOf(requested.requestedBy);
      return (
        <span className="cap">
          {who === null
            ? `${t("Requested")} · ${stamp(requested.requestedAt, locale)}`
            : `${zh ? `由${who}送审` : `Requested by ${who}`} · ${stamp(requested.requestedAt, locale)}`}
        </span>
      );
    }
    return <span className="cap">{t("No approval has been asked for yet")}</span>;
  })();

  const tabStrip = (
    <div className="tabs">
      {(
        [
          ["brief", t("Brief"), null],
          ["draft", t("Draft"), null],
          ["versions", t("Versions"), versions.length > 0 ? String(versions.length) : null],
          ["approval", t("Approval"), null],
        ] as const
      ).map(([key, label, count]) => (
        <button key={key} type="button" className={`tb${tab === key ? " on" : ""}`} onClick={() => onTab(key)}>
          {label}
          {count === null ? null : <b>{count}</b>}
        </button>
      ))}
      <div style={{ flexGrow: 1 }}></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{tabNote}</div>
    </div>
  );

  /* ------------------------------------------------------------- sidebar */

  const needle = filter.trim().toLowerCase();
  const groupKeys = [...GROUP_ORDER, ...Object.keys(siblings).filter((k) => !GROUP_ORDER.includes(k as Status))];
  const groupLabel = (key: string): string =>
    key === "drafting"
      ? t("Drafting")
      : key === "awaiting_approval"
        ? t("Awaiting approval")
        : key === "brief"
          ? t("Briefs")
          : key === "locked"
            ? t("Locked")
            : key === "archived"
              ? t("Archived")
              : key;

  let shown = 0;
  const groups = groupKeys.map((key) => {
    const all = siblings[key] ?? [];
    const list = needle === "" ? all : all.filter((s) => s.title.toLowerCase().includes(needle));
    shown += list.length;
    if (list.length === 0) return null;
    return (
      <div key={key}>
        <div className="sg">
          <svg viewBox="0 0 24 24">
            <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
          </svg>
          {groupLabel(key)}
          <span style={{ marginLeft: "auto", fontWeight: 420 }}>{list.length}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sn${s.id === script.id ? " on" : ""}`}
              onClick={() => onOpenScript(s.id)}
              title={s.title}
            >
              <span className="dot" style={{ background: STATUS_DOT[s.status] ?? "#c7c7c7" }}></span>
              <span>{s.title}</span>
              {s.ownerName === null ? null : (
                <span
                  className="dot"
                  title={s.ownerName}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    background: "#f3f3f3",
                    color: "#7c7c7c",
                    fontSize: 8,
                    fontWeight: 500,
                    letterSpacing: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {initials(s.ownerName)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  });

  const sidebar = (
    <div
      data-script-screen=""
      style={{
        width: jumpWidth,
        flexShrink: 0,
        position: "relative",
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        padding: "8px 8px 10px",
        overflowY: "auto",
      }}
    >
      {jumpHandle}
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 0 0 9px", fontSize: 12, color: "#7c7c7c" }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, ...STROKE, stroke: "#7c7c7c", strokeWidth: 2 }}>
          <path d="m14.5 6-6 6 6 6" />
        </svg>
        {t("All scripts")}
      </div>
      {/* The artboard drew this as a static box with a ⌘K hint behind it. A box
          that narrows the list below is the same affordance without a palette
          nobody has written yet. */}
      <div
        style={{
          height: 30,
          borderRadius: 8,
          background: "#fff",
          border: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 9px",
          margin: "10px 1px 0",
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, ...STROKE, stroke: "#999999", strokeWidth: 1.9 }}>
          <circle cx="11" cy="11" r="6.4" />
          <path d="m15.8 15.8 4 4" />
        </svg>
        <input
          className="field"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t("Jump to a script")}
          placeholder={t("Jump to a script")}
          style={{ flexGrow: 1, fontSize: 12 }}
        />
      </div>
      {groups}
      {shown === 0 ? (
        <p className="cap" style={{ padding: "14px 9px 0", lineHeight: 1.5 }}>
          {needle === "" ? t("No other scripts here") : t("Nothing matches")}
        </p>
      ) : null}
    </div>
  );

  /* --------------------------------------------------------- brief body */

  const briefFields = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 14px" }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <label className="fl" htmlFor={`${ids}-title`}>
          {t("Topic")}
        </label>
        <div className="inp">
          <input
            id={`${ids}-title`}
            className="field"
            name="title"
            defaultValue={script.title}
            readOnly={locked}
            style={{ flexGrow: 1, fontSize: 12.5 }}
          />
          {script.topicId === null ? null : (
            <span className="bd blue" style={{ height: 20 }}>
              {t("From the topic backlog")}
            </span>
          )}
        </div>
      </div>
      <div>
        <label className="fl" htmlFor={`${ids}-angle`}>
          {t("Angle")}
        </label>
        <div className="inp">
          <input
            id={`${ids}-angle`}
            className="field"
            name="angle"
            defaultValue={script.angle ?? ""}
            readOnly={locked}
            style={{ flexGrow: 1, fontSize: 12.5 }}
          />
        </div>
      </div>
      <div>
        <label className="fl" htmlFor={`${ids}-channel`}>
          {`${t("Target channel")} · ${t("Aspect")}`}
        </label>
        <div className="inp">
          <input
            id={`${ids}-channel`}
            className="field"
            name="targetChannel"
            defaultValue={script.targetChannel ?? ""}
            readOnly={locked}
            style={{ flexGrow: 1, fontSize: 12.5 }}
          />
          <span style={{ color: "#c7c7c7" }}>·</span>
          <input
            className="field"
            name="aspect"
            aria-label={t("Aspect")}
            defaultValue={script.aspect ?? ""}
            readOnly={locked}
            style={{ width: 56, fontSize: 12.5 }}
          />
        </div>
      </div>
      <div>
        <label className="fl" htmlFor={`${ids}-seconds`}>
          {t("Target duration")}
        </label>
        <div className="inp">
          <input
            id={`${ids}-seconds`}
            className="field"
            name="targetSeconds"
            type="number"
            min={0}
            step={1}
            defaultValue={script.targetSeconds ?? ""}
            readOnly={locked}
            style={{ flexGrow: 1, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}
          />
          <span className="cap">{t("seconds")}</span>
          <span style={{ color: "#c7c7c7" }}>·</span>
          <span className="cap">±</span>
          <input
            className="field"
            name="tolerancePercent"
            type="number"
            min={0}
            max={50}
            step={0.5}
            aria-label={t("Tolerance")}
            defaultValue={script.tolerancePercent}
            readOnly={locked}
            style={{ width: 40, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}
          />
          <span className="cap">%</span>
        </div>
      </div>
      <div>
        <label className="fl" htmlFor={`${ids}-lang`}>
          {t("Language")}
        </label>
        <div className="inp">
          <input
            id={`${ids}-lang`}
            className="field"
            name="language"
            defaultValue={script.language ?? ""}
            readOnly={locked}
            style={{ flexGrow: 1, fontSize: 12.5 }}
          />
        </div>
      </div>
      <div>
        <label className="fl" htmlFor={`${ids}-sublang`}>
          {t("Subtitle language")}
        </label>
        <div className="inp">
          <input
            id={`${ids}-sublang`}
            className="field"
            name="subtitleLanguage"
            defaultValue={script.subtitleLanguage ?? ""}
            readOnly={locked}
            style={{ flexGrow: 1, fontSize: 12.5 }}
          />
        </div>
      </div>
    </div>
  );

  const briefPoints = (
    <>
      <div style={{ display: "flex", alignItems: "center", margin: "20px 0 4px" }}>
        <label className="fl" style={{ margin: 0 }} htmlFor={`${ids}-points`}>
          {t("Mandatory points")}
        </label>
        <span className="cap" style={{ marginLeft: "auto" }}>
          {pointsCovered === null || mandatoryTotal === 0
            ? t("Checked against every draft")
            : `${pointsCovered} / ${mandatoryTotal} ${t("covered")}${latest === null ? "" : ` · v${latest.versionNo}`}`}
        </span>
      </div>
      <div className="inp" style={{ alignItems: "stretch", padding: "0 10px" }}>
        <textarea
          id={`${ids}-points`}
          className="field"
          name="mandatoryPoints"
          rows={Math.max(3, script.mandatoryPoints.length + 1)}
          defaultValue={script.mandatoryPoints.join("\n")}
          readOnly={locked}
          placeholder={t("One per line")}
          style={{ flexGrow: 1, fontSize: 12.5, width: "100%" }}
        />
      </div>
      <div className="cap" style={{ marginTop: 6 }}>
        {t("One per line")}
      </div>
    </>
  );

  const briefSources = (
    <div className="card" style={{ padding: 14 }}>
      <div className="lbl" style={{ padding: 0, marginBottom: 8 }}>
        {t("Sources")}
      </div>
      {script.sourceFileIds.length === 0 ? (
        <p className="cap" style={{ lineHeight: 1.5 }}>
          {t("No sources chosen yet")}
        </p>
      ) : (
        <p style={{ fontSize: 12, lineHeight: 1.55, color: "#383838" }}>
          {`${script.sourceFileIds.length} ${t("sources from the database")}`}
        </p>
      )}
      {/* The artboard listed each source by name with its licence. Those names
          live in the Files module and no prop carries them here, so the count
          is what this screen can say truthfully. */}
    </div>
  );

  const briefBody = (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", gap: 22, padding: "20px 22px 0", overflowY: "auto" }}>
      <form onSubmit={submitBrief} style={{ flexGrow: 1, minWidth: 0 }}>
        {briefFields}
        {briefPoints}
        {locked ? null : (
          <div style={{ display: "flex", gap: 8, marginTop: 18, paddingBottom: 20 }}>
            <button type="submit" className="btn" disabled={busy} style={{ background: ACCENT, color: "#fff", fontWeight: 500 }}>
              {t("Save brief")}
            </button>
            <span className="cap" style={{ alignSelf: "center" }}>
              {script.briefUpdatedAt === null ? "" : `${t("Saved")} · ${relative(script.briefUpdatedAt, locale)}`}
            </span>
          </div>
        )}
      </form>
      <div style={{ width: 262, flexShrink: 0 }}>{briefSources}</div>
    </div>
  );

  /* --------------------------------------------------------- draft body */

  const beatRows = rows.map((row, index) => {
    const beat = beats[index];
    const mine = suggestionByBeat.get(beat.ord) ?? [];
    const shownSuggestion = mine.find((s) => s.id === activeSuggestionId) ?? null;

    return (
      <div
        key={beat.id}
        className="bt"
        style={{ position: "relative" }}
        onFocus={() => setFocusBeat(beat.ord)}
      >
        <div className="bn">
          {ord2(beat.ord)}
          {beat.startSeconds === null ? null : <b>{clock(beat.startSeconds)}</b>}
        </div>
        {locked ? (
          <div className="vi">{beat.visual}</div>
        ) : (
          <Cell
            className="vi"
            value={row.visual}
            ariaLabel={`${t("Visual")} ${ord2(beat.ord)}`}
            onChange={(next) => patch(index, { visual: next })}
            onCommit={commitDraft}
            onSelectText={setSelection}
          />
        )}
        <div>
          {locked ? (
            <>
              <div className="zh">{beat.voiceover}</div>
              <div className="en">{beat.subtitle}</div>
            </>
          ) : (
            <>
              <Cell
                className="zh"
                value={row.voiceover}
                ariaLabel={`${t("Voice-over")} ${ord2(beat.ord)}`}
                onChange={(next) => patch(index, { voiceover: next })}
                onCommit={commitDraft}
                onSelectText={setSelection}
              />
              <Cell
                className="en"
                value={row.subtitle}
                ariaLabel={`${t("subtitle")} ${ord2(beat.ord)}`}
                onChange={(next) => patch(index, { subtitle: next })}
                onCommit={commitDraft}
                onSelectText={setSelection}
              />
              {/* The artboard writes "（现场声）· Natural sound only" into beat
                  01 as text. It is a column on the beat, it changes how the
                  duration is estimated, and Video is told about it, so it gets
                  a control rather than a convention. */}
              <button
                type="button"
                onClick={() => {
                  /* The toggle saves the list it just made, not the one this
                     render closed over. */
                  const next = rows.map((r, i) =>
                    i === index ? { ...r, naturalSound: !r.naturalSound } : r,
                  );
                  setRows(next);
                  onSaveDraft(next);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginTop: 7,
                  border: 0,
                  background: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "inherit",
                }}
              >
                <span className={`cb${row.naturalSound ? " on" : ""}`}>
                  {row.naturalSound ? (
                    <svg viewBox="0 0 24 24">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </span>
                <span className="cap">{t("Natural sound")}</span>
              </button>
            </>
          )}
        </div>

        {shownSuggestion === null || locked ? null : (
          <div className="pop" style={{ left: 60, top: 58, width: 318, padding: "11px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="dot" style={{ background: kindDot(shownSuggestion.kind) }}></span>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: "#7c7c7c" }}>
                {`${kindLabel(shownSuggestion.kind)} · ${shownSuggestion.label}`}
              </span>
              <span className="cap" style={{ marginLeft: "auto" }}>
                {`${suggestions.findIndex((s) => s.id === shownSuggestion.id) + 1} ${zh ? "/" : "of"} ${suggestions.length}`}
              </span>
            </div>
            {shownSuggestion.before === null && shownSuggestion.after === null ? null : (
              <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 7 }}>
                {shownSuggestion.before === null ? null : <span className="del">{shownSuggestion.before}</span>}
                {shownSuggestion.before === null || shownSuggestion.after === null ? null : " "}
                {shownSuggestion.after === null ? null : <span className="ins">{shownSuggestion.after}</span>}
              </div>
            )}
            {shownSuggestion.rationale === null ? null : (
              <div className="cap" style={{ marginTop: 5, lineHeight: 1.45 }}>
                {shownSuggestion.rationale}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {shownSuggestion.kind === "sound_direction" ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onSuggestion(shownSuggestion.id, "moved")}
                    disabled={busy}
                    style={{ height: 26, fontSize: 12, background: "#171717", color: "#fff", fontWeight: 500 }}
                  >
                    {t("Move to shot list")}
                  </button>
                  <button
                    type="button"
                    className="btn s"
                    onClick={() => onSuggestion(shownSuggestion.id, "rejected")}
                    disabled={busy}
                    style={{ height: 26, fontSize: 12 }}
                  >
                    {t("Keep")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onSuggestion(shownSuggestion.id, "accepted")}
                    disabled={busy}
                    style={{ height: 26, fontSize: 12, background: "#171717", color: "#fff", fontWeight: 500 }}
                  >
                    {t("Accept")}
                  </button>
                  <button
                    type="button"
                    className="btn s"
                    onClick={() => onSuggestion(shownSuggestion.id, "rejected")}
                    disabled={busy}
                    style={{ height: 26, fontSize: 12 }}
                  >
                    {t("Reject")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  });

  const draftToolbar = (
    <div
      style={{
        height: 42,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 20px",
        borderBottom: "1px solid #f3f3f3",
        position: "relative",
      }}
    >
      <span className="chip" style={{ height: 28, fontSize: 12, border: "none", background: "#f3f3f3" }}>
        {`${t("Beat")} ${focusBeat === null ? "" : ord2(focusBeat)}`}
      </span>
      <div style={{ flexGrow: 1 }}></div>
      <button
        type="button"
        onClick={() => setRewriteOpen((v) => !v)}
        disabled={selection.trim() === ""}
        title={selection.trim() === "" ? t("Select some text first") : selection}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          height: 28,
          padding: "0 10px",
          borderRadius: 8,
          border: "1px solid #ededed",
          background: "#fff",
          fontFamily: "inherit",
          letterSpacing: "inherit",
          cursor: selection.trim() === "" ? "default" : "pointer",
          opacity: selection.trim() === "" ? 0.55 : 1,
        }}
      >
        <SparkIcon size={13} color={ACCENT} />
        <span style={{ fontSize: 12, color: "#525252" }}>{t("Rewrite selection")}</span>
        <span className="kbd">⌘J</span>
      </button>
      {[script.language, script.subtitleLanguage].filter(Boolean).length === 0 ? null : (
        <span className="cap" style={{ marginLeft: 10 }}>
          {[script.language, script.subtitleLanguage].filter(Boolean).join(" · ")}
        </span>
      )}

      {rewriteOpen ? (
        <div className="pop" style={{ right: 20, top: 38, width: 386, padding: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 8px" }}>
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, ...STROKE, stroke: ACCENT }}>
              <path d="m12 3.5 1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
              <path d="M18.5 16v4M16.5 18h4" />
            </svg>
            <input
              className="field"
              value={instruction}
              autoFocus
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runRewrite(instruction);
                } else if (e.key === "Escape") {
                  setRewriteOpen(false);
                }
              }}
              aria-label={t("What should change?")}
              placeholder={t("What should change?")}
              style={{ flexGrow: 1, fontSize: 12.5 }}
            />
            <span className="kbd">⏎</span>
          </div>
          <div style={{ display: "flex", gap: 5, padding: "3px 6px 5px", borderTop: "1px solid #f3f3f3" }}>
            {[
              [t("Shorter"), "Shorter"],
              [t("Warmer"), "Warmer"],
              [t("More formal"), "More formal"],
              ["转做书面语", "转做书面语"],
            ].map(([label, value]) => (
              <button key={value} type="button" className="qc" onClick={() => runRewrite(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  const draftBody = (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {locked ? null : draftToolbar}
      <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "20px 30px 20px" }}>
        {locked ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "11px 13px",
              borderRadius: 11,
              background: "#f3fbf6",
              border: "1px solid #c9ecd6",
              marginBottom: 18,
            }}
          >
            <div className="ck" style={{ background: "#278f5e", width: 22, height: 22, borderRadius: 11 }}>
              <LockIcon size={11} color="#fff" width={2.2} />
            </div>
            <div style={{ flexGrow: 1, fontSize: 12.5, lineHeight: 1.5, color: "#1f6b47" }}>
              <b style={{ fontWeight: 500 }}>{`v${lockedVersion} ${t("is the authorised version.")}`}</b>{" "}
              {approvedRecord === null || nameOf(approvedRecord.decidedBy ?? approvedRecord.approverId) === null
                ? ""
                : `${t("Approved by")} ${nameOf(approvedRecord.decidedBy ?? approvedRecord.approverId)}. `}
              {t("Editing starts a new version, which needs approval again.")}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.01em" }}>
            {(zh && script.titleLocal) || script.title}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 8,
            paddingBottom: 12,
            fontSize: 12,
            color: "#7c7c7c",
            flexWrap: "wrap",
          }}
        >
          {ownerName === null ? null : (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                className="av"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  background: "#f3f3f3",
                  color: "#7c7c7c",
                  fontSize: 8,
                  fontWeight: 500,
                  letterSpacing: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {initials(ownerName)}
              </span>
              {ownerName}
            </span>
          )}
          {script.angle === null ? null : (
            <>
              <span style={{ color: "#e2e2e2" }}>|</span>
              <span>{script.angle}</span>
            </>
          )}
          <span style={{ color: "#e2e2e2" }}>|</span>
          <span>
            {`${live.beats} ${t("beats")} · ${live.wordCount} ${t("words")} · ${clock(live.spokenSeconds)} ${t("spoken")}`}
          </span>
        </div>

        <div className="bt" style={{ padding: "8px 0", borderBottom: "1px solid #ededed", borderTop: "1px solid #ededed" }}>
          <div className="bn" style={{ color: "#7c7c7c" }}>
            {t("Beat")}
          </div>
          <div className="bn" style={{ color: "#7c7c7c" }}>
            {t("Visual")}
          </div>
          <div className="bn" style={{ color: "#7c7c7c" }}>
            {[t("Voice-over"), script.language, `${script.subtitleLanguage ?? ""} ${t("subtitle")}`.trim()]
              .filter((s) => s !== null && s !== "" && s !== t("subtitle"))
              .join(" · ")}
          </div>
        </div>

        {beatRows.length === 0 ? (
          <div style={{ padding: "26px 0" }}>
            <div style={{ fontSize: 12.5, color: "#525252" }}>{t("No beats yet")}</div>
            <div className="cap" style={{ marginTop: 4, lineHeight: 1.5 }}>
              {t("Generate from the brief, or write the first beat")}
            </div>
          </div>
        ) : (
          beatRows
        )}
      </div>
    </div>
  );

  /* ------------------------------------------------------ versions body */

  const versionList = (
    <div style={{ width: 232, flexShrink: 0, borderRight: "1px solid #ededed", padding: "14px 10px", overflowY: "auto" }}>
      <div className="lbl" style={{ marginBottom: 8 }}>
        {`${t("History")} · ${versions.length} ${t("versions")}`}
      </div>
      {versions.length === 0 ? (
        <p className="cap" style={{ padding: "0 12px", lineHeight: 1.5 }}>
          {t("No versions yet")}
        </p>
      ) : null}
      {versions.map((v) => {
        const picked = compareVersion === null ? v.versionNo === script.version : v.versionNo === compareVersion;
        const author = (zh && v.authorNameLocal) || v.authorName;
        return (
          <button
            key={v.id}
            type="button"
            className={`vr${picked ? " on" : ""}`}
            onClick={() => onCompare(v.versionNo === script.version ? null : v.versionNo)}
          >
            <span
              className="ab"
              style={
                v.versionNo === script.version
                  ? { background: "#e4faeb", color: "#278f5e" }
                  : picked
                    ? { background: "#ffe7e7", color: "#e03636" }
                    : { border: "1px solid #e2e2e2" }
              }
            >
              {v.versionNo === script.version ? "B" : picked ? "A" : ""}
            </span>
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{`v${v.versionNo}`}</span>
                {v.versionNo === script.version ? (
                  <span className="bd blue" style={{ height: 18, fontSize: 11.5 }}>
                    {t("Current")}
                  </span>
                ) : null}
                {v.versionNo === lockedVersion ? (
                  <span className="bd grn" style={{ height: 18, fontSize: 11.5 }}>
                    {t("Locked")}
                  </span>
                ) : null}
                {v.model === null ? null : (
                  <span className="bd gray" style={{ height: 18, fontSize: 11.5 }}>
                    {t("Agent")}
                  </span>
                )}
              </div>
              {v.note === null ? null : (
                <div style={{ fontSize: 12, color: "#383838", marginTop: 3, lineHeight: 1.4 }}>{v.note}</div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                <span className="cap">
                  {author === null ? stamp(v.createdAt, locale) : `${author} · ${stamp(v.createdAt, locale)}`}
                </span>
              </div>
            </div>
          </button>
        );
      })}
      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 9, background: "#f8f8f8" }}>
        <div className="cap" style={{ lineHeight: 1.5 }}>
          {t("Every save is a version. Locking makes one of them the authorised script.")}
        </div>
      </div>
    </div>
  );

  const versionsBody = (
    <>
      {versionList}
      <div style={{ flexGrow: 1, minWidth: 0, padding: "16px 20px 0", overflowY: "auto" }}>
        {selectedVersion === null ? (
          <p className="cap" style={{ lineHeight: 1.5 }}>
            {t("No versions yet")}
          </p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <div className="stat" style={{ padding: "9px 11px" }}>
                <i>{t("Words")}</i>
                <b style={{ fontSize: 16 }}>{selectedVersion.wordCount}</b>
              </div>
              <div className="stat" style={{ padding: "9px 11px" }}>
                <i>{t("Spoken")}</i>
                <b style={{ fontSize: 16 }}>
                  {selectedVersion.spokenSeconds === null ? (
                    <span className="cap">{t("not checked yet")}</span>
                  ) : (
                    clock(selectedVersion.spokenSeconds)
                  )}
                </b>
              </div>
              <div className="stat" style={{ padding: "9px 11px" }}>
                <i>{t("House style")}</i>
                <b style={{ fontSize: 16 }}>
                  {selectedVersion.conformance === null ? (
                    <span className="cap">{t("not checked yet")}</span>
                  ) : (
                    `${Math.round(selectedVersion.conformance)} / 100`
                  )}
                </b>
              </div>
              <div className="stat" style={{ padding: "9px 11px" }}>
                <i>{t("Mandatory")}</i>
                <b style={{ fontSize: 16 }}>{`${selectedVersion.mandatoryCovered} / ${mandatoryTotal}`}</b>
              </div>
            </div>

            {/* The artboard fills this well with the version's first beats.
                `VersionRow` carries counts, a note, an author and a date, and
                no beats at all, so the page is set from those. Inventing lines
                to fill a preview would be inventing the script. */}
            <div className="well" style={{ marginBottom: 12 }}>
              <div className="pg">
                <div className="pgi">
                  <h4>{(zh && script.titleLocal) || script.title}</h4>
                  <div className="pm">
                    {[
                      `v${selectedVersion.versionNo}`,
                      (zh && selectedVersion.authorNameLocal) || selectedVersion.authorName,
                      stamp(selectedVersion.createdAt, locale),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="pb">
                    <i>{t("Words")}</i>
                    <span>{t("Spoken")}</span>
                    <p>
                      {`${selectedVersion.wordCount} · ${
                        selectedVersion.spokenSeconds === null
                          ? t("not checked yet")
                          : clock(selectedVersion.spokenSeconds)
                      }`}
                    </p>
                  </div>
                  <div className="pb">
                    <i>{t("House style")}</i>
                    <span>{selectedVersion.guideVersion ?? ""}</span>
                    <p>
                      {selectedVersion.conformance === null
                        ? t("not checked yet")
                        : `${Math.round(selectedVersion.conformance)} / 100`}
                    </p>
                  </div>
                  {selectedVersion.note === null ? null : (
                    <div className="pf">
                      <i>{zh ? "版本说明" : "Note"}</i>
                      <p>{selectedVersion.note}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 34,
                padding: "8px 12px",
                border: "1px dashed #e2e2e2",
                borderRadius: 9,
                marginBottom: 18,
              }}
            >
              <span className="cap" style={{ lineHeight: 1.5 }}>
                {t("This preview carries the version's own record. The words themselves open in the editor.")}
              </span>
              <span style={{ flexGrow: 1 }}></span>
              {shortChecksum(selectedVersion.checksum) === null ? null : (
                <span className="cap" style={{ fontFamily: "ui-monospace, monospace" }}>
                  {shortChecksum(selectedVersion.checksum)}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );

  /* ------------------------------------------------------ approval body */

  type Check = { id: string; ok: boolean; title: string; note: string | null; action?: React.ReactNode };
  const checks: Check[] = [];

  if (mandatoryTotal > 0) {
    const covered = pointsCovered ?? 0;
    checks.push({
      id: "points",
      ok: pointsCovered !== null && covered >= mandatoryTotal,
      title:
        pointsCovered === null
          ? `${t("Mandatory points")} · ${t("not checked yet")}`
          : `${covered} / ${mandatoryTotal} ${zh ? "必讲要点已写入脚本" : "mandatory points are in the script"}`,
      note: latest === null ? null : `v${latest.versionNo} · ${t("checked against the brief")}`,
    });
  }

  if (live.targetSeconds !== null) {
    checks.push({
      id: "length",
      ok: live.onTarget === true,
      title: `${t("Length within tolerance of target")} · ±${script.tolerancePercent}%`,
      note: `${clock(live.spokenSeconds)} / ${clock(live.targetSeconds)}${
        live.drift === null ? "" : ` · ${driftLabel(live.drift)}`
      }`,
    });
  }

  checks.push({
    id: "sources",
    ok: script.sourceFileIds.length > 0,
    title: script.sourceFileIds.length > 0 ? t("Sources credited") : t("No sources on the brief"),
    note:
      script.sourceFileIds.length > 0
        ? `${script.sourceFileIds.length} ${t("sources from the database")}`
        : null,
  });

  checks.push({
    id: "author",
    ok: !viewerIsAuthor,
    title: viewerIsAuthor ? t("You cannot approve your own version.") : t("You aren’t the author of this version"),
    note: (() => {
      const author = latest === null ? null : (zh && latest.authorNameLocal) || latest.authorName;
      const parts: string[] = [];
      if (latest !== null && author !== null) parts.push(`v${latest.versionNo} · ${t("written by")} ${author}`);
      if (viewerIsApprover) parts.push(t("you are the designated approver"));
      return parts.length === 0 ? null : parts.join(" · ");
    })(),
  });

  checks.push({
    id: "flags",
    ok: openFlags === 0,
    title: openFlags === 0 ? t("No house-style flags open") : `${openFlags} ${t("house-style flags still open")}`,
    note:
      openFlags === 0
        ? null
        : suggestions
            .slice(0, 3)
            .map((s) => `${t("Beat")} ${s.beatOrd === null ? "" : ord2(s.beatOrd)} ${s.label}`.trim())
            .join(" · "),
    action:
      openFlags === 0 ? undefined : (
        <button
          type="button"
          className="btn s"
          onClick={() => onTab("draft")}
          style={{ height: 26, fontSize: 12, alignSelf: "center" }}
        >
          {zh ? "审阅" : "Review"}
        </button>
      ),
  });

  const passing = checks.filter((c) => c.ok).length;

  const requestForm =
    locked || requested !== null ? null : (
      <div className="card" style={{ padding: 14, marginTop: 14 }}>
        <div className="lbl" style={{ padding: 0, marginBottom: 8 }}>
          {t("Ask for approval")}
        </div>
        {approvers.length === 0 ? (
          <p className="cap" style={{ lineHeight: 1.5 }}>
            {t("Nobody can be asked to approve yet")}
          </p>
        ) : (
          <>
            <label className="fl" htmlFor={`${ids}-approver`}>
              {t("Who should approve this?")}
            </label>
            <div className="inp" style={{ marginBottom: 10 }}>
              <select
                id={`${ids}-approver`}
                className="field"
                value={approverId}
                onChange={(e) => setApproverId(e.target.value)}
                style={{ flexGrow: 1, fontSize: 12.5, cursor: "pointer" }}
              >
                <option value="">{zh ? "选择一个人" : "Pick a person"}</option>
                {approvers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="fl" htmlFor={`${ids}-note`}>
              {t("Add a note")}
            </label>
            <div className="inp" style={{ alignItems: "stretch", marginBottom: 12 }}>
              <textarea
                id={`${ids}-note`}
                className="field"
                rows={2}
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                style={{ flexGrow: 1, fontSize: 12.5, width: "100%" }}
              />
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy || approverId === ""}
              onClick={() => onRequestApproval(approverId, approvalNote.trim() || undefined)}
              style={{ background: ACCENT, color: "#fff", fontWeight: 500 }}
            >
              {t("Send for approval")}
            </button>
          </>
        )}
      </div>
    );

  const approvalBody = (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", gap: 22, padding: "18px 22px 0", overflowY: "auto" }}>
      <div style={{ flexGrow: 1, minWidth: 0, paddingBottom: 20 }}>
        {requested === null ? null : (
          <div
            style={{
              display: "flex",
              gap: 11,
              padding: "12px 13px",
              border: "1px solid #ededed",
              borderRadius: 11,
              background: "#fff",
            }}
          >
            <div
              className="av"
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                background: "#f3f3f3",
                color: "#7c7c7c",
                fontSize: 11.5,
                fontWeight: 500,
                letterSpacing: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {initials(nameOf(requested.requestedBy) ?? "?")}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{nameOf(requested.requestedBy) ?? "—"}</span>
                <span className="cap">
                  {`${zh ? "送审" : "sent"} v${requested.versionNo ?? script.version} · ${relative(requested.requestedAt, locale)}`}
                </span>
              </div>
              {requested.note === null ? null : (
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#383838", marginTop: 4 }}>{requested.note}</div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", margin: "18px 0 2px" }}>
          <span className="lbl" style={{ padding: 0 }}>
            {t("Before you lock")}
          </span>
          <span className="cap" style={{ marginLeft: "auto" }}>
            {`${passing} / ${checks.length} ${t("pass")}`}
          </span>
        </div>
        {checks.map((c, i) => (
          <div key={c.id} className="li" style={i === checks.length - 1 ? { border: "none" } : undefined}>
            <div className="ck" style={{ background: c.ok ? "#278f5e" : "#db7706" }}>
              {c.ok ? <TickGlyph /> : <WarnGlyph />}
            </div>
            <div style={{ flexGrow: 1 }}>
              <div className="a">{c.title}</div>
              {c.note === null ? null : <div className="b">{c.note}</div>}
            </div>
            {c.action}
          </div>
        ))}

        {locked ? null : (
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 14,
              padding: "12px 13px",
              borderRadius: 11,
              background: "#fdfaf3",
              border: "1px solid #f7dcb0",
            }}
          >
            <LockIcon size={16} color="#db7706" width={1.9} />
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#8a5a0d" }}>
              {zh
                ? `锁定会把 v${script.version} 定为唯一的正式版本并交给视频剪辑，之后它变为只读。任何修改都会生成 v${script.version + 1}，需要重新审批。`
                : `Locking makes v${script.version} the single authorised version and sends it to Video Edit. It becomes read-only. Any later change creates v${script.version + 1} and needs approval again.`}
            </div>
          </div>
        )}

        {requestForm}
      </div>

      <div style={{ width: 276, flexShrink: 0, paddingBottom: 20 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: "#7c7c7c" }}>
              <rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1" />
              <path d="m16.6 13 4.6 2.8V8.2L16.6 11z" />
            </svg>
            <span className="lbl" style={{ padding: 0 }}>
              {t("What Video Edit receives")}
            </span>
          </div>
          <div style={{ fontSize: 12.5, marginTop: 8 }}>{`${beats.length} ${t("shot cards")}`}</div>
          <div style={{ marginTop: 6 }}>
            {beats.map((b) => (
              <div key={b.id} className="shot">
                <i>{ord2(b.ord)}</i>
                <span title={b.visual}>{b.visual}</span>
                {b.naturalSound ? (
                  <span className="bd gray" style={{ height: 18, fontSize: 11.5, flexGrow: 0 }}>
                    {t("Natural sound")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "12px 14px", marginTop: 12 }}>
          <div className="lbl" style={{ padding: 0, marginBottom: 4 }}>
            {t("Approval record")}
          </div>
          <div className="kv">
            <span>{t("Version")}</span>
            <span style={{ textAlign: "right" }}>
              {(() => {
                const record = approvedRecord ?? requested ?? newestApproval;
                const no = record?.versionNo ?? latest?.versionNo ?? null;
                const sum = shortChecksum(record?.checksum ?? latest?.checksum ?? null);
                return [no === null ? null : `v${no}`, sum].filter(Boolean).join(" · ") || "—";
              })()}
            </span>
          </div>
          <div className="kv">
            <span>{t("Approver")}</span>
            <span>
              {(() => {
                const record = approvedRecord ?? requested ?? newestApproval;
                const who = record === null ? null : nameOf(record.decidedBy ?? record.approverId);
                return who ?? "—";
              })()}
            </span>
          </div>
          <div className="kv" style={{ border: "none" }}>
            <span>{t("Stored in")}</span>
            <span>{t("Audit log · permanent")}</span>
          </div>
        </div>
      </div>
    </div>
  );

  /* ------------------------------------------------------- right panel */

  const styleTab = (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <svg viewBox="0 0 64 64" style={{ width: 62, height: 62, flexShrink: 0, transform: "rotate(-90deg)" }}>
          <circle cx="32" cy="32" r="26" fill="none" stroke="#ededed" strokeWidth="6" />
          {conformance === null ? null : (
            <circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke={ACCENT}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(Math.max(0, Math.min(100, conformance)) / 100) * 163.4} 163.4`}
            />
          )}
        </svg>
        <div>
          {conformance === null ? (
            <div style={{ fontSize: 13, color: "#999999" }}>{t("not checked yet")}</div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 26, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                {Math.round(conformance)}
              </span>
              <span className="mut">/ 100</span>
            </div>
          )}
          <div className="cap" style={{ marginTop: 2, lineHeight: 1.45 }}>
            {guideVersion === null
              ? t("Conformance to the house-style guide")
              : `${t("Conformance to guide")} ${guideVersion}`}
            {previous !== null && previous.conformance !== null && conformance !== null
              ? ` · ${t("was")} ${Math.round(previous.conformance)} ${t("at")} v${previous.versionNo}`
              : ""}
          </div>
        </div>
      </div>

      {locked ? null : (
        <button
          type="button"
          className="btn s"
          onClick={onCheckConformance}
          disabled={busy}
          style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
        >
          {t("Check conformance")}
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8, marginTop: 14 }}>
        <div style={{ minWidth: 0, border: "1px solid #ededed", borderRadius: 9, padding: "9px 10px", background: "#fff" }}>
          <div className="cap">{t("Spoken duration")}</div>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 5, fontSize: 14, fontWeight: 500, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
            <span>{clock(live.spokenSeconds)}</span>
            {live.drift === null ? null : (
              <span style={{ fontSize: 11.5, fontWeight: 420, whiteSpace: "nowrap", color: live.onTarget === true ? "#278f5e" : "#db7706" }}>
                {driftLabel(live.drift)}
              </span>
            )}
          </div>
          {live.targetSeconds === null ? (
            <div className="cap" style={{ marginTop: 4 }}>
              {t("no target set")}
            </div>
          ) : (
            <div className="mb">
              <div
                style={{
                  width: `${Math.min(100, (live.spokenSeconds / Math.max(1, live.targetSeconds)) * 100)}%`,
                  background: live.onTarget === true ? "#278f5e" : "#db7706",
                }}
              ></div>
              <span
                style={{ position: "absolute", left: "98.7%", top: -3, width: 1.5, height: 10, background: "#171717" }}
              ></span>
            </div>
          )}
        </div>
        <div style={{ minWidth: 0, border: "1px solid #ededed", borderRadius: 9, padding: "9px 10px", background: "#fff" }}>
          <div className="cap">{t("Reading level")}</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
            {readingLevel === null ? <span className="cap">{t("not checked yet")}</span> : readingLevel}
          </div>
        </div>
        <div style={{ minWidth: 0, border: "1px solid #ededed", borderRadius: 9, padding: "9px 10px", background: "#fff" }}>
          <div className="cap">{t("Flagged terms")}</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
            {openFlags} <span style={{ fontSize: 11.5, fontWeight: 420, color: "#999999" }}>{t("open")}</span>
          </div>
        </div>
        <div style={{ minWidth: 0, border: "1px solid #ededed", borderRadius: 9, padding: "9px 10px", background: "#fff" }}>
          <div className="cap">{t("Mandatory points")}</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
            {pointsCovered === null ? (
              <span className="cap">{t("not checked yet")}</span>
            ) : (
              <>
                {`${pointsCovered} / ${mandatoryTotal}`}{" "}
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 420,
                    color: pointsCovered >= mandatoryTotal ? "#278f5e" : "#db7706",
                  }}
                >
                  {t("covered")}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", margin: "16px 0 8px" }}>
        <span className="lbl" style={{ padding: 0 }}>
          {t("Suggestions")}
        </span>
        {suggestions.length === 0 || locked ? null : (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              type="button"
              className="cap"
              onClick={() => suggestions.forEach((s) => onSuggestion(s.id, "accepted"))}
              disabled={busy}
              style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}
            >
              {t("Accept all")}
            </button>
            <span className="cap">·</span>
            <button
              type="button"
              className="cap"
              onClick={() => suggestions.forEach((s) => onSuggestion(s.id, "rejected"))}
              disabled={busy}
              style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}
            >
              {t("Reject all")}
            </button>
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingBottom: 14 }}>
        {suggestions.length === 0 ? (
          <p className="cap" style={{ lineHeight: 1.5 }}>
            {t("Nothing flagged")}
          </p>
        ) : null}
        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            className="sug"
            onClick={() => setOpenSuggestion(s.id)}
            style={{
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: "inherit",
              ...(s.id === activeSuggestionId ? { boxShadow: "0 0 0 2px #eff6ff", borderColor: "#bfdbfe" } : {}),
            }}
          >
            <div className="k">
              <span className="dot" style={{ background: kindDot(s.kind) }}></span>
              {`${t("Beat")} ${s.beatOrd === null ? "—" : ord2(s.beatOrd)} · ${kindLabel(s.kind)}`}
            </div>
            <div className="q">{s.label}</div>
            {s.rationale === null ? null : <div className="w">{s.rationale}</div>}
            {locked || s.kind !== "sound_direction" ? null : (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <span
                  className="btn s"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSuggestion(s.id, "moved");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onSuggestion(s.id, "moved");
                    }
                  }}
                  style={{ height: 25, fontSize: 11.5 }}
                >
                  {t("Move to shot list")}
                </span>
                <span
                  className="btn s"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSuggestion(s.id, "rejected");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onSuggestion(s.id, "rejected");
                    }
                  }}
                  style={{ height: 25, fontSize: 11.5 }}
                >
                  {t("Keep")}
                </span>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  const recordTab = (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
      <div className="lbl" style={{ padding: 0, marginBottom: 8 }}>
        {t("Approval record")}
      </div>
      {approvedRecord === null ? (
        <p className="cap" style={{ lineHeight: 1.5 }}>
          {t("Nothing to approve")}
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 11px",
            border: "1px solid #ededed",
            borderRadius: 10,
            background: "#fff",
          }}
        >
          <div
            className="av"
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              background: "#f3f3f3",
              color: "#7c7c7c",
              fontSize: 11.5,
              fontWeight: 500,
              letterSpacing: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {initials(nameOf(approvedRecord.decidedBy ?? approvedRecord.approverId) ?? "?")}
          </div>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>
              {nameOf(approvedRecord.decidedBy ?? approvedRecord.approverId) ?? "—"}
            </div>
            <div className="cap">
              {approvedRecord.decidedAt === null ? "" : `${t("Approved")} · ${stamp(approvedRecord.decidedAt, locale)}`}
            </div>
          </div>
          <div className="ck" style={{ background: "#278f5e" }}>
            <TickGlyph />
          </div>
        </div>
      )}

      <div className="kv" style={{ marginTop: 10 }}>
        <span>{t("Version")}</span>
        <span style={{ textAlign: "right" }}>
          {[lockedVersion === null ? null : `v${lockedVersion}`, shortChecksum(lockedRow?.checksum ?? null)]
            .filter(Boolean)
            .join(" · ") || "—"}
        </span>
      </div>
      <div className="kv">
        <span>{t("Written by")}</span>
        <span>{lockedRow === null ? "—" : ((zh && lockedRow.authorNameLocal) || lockedRow.authorName) ?? "—"}</span>
      </div>
      <div className="kv">
        <span>{t("House style")}</span>
        <span>
          {lockedRow === null || lockedRow.conformance === null
            ? t("not checked yet")
            : `${Math.round(lockedRow.conformance)} / 100`}
        </span>
      </div>
      <div className="kv">
        <span>{t("Length")}</span>
        <span>
          {lockedRow === null || lockedRow.spokenSeconds === null
            ? t("not checked yet")
            : `${clock(lockedRow.spokenSeconds)}${
                script.targetSeconds === null ? "" : ` · ${t("target")} ${clock(script.targetSeconds)}`
              }`}
        </span>
      </div>
      <div className="kv" style={{ border: "none" }}>
        <span>{t("Mandatory points")}</span>
        <span>{lockedRow === null ? "—" : `${lockedRow.mandatoryCovered} / ${mandatoryTotal}`}</span>
      </div>

      {versions.length <= 1 ? null : (
        <>
          <div className="lbl" style={{ padding: 0, margin: "14px 0 8px" }}>
            {t("Earlier versions")}
          </div>
          {versions
            .filter((v) => v.versionNo !== lockedVersion)
            .slice(0, 6)
            .map((v, i, all) => (
              <div key={v.id} className="kv" style={i === all.length - 1 ? { border: "none" } : undefined}>
                <span>
                  {`v${v.versionNo}`}
                  {((zh && v.authorNameLocal) || v.authorName) === null
                    ? ""
                    : ` · ${(zh && v.authorNameLocal) || v.authorName}`}
                </span>
                <span>{day(v.createdAt, locale)}</span>
              </div>
            ))}
        </>
      )}
    </div>
  );

  const agentTab = (
    <>
      <div style={{ flexShrink: 0, padding: "11px 13px", borderBottom: "1px solid #f3f3f3" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 25,
            padding: "0 10px",
            borderRadius: 7,
            background: "#fff",
            border: "1px solid #ededed",
            maxWidth: "100%",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 3, background: ACCENT, flexShrink: 0 }}></span>
          <span
            style={{
              fontSize: 11.5,
              color: "#525252",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {(zh && script.titleLocal) || script.title}
          </span>
        </div>
      </div>
      {/* The artboards play a scripted exchange here. This is the real one,
          answered in place rather than on /chat. */}
      {thread ?? (
        <div style={{ flexGrow: 1, minHeight: 0, padding: "14px 13px 0", overflow: "hidden" }}></div>
      )}
      <Composer
        placeholder={t("Ask about this script…")}
        sendLabel={t("Send")}
        note={model.replace(/^[^/]+\//, "")}
        onSend={onAsk}
      />
    </>
  );

  const commentsTab = (
    <>
      <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "14px 13px 0" }}>
        {comments.length === 0 ? (
          <p className="cap" style={{ lineHeight: 1.5 }}>
            {t("No comments yet")}
          </p>
        ) : null}
        {comments.map((c) => {
          const author = (zh && c.authorNameLocal) || c.authorName;
          return (
            <div key={c.id} className="li">
              <div
                className="av"
                style={{
                  background: "#f3f3f3",
                  color: "#7c7c7c",
                  fontSize: 9,
                  fontWeight: 500,
                  letterSpacing: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {initials(author ?? "?")}
              </div>
              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <div className="a" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {c.body}
                </div>
                <div className="b">
                  {[
                    author,
                    c.beatOrd === null ? null : `${t("on beat")} ${ord2(c.beatOrd)}`,
                    c.versionNo === null ? null : `v${c.versionNo}`,
                    stamp(c.createdAt, locale),
                    c.resolvedAt === null ? null : t("Resolved"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Composer
        placeholder={t("Write a comment…")}
        sendLabel={t("Comment")}
        note={focusBeat === null ? "" : `${t("on beat")} ${ord2(focusBeat)}`}
        onSend={(body) => onComment(body, focusBeat)}
      />
    </>
  );

  /** The Draft tab keeps the artboard's three-tab panel; every other tab shows
   * the two the artboards give it, and a locked script shows the record. */
  const panelTabs: { key: "run" | "style" | "agent" | "comments"; label: string; icon: boolean }[] = locked
    ? [
        { key: "style", label: t("Record"), icon: false },
        { key: "agent", label: t("Agent"), icon: true },
      ]
    : tab === "draft"
      ? [
          { key: "style", label: t("House style"), icon: false },
          { key: "agent", label: t("Agent"), icon: true },
          { key: "comments", label: t("Comments"), icon: false },
        ]
      : [
          { key: "agent", label: t("Agent"), icon: true },
          { key: "comments", label: t("Comments"), icon: false },
        ];

  /* The run comes first on every tab: it is the answer to "where is this",
     which is the question people open a script with. */
  if (run) panelTabs.unshift({ key: "run", label: t("Flow"), icon: false });
  const activePanel = panelTabs.some((p) => p.key === panel) ? panel : panelTabs[0].key;

  const rightPanel = (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: "1px solid #ededed",
        background: "#fcfcfc",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          borderBottom: "1px solid #ededed",
          /* Four tabs in English ran past 320px; they scroll sideways now
             instead of spilling over the panel edge. */
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        }}
      >
        {panelTabs.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`rtab${activePanel === p.key ? " on" : ""}`}
            onClick={() => setPanel(p.key)}
            style={{ flexShrink: 0, whiteSpace: "nowrap", paddingLeft: 8, paddingRight: 8 }}
          >
            {p.icon ? <AgentIcon size={12} color={ACCENT} /> : null}
            {p.label}
          </button>
        ))}
        <div style={{ flexGrow: 1 }}></div>
      </div>

      {activePanel === "run" ? run : activePanel === "style" ? (locked ? recordTab : styleTab) : activePanel === "agent" ? agentTab : commentsTab}

      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid #f3f3f3",
          padding: "10px 14px 12px",
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <LockIcon size={12} color="#999999" width={1.7} />
        <span style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.4 }}>
          {locked ? t("Records are permanent · in the audit log") : t("Answers use only sources you can read")}
        </span>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- frame */

  return (
    <>
      <style>{CSS}</style>
      {sidebar}
      <div
        data-script-screen=""
        style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {header}
        {tabStrip}
        {/* The artboards have nowhere to put a refusal. A write that did not
            happen has to say so, in the words it came back with. */}
        {error === null ? null : (
          <div
            role="alert"
            style={{
              flexShrink: 0,
              padding: "9px 22px",
              borderBottom: "1px solid #ededed",
              background: "#ffe7e7",
              color: "#e03636",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
          {tab === "brief" ? briefBody : null}
          {tab === "draft" ? draftBody : null}
          {tab === "versions" ? versionsBody : null}
          {tab === "approval" ? approvalBody : null}
          {rightPanel}
        </div>
      </div>
    </>
  );
}

/** The tab strip's running duration against target, the artboard's amber pill. */
function DurationBadge({ live, t }: { live: Measurement; t: (key: string) => string }): React.JSX.Element {
  if (live.targetSeconds === null) {
    return (
      <span className="bd gray" style={{ fontVariantNumeric: "tabular-nums" }}>
        {clock(live.spokenSeconds)}
      </span>
    );
  }
  return (
    <span className={`bd ${live.onTarget === true ? "grn" : "amb"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
      {`${clock(live.spokenSeconds)} / ${clock(live.targetSeconds)} ${t("target")}`}
      {live.drift === null || Math.round(live.drift) === 0 ? "" : ` · ${driftLabel(live.drift)}`}
    </span>
  );
}
