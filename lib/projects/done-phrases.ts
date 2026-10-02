/**
 * "传好了" — the words that mean the host's clips are in and the cut can
 * start.
 *
 * A person in a project's chat who says 传好了, 素材上传完了, 开始剪, 可以剪
 * 了 or plain "done" is not asking 剪辑师 a question; they are handing it
 * the footage. The dispatcher used to send that to the model, which would
 * read the channel, look at the bin and answer — sometimes "开始粗剪" with
 * nothing begun. Now the sentence is read here, in code, and when the bin
 * has clips and nothing is running the one-go starts at once
 * (`lib/projects/start-cut.ts`). The model is not in the loop.
 *
 * Deliberately narrow, because a false start costs a render: the message
 * is cut into clauses at its punctuation, and every clause has to be either
 * one of the hand-over phrases below, whole, or filler (好的, ok, 辛苦了).
 * So "可以剪了" starts it and "可以剪短一点" does not; "传好了，开工"
 * does and "传好了，帮我把开头剪快一点" is a brief, left to the model. A
 * question or a "not yet" (还没传好, 可以剪吗？) never is.
 *
 * Pure, so the browser and `scripts/agents-verify-check.ts` can read it.
 */

/** Whole clauses that hand the footage over. Anchored: the clause is the
 *  phrase, not a sentence that happens to contain it. */
const HANDOVER: RegExp[] = [
  /* 传好了 · 上传完了 · 素材都传上去了 · 视频已经发过来了 · 已上传完毕 */
  /^(我|我们)?(的)?(素材|视频|片子|原片|镜头|口播)?(我|我们)?(都|全|全部|已经|已|也)*(传|上传|发|传上去|发上去|传上来|发过来|传过来|上传上去)(好|完|齐)?(了|啦|咯|毕|完毕)$/,
  /* 素材到了 · 素材齐了 · 素材都好了 */
  /^(素材|视频|片子|原片)(都|全|全部|已经)*(到|齐|好)(了|啦)$/,
  /* 可以剪了 · 开始剪 · 开始剪吧 · 能剪了 · 开剪 */
  /^(现在)?(可以|能|开始|开)(剪|剪辑)(了|吧|啦)?$/,
  /^(剪吧|开剪吧|开工|开工吧|动手吧|开始吧)$/,
  /* 开始做 · 开始出片 · 一键成片 */
  /^开始(做|做片|出片|成片)(吧)?$/,
  /^一键成片(吧)?$/,
  /* English, whole clauses too. */
  /^(i'?m |we'?re |all |it'?s )?done$/,
  /^(all |everything( is|'s)? |the clips?( are| is)? |clips?( are)? |footage( is)? )?uploaded$/,
  /^(go ahead|go for it)$/,
  /^(i'?m |we'?re )?ready( to (cut|edit|go))?$/,
  /^(please )?(start|begin) (the )?(cut|edit|editing|cutting)$/,
  /^(cut it|let'?s (cut|edit|go)( it)?)$/,
];

/** Clauses that say nothing either way: a greeting, a thanks, an "ok". */
const FILLER = /^(好|好的|好了|好啦|好嘞|ok|okay|嗯|嗯嗯|行|那|那就|老师|辛苦了|辛苦|谢谢|thanks|thank you|thx|hi|hey)$/;

/** A question, or a "not yet": not a hand-over, whatever else it says. */
const NOT_A_HANDOVER = /[?？]|吗|么|怎么|为什么|什么时候|还没|没有|没传|还要|再传|先别|别剪|不要|暂时|先不|等等|等一下|稍等|\bnot\b|\bdon'?t\b|\bwait\b|\blater\b/i;

/**
 * "还没传好" · "还要再传一段" · "再补一段" · "等我一下" · "先别剪": the person
 * says more footage is coming, or not to start yet.
 *
 * The opposite of a hand-over, and it has to hold in code too: such a
 * message in a project's chat still goes to 剪辑师 as a reply (the channel's
 * reply routing), whose prompt says to cut when the bin has clips — so
 * "再补一段" with a video attached once started a cut on its own. With this,
 * the turn it starts cannot start one (`ToolContext.holdCut`).
 */
const MORE_COMING = /还没|没传完|没传好|没上传完|还在传|还要(传|补|发|加|上传)|再(传|补|发|上传)|补(一|两|几|个)|还有(一|两|几)?(段|个|条)|等(我|一下|一会|会儿|等)|稍等|先别|别(剪|急|动)|不要(剪|急|开始)|暂时(别|不)|先不|\bnot yet\b|\bwait\b|\bhold on\b|\bmore (clips?|footage|coming)\b|\bone more\b/i;

export function holdsTheCut(body: string): boolean {
  const text = body.replace(TAGS, " ").replace(/\s+/g, " ").trim();
  return MORE_COMING.test(text);
}

/**
 * Whether a message asks for a video to be made (「剪一条 30 秒 Reels」,
 * "make the video"). The chat's @剪辑师 in a project and the assistant's
 * hand-off to 剪辑师 both start the cut on this in code: the model turn in
 * the project's chat set styles, or said it had already cut it, instead.
 */
export function asksForVideoCut(body: string): boolean {
  return !holdsTheCut(body) && /(剪|做|出|生成|制作|渲染|make|cut|render|create)[^。！？!?\n]{0,20}(视频|成片|完整版|版本|reels?|shorts?|短视频|片子|一条|video|film)/i.test(body);
}

/** The longest message that is still a hand-over rather than a brief. */
const MAX_LENGTH = 80;

/* The employees' own tags, which carry no meaning here ("@剪辑师传好了"
   has no space after the tag, so the names go first, then any @word). */
const TAGS = /@(剪辑师|文案|研究员|策划|撰稿人|助理)|@\S+/g;
const HAS_CJK = /[㐀-鿿]/;

/**
 * Whether a message says the clips are in and the cut may start.
 * Employees' tags are set aside first: "@剪辑师 传好了" is the same
 * hand-over as "传好了".
 */
export function looksLikeDone(body: string): boolean {
  const text = body.replace(TAGS, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text || text.length > MAX_LENGTH) return false;
  if (NOT_A_HANDOVER.test(text)) return false;
  /* Clauses at punctuation; a Chinese clause at its spaces too ("传好了
     开始剪"), an English one keeps them ("all uploaded"). */
  const clauses = text
    .split(/[，,。.!！、;；·:：~～]+/)
    .flatMap((c) => (HAS_CJK.test(c) ? c.split(" ") : [c]))
    .map((c) => c.trim())
    .filter(Boolean);
  let handover = false;
  for (const c of clauses) {
    if (HANDOVER.some((re) => re.test(c))) handover = true;
    else if (!FILLER.test(c)) return false;
  }
  return handover;
}
