import * as React from "react";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";

/**
 * A label that survives Chrome's page translate.
 *
 * The owner and the client read the Chinese UI through Chrome's translate,
 * and it gets the short labels wrong: 首页 comes out as "front page", 交代 as
 * "Explanation", 撰稿人 as "Contributor", 策划 as "plan". So a label that
 * matters is written twice — the Chinese everybody sees, and beside it the
 * English we would have chosen, marked `translate="no"` and hidden. Chrome
 * puts `translated-ltr` (or `-rtl`) on <html> while it translates, and the
 * rules in app/globals.css swap the two while that class is there. Without
 * translation nothing changes: the English span is `display: none`.
 *
 * When the app itself is in English (`inZh` false) there is nothing to
 * protect, and the English is rendered on its own.
 *
 * No state, no effects: the swap is CSS alone, so the server and the browser
 * render the same markup and hydration has nothing to disagree about.
 */
export function Tr({ zh, en, inZh = true }: { zh: string; en?: string; inZh?: boolean }) {
  const english = en ?? TR_EN[zh] ?? zh;
  if (!inZh) return <>{english}</>;
  return (
    <>
      <span className="tr-zh">{zh}</span>
      <span className="tr-en" translate="no">
        {english}
      </span>
    </>
  );
}

/**
 * The English for the labels Chrome mistranslates, so a caller can write
 * `<Tr zh="首页" />`. Short on purpose: these sit in a 186px rail and in
 * tabs, where the translation's "front page of the market research" broke
 * the line.
 */
export const TR_EN: Record<string, string> = {
  // The rail and the top bar
  首页: "Home",
  聊天: "Chat",
  文件: "Files",
  市场调研: "Research",
  所有脚本: "Scripts",
  文章: "Articles",
  所有视频: "Videos",
  发布中: "Publishing",
  账务: "Accounting",
  财务: "Finance",
  法务: "Legal",
  人事: "HR",
  管理: "Admin",
  项目: "Projects",
  新项目: "New project",
  收起: "Collapse",
  设置: "Settings",
  搜索: "Search",
  自动化流程: "Flow",
  // Home's job tabs
  全部: "All",
  研究: "Research",
  策划: "Planning",
  编剧: "Script",
  剪辑: "Editing",
  "撰稿/发布": "Writing & publishing",
  我的默认: "My default",
  设为我的默认: "Make this my default",
  // The team
  派任务: "Assign",
  同事: "Colleagues",
};

/**
 * An AI employee's name as a name: 研究员 / Researcher, 策划 / Planner,
 * 编剧 / Scriptwriter, 剪辑师 / Editor, 撰稿人 / Writer — never the
 * translation's "plan" or "Contributor".
 */
export function AgentName({ agent, zh }: { agent: AgentKey; zh: boolean }) {
  const a = AGENT_LABELS[agent];
  return <Tr zh={a.nameLocal} en={a.nameEn} inZh={zh} />;
}
