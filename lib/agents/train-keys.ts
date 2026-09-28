import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";

/**
 * Who can be trained (AI 训练): everybody's own assistant and the seven AI
 * employees. Client-safe, apart from `lib/agents/training.ts`, so the pages'
 * client components can use the keys and the budget.
 */
export type TrainKey = AgentKey | "assistant";
export const TRAIN_KEYS: TrainKey[] = ["assistant", ...AGENT_KEYS];
export const isTrainKey = (v: unknown): v is TrainKey => typeof v === "string" && (TRAIN_KEYS as string[]).includes(v);

/** How much of each a prompt reads, in characters. */
export const TRAIN_BUDGET = { instructions: 3000, style: 1500, examples: 6000 } as const;

/** Where the training is used, per employee, said on its page. */
export const TRAIN_USED: Record<TrainKey, { zh: string; en: string }> = {
  assistant: { zh: "你的助理每次回答你、帮你派活时都会先读这些。", en: "Your assistant reads this before every answer." },
  research: { zh: "研究员找选题、写晨报、回答“怎么看”时会照着做。", en: "Used when the researcher finds topics and writes the brief." },
  planning: { zh: "策划排计划、派活、拆素材时会照着做。", en: "Used when the planner plans and hands out work." },
  script: { zh: "编剧每次写初稿、改写、按退回意见给修改建议时都会照着做。", en: "Used for every draft, rewrite and send-back edit the writer makes." },
  video: { zh: "剪辑师设计画面、字幕和包装时会照着做。", en: "Used when the editor designs pictures, captions and graphics." },
  article: { zh: "撰稿人写长文、发布文案时会照着做。", en: "Used for articles and post copy." },
  legal: { zh: "法务起草、比对合同时会照着做（只改说法，不改它的底线规则）。", en: "Used when drafting and comparing contracts." },
  finance: { zh: "财务查账、写报告、提交用款时会照着做。", en: "Used for reports and spend requests." },
};

export const TRAIN_PLACEHOLDER: Record<TrainKey, { instructions: string; style: string; tryIt: string }> = {
  assistant: {
    instructions: "例如：\n- 回答先给结论，再给理由\n- 涉及数字一定写出处\n- 称呼我“亚芳姐”",
    style: "例如：少用“首先、其次、最后”；不要用感叹号",
    tryIt: "帮我把今天要做的三件事列一下",
  },
  research: {
    instructions: "例如：\n- 只看最近 7 天的热点\n- 优先 AI、出海、创业、理财话题\n- 每个选题给 3 个对标视频和播放量",
    style: "例如：不要用“爆了”“炸了”；判断要写理由",
    tryIt: "这周可以拍哪三个 AI 相关的选题？",
  },
  planning: {
    instructions: "例如：\n- 每天最多排 3 条\n- 派活时写清谁、做什么、几点前\n- 周五只排轻松话题",
    style: "例如：待办用短句，一行一件事",
    tryIt: "把明天的拍摄排一下",
  },
  script: {
    instructions: "例如：\n- 开头 3 秒必须有钩子，先抛结论或反常识\n- 口语化，每句不超过 20 字\n- 多用具体数字和身边的例子\n- 结尾引导观众评论\n- 不用“家人们”“宝子们”",
    style: "例如：\n禁用词：绝对、稳赚、第一、史上最\n口头禅：“说白了”“我跟你讲”",
    tryIt: "写一个 30 秒口播开头，主题：AI 会不会取代剪辑师",
  },
  video: {
    instructions: "例如：\n- 字幕关键词用品牌黄\n- 每 3 秒换一次画面\n- 片头不超过 2 秒\n- 不用网红 BGM",
    style: "例如：图形简洁，不要花字特效",
    tryIt: "一条 60 秒讲 AI 出海的口播，画面怎么配？",
  },
  article: {
    instructions: "例如：\n- 小红书文案带 3–5 个话题标签\n- 标题不超过 20 字\n- 多用短段落，一段不超过 3 行",
    style: "例如：少用 emoji；不写“建议收藏”",
    tryIt: "给“AI 会不会取代剪辑师”写一段小红书文案",
  },
  legal: {
    instructions: "例如：\n- 我方名称写“腾亚创变”\n- 付款期限默认 30 天\n- 合同用简体中文",
    style: "例如：条款编号用 1. 1.1 格式",
    tryIt: "起草一段视频合作的保密条款",
  },
  finance: {
    instructions: "例如：\n- 金额统一用港币\n- 超过 5,000 的用款要提醒我\n- 月报先写结论",
    style: "例如：数字保留两位小数，千位加逗号",
    tryIt: "这个月的 AI 花费大概是怎样的？",
  },
};
