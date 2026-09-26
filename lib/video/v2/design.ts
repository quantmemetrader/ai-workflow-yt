import type { Beat, CutReport, Credits, FaceTrack, Intent, Sentence, Sourced } from "@/lib/video/v2/types";
import { hanCount } from "@/lib/video/sentences";
import { REEL_SPEC } from "@/lib/video/craft";
import {
  type DesignBeat,
  type LayoutPace,
  type LayoutPlan,
  type Violation,
  hasFigure,
  lintPlan,
  plainFigures,
  resolveLayout,
  saidNear,
} from "@/lib/video/layout";

/**
 * The design step of director v2: one plan for the whole video.
 *
 * v1 designed sixty seconds at a time and saw nothing of the rest, so it
 * set the same stat twice, put a picture where the number had not yet been
 * said, and never knew which company had already had its card. Here the
 * model reads the whole transcript once, by sentence id, with the brief,
 * and answers with the *what*: the hook block, the cold open, the chapters,
 * the entities, and a beat for each sentence that wants something on
 * screen — its intent, the search queries in both languages, what the
 * frame must and must not show, the number or the headline it carries.
 * Code then does everything that is a rule rather than a judgement:
 * dedupes queries, stats and entities; checks every figure against the
 * captions within ±1.5 s of where it would land; sends the footage beats
 * to sourcing (W3, injected); and hands the lot to `resolveLayout`, which
 * decides when and where.
 *
 * Pure in the sense that matters: no database, no storage, no clock. The
 * model call and the sourcing come in through `deps`, so the lab can run
 * it with a cached outline and a stub sourcer, and the worker with the
 * real ones.
 */

/* ----------------------------------------------------------------- types */

export type OutlineEntity = NonNullable<Beat["entity"]> & { firstSentenceId: string | null };

export type Outline = {
  titleZh: string;
  subtitleZh: string;
  hook: { lines: string[]; landOn: string[] };
  coldOpen: string | null;
  chapters: { sentenceId: string; titleZh: string }[];
  entities: OutlineEntity[];
  beats: DesignBeat[];
  lowerThird: { sentenceId: string | null; name: string; sub: string };
  endCard: { sentenceId: string | null; titleZh: string; questionZh: string };
  notesZh: string;
};

export type DesignInput = {
  brief: string;
  /** Sentences on the timeline clock, after the cut. */
  sentences: Sentence[];
  /** The cut pieces on the timeline clock. */
  pieces: { inMs: number; outMs: number }[];
  totalMs: number;
  /** Caption lines on the timeline, for the stat check. */
  captions: { startMs: number; endMs: number; text: string }[];
  face: FaceTrack | null;
  pace: LayoutPace;
  accent: string;
  language: string;
  /** What the tenant's channel puts on every video. */
  furniture: { header: { title: string; sub: string | null }; watermark: string | null; footnote: string | null };
  cut?: CutReport | null;
  /** The creator's voice notes, when the tenant has them. */
  voice?: string | null;
};

export type ModelCall = (req: { system: string; user: string; maxTokens: number; temperature: number }) => Promise<{ text: string; ms?: number; costMicros?: number }>;

export type DesignDeps = {
  /** The outline call. `null` skips the model (the lab, with a cached outline). */
  complete: ModelCall | null;
  /** A cached outline to use instead of calling the model. */
  outline?: Outline | null;
  /** W3's `sourceBeats`. `null` means every footage beat becomes a designed card or stays on the host. */
  sourceBeats: ((beats: Beat[]) => Promise<Sourced[]>) | null;
  /**
   * W3's `entityVisual`, once per entity: the logo (or the one picture
   * that stands for the entity) for its card. `null` from it means the
   * card goes up without one. Absent: no logos.
   */
  entityVisual?: ((entity: OutlineEntity) => Promise<Sourced | null>) | null;
  /** W3's `placeCredits`. Absent: a plain fallback line and block are written. */
  placeCredits?: ((sourced: Sourced[]) => Credits) | null;
  /** Progress, in Chinese, for the screen. */
  say?: (text: string) => Promise<void> | void;
  /** The layout's placement trace, line by line (the lab writes it to a file). */
  trace?: (line: string) => void;
};

export type DesignResult = {
  outline: Outline;
  beats: DesignBeat[];
  sourced: Sourced[];
  /** Entity logos by entity name, from `entityVisual`. */
  logos: Record<string, Sourced>;
  plan: LayoutPlan;
  credits: Credits;
  lint: Violation[];
  notesZh: string;
  timings: { outlineMs: number; sourcingMs: number; layoutMs: number };
  dropped: { beatId: string; reasonZh: string }[];
  /** What the audits added because the model left it out. */
  added: { beatId: string; reasonZh: string }[];
};

/* ---------------------------------------------------------------- prompt */

const INTENTS: Intent[] = ["person", "org", "product", "headline", "number", "compare", "list", "concept", "scene", "metaphor", "none"];
const ENTITY_KINDS = ["company", "agency", "person", "product", "publication", "legislature"] as const;

/** The whole-video outline: what the model is asked for, and the only shape it may answer in. */
export const OUTLINE_PROMPT = `You are the director of a Chinese business creator's vertical reel (9:16, 1080×1920, 30 fps). You are given the producer's brief and the finished cut's transcript, one sentence per line with its id and timing. Decide WHAT goes on screen for each sentence; code decides when and where. Answer with one JSON object and nothing else; the first character of your answer must be an opening brace.

{
  "titleZh": "the video's title, from the brief or what is said",
  "subtitleZh": "one line under it, distilled from her words",
  "hook": { "lines": ["≤ 8 chars", "≤ 8 chars", "≤ 8 chars, key word in 【】"], "landOn": ["the spoken words each line lands on"] },
  "coldOpen": "sentence id the video opens on (normally the first)",
  "chapters": [ { "sentenceId": "sNNN", "titleZh": "2–6 chars" } ],
  "entities": [ { "name": "as the brief spells it", "romanised": "Latin name", "org": "the org a person belongs to, else empty", "kind": "company|agency|person|product|publication|legislature", "descriptorZh": "one line, ≤ 14 chars", "wikiTitleZh": "zh Wikipedia page title", "wikiTitleEn": "en Wikipedia page title", "firstSentenceId": "sNNN" } ],
  "beats": [
    { "sentenceId": "sNNN", "intent": "person|org|product|headline|number|compare|list|concept|scene|metaphor|none", "priority": 1, "anchor": "the exact word or phrase in that sentence the visual lands on",
      "entity": "name from entities (for person/org/product)",
      "queries": { "zh": ["≤ 2 shootable phrases, Chinese"], "en": ["≤ 2 shootable phrases, English, romanised names + org for people"] },
      "must": "what the frame must show", "mustNot": "what it must not show",
      "number": { "value": "154", "unit": "页", "labelZh": "what it counts" },
      "compareTitleZh": "for compare", "bars": [ { "labelZh": "中国模型", "value": 63.5, "display": "63.5%", "negative": false } ],
      "listTitleZh": "for list", "items": [ { "textZh": "2月 公开声讨", "sentenceId": "sNNN" } ],
      "term": { "term": "蒸馏", "definitionZh": "小模型学大模型的「暗知识」" }, "diagram": { "steps": ["老师模型", "输出", "学生模型"] },
      "headline": { "outlet": "who published", "date": "when", "quoteZh": "the headline as a short quote", "url": "" },
      "punchline": false }
  ],
  "diagram": { "sentenceId": "the sentence that explains the mechanism", "steps": ["老师模型", "输出", "学生模型"] },
  "lowerThird": { "sentenceId": "the sentence where she says her name, or null", "name": "", "sub": "" },
  "endCard": { "sentenceId": "the last sentence", "titleZh": "", "questionZh": "her closing question" },
  "notesZh": "two or three sentences to the producer, in Chinese"
}

Rules:
 - Every sentenceId must be one of the ids given. A sentence may carry more than one beat (a company AND a number), each its own object; a sentence with nothing to show gets no beat.
 - "hook": the brief's statement block when it gives one, verbatim; else three lines ≤ 8 Han chars from the first sentence. "landOn" is the spoken words in the first sentences that each line lands on.
 - "chapters": 4 to 6, only at real turns of the argument (the brief's chain when it gives one). Never at a paragraph that merely continues.
 - "entities": every company, agency, person, product, publication and legislature the transcript names, spelled as the brief spells it. One entry each. "descriptorZh" is what a viewer needs to place it in one line.
 - Beat intents, most specific first: "person" (a named person on camera), "org" (a company, agency, legislature: its logo, building, people), "product" (an app or model UI), "headline" (a dated announcement, report, letter, statement — give outlet/date/quote), "number" (a figure said out loud: give value/unit/labelZh), "compare" (this-vs-that figures: give bars, 2–3), "list" (a sequence built item by item: give items with the sentence each is said in), "concept" (a term worth a card, or the one diagram of the mechanism), "scene" (a concrete place or thing: data center, code, chips, a card being swiped), "metaphor" (an image for an abstract idea), "none" (only for a punchline, with "punchline": true).
 - "priority": 1 = the literal named thing or the figure the argument turns on; 2 = supports the line; 3 = nice to have.
 - "queries" only for person/org/product/headline/scene/metaphor/concept: shootable phrases a search engine can find footage for — subject, action, setting — not sentences. "zh" must contain Han characters; "en" must contain none. For a person: romanised name + org + "interview" in en, 「名字 采访」 in zh. Never a literal-word trap (whiskey for 蒸馏).
 - "must" names the specific thing (the person's face, this product's UI, this logo); "mustNot" names the traps (a different person, stock actors smiling, burned-in captions, wrongdoing shown with a real person).
 - "number": only a figure actually said in that sentence, as she says it (154, 1.51亿, 3500多, 近30万, 十几, 63.5). Never a figure from the brief that is not spoken here.
 - "compare": when two or three figures are set against each other in one breath (63.5% vs 35.5%; 几千万–几亿 vs 几千–几十万). "negative" marks the one to read red, only when the line frames it as the bad one.
 - "list": a build of 3–5 items said across consecutive sentences (2月 → 6月 → 9月). Give the sentence each item is said in; each item's text carries the date or step and the names or figures she says with it ("2月 DeepSeek·月之暗面·MiniMax", "6月 致信参议院 阿里"), ≤ 16 characters, because the list is what the viewer sees of those names while it is up.
 - "concept": the brief's term cards (with the definition it gives), and the one diagram where the mechanism is explained.
 - "punchline": true on the brief's 金句 and at most one other line per 90 s. A punchline beat may be intent "none".
 - Coverage, which code checks after you: every figure the brief lists and every figure said with a unit (页, 次, 个账号, 条, 倍, %, 成, 美金) gets a "number" or "compare" beat at the sentence where it is said; every entry in "entities" gets a beat at its first mention (several names in one sentence are several beats on that sentence); every term the brief names gets a "concept" beat with "term"; every scene the brief names gets a "scene" beat where the words call for it; a sequence of dated steps (2月 → 6月 → 9月) is one "list" beat on its first sentence with the items; the top-level "diagram" (three steps, on the sentence that explains the mechanism; for distillation 老师模型 → 输出 → 学生模型) is always filled in. A beat left out is a picture the viewer never gets. Aim for 60–80 beats on a five-minute take.
 - Footage: a well edited reel shows real footage 30–40 % of the time, a new picture every 5–8 s. Besides the named things, give a "scene" (or "metaphor") beat, priority 2, to every sentence without a person/org/product/headline beat of its own whose words can be shown: the concrete thing, place or action she is talking about (a US Senate hearing room, a Chinese AI app on a phone, lines of code scrolling, a server room, a GPU chip, a card being swiped, an API dashboard, a courtroom gavel), never a mood. Aim for 25–35 footage beats (person/org/product/headline/scene/metaphor) spread over the whole take, none of two consecutive sentences wanting the same picture.
 - Text on screen is Simplified Chinese, in her words and the brief's; never invent a number, a date, a name or a claim.`;

/* ------------------------------------------------------------------ parse */

/** The last complete `{…}` in the answer that looks like an outline. */
export function lastJsonObject(text: string, mustHave: string[] = ["beats"]): Record<string, unknown> | null {
  const body = text.replace(/<\/?think(?:ing)?>/gi, "\n");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  const hay = fenced ? fenced[1] : body;
  for (let end = hay.lastIndexOf("}"); end !== -1; end = hay.lastIndexOf("}", end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (hay[i] === "}") depth++;
      else if (hay[i] === "{") {
        depth--;
        if (depth === 0) {
          try {
            const value = JSON.parse(hay.slice(i, end + 1)) as unknown;
            if (typeof value === "object" && value !== null && mustHave.every((k) => k in (value as object))) return value as Record<string, unknown>;
          } catch {
            // Not it; keep walking outwards.
          }
          break;
        }
      }
    }
  }
  return null;
}

const HAN = /[㐀-䶿一-鿿]/;
const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "object" && x !== null) : []) as Record<string, unknown>[];
const strings = (v: unknown, max: number, each = 80) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, each)).slice(0, max) : []);

/**
 * The outline out of the model's answer, checked line by line.
 *
 * Every sentence id must exist; every intent and entity kind must be one
 * of ours; `en` queries with Han characters and `zh` queries without are
 * dropped (a search engine given the wrong script finds nothing); numbers
 * must carry a value; entity references must resolve. What does not check
 * out is dropped, not repaired — a repaired guess is still a guess.
 */
export function parseOutline(text: string, sentences: readonly Sentence[], seed?: { entities: OutlineEntity[] }): Outline {
  const raw = lastJsonObject(text) ?? {};
  const ids = new Set(sentences.map((x) => x.id));
  const sid = (v: unknown): string | null => (typeof v === "string" && ids.has(v.trim()) ? v.trim() : null);

  const hookRaw = (raw.hook ?? {}) as Record<string, unknown>;
  const hook = { lines: strings(hookRaw.lines, 3, 16), landOn: strings(hookRaw.landOn, 3, 24) };

  /*
   * A detail window (a take over 150 sentences) is asked to answer with
   * beats only and an empty entity list; its beats still name the
   * entities of the whole-video outline, so those are the seed here. Without
   * it every `"entity": "Anthropic"` in a window would fail to resolve, the
   * beat would lose its entity, and the audit would then add a second,
   * generic beat for the same name.
   */
  const entities: OutlineEntity[] = [];
  const seenEntity = new Set<string>();
  for (const e of seed?.entities ?? []) {
    if (seenEntity.has(e.name)) continue;
    seenEntity.add(e.name);
    entities.push(e);
  }
  for (const e of list(raw.entities)) {
    const name = s(e.name, 40);
    const kind = String(e.kind);
    if (!name || seenEntity.has(name) || !(ENTITY_KINDS as readonly string[]).includes(kind)) continue;
    seenEntity.add(name);
    entities.push({
      name,
      romanised: s(e.romanised, 60) || undefined,
      org: s(e.org, 60) || undefined,
      kind: kind as OutlineEntity["kind"],
      descriptorZh: s(e.descriptorZh, 40),
      wikiTitleZh: s(e.wikiTitleZh, 80) || undefined,
      wikiTitleEn: s(e.wikiTitleEn, 80) || undefined,
      firstSentenceId: sid(e.firstSentenceId),
    });
  }
  const entityByName = new Map(entities.map((e) => [e.name, e]));

  const beats: DesignBeat[] = [];
  const perSentence = new Map<string, number>();
  const bySentence = new Map(sentences.map((x) => [x.id, x]));
  for (const b of list(raw.beats)) {
    const sentenceId = sid(b.sentenceId);
    let intent = String(b.intent) as Intent;
    if (!sentenceId || !INTENTS.includes(intent)) continue;
    /* The model labels a two-figure beat "number" now and then, and a one-figure beat "compare": the shape it filled in says which it is. */
    const hasBars = Array.isArray(b.bars) && (b.bars as unknown[]).length >= 2;
    const hasNumber = typeof b.number === "object" && b.number !== null && s((b.number as Record<string, unknown>).value, 24) !== "";
    if (intent === "number" && hasBars && !hasNumber) intent = "compare";
    if (intent === "compare" && !hasBars && hasNumber) intent = "number";
    const n = (perSentence.get(sentenceId) ?? 0) + 1;
    perSentence.set(sentenceId, n);
    const q = (b.queries ?? {}) as Record<string, unknown>;
    const zh = strings(q.zh, 2, 60).filter((x) => HAN.test(x));
    const en = strings(q.en, 2, 80).filter((x) => !HAN.test(x));
    const priority = ([1, 2, 3] as const).includes(Number(b.priority) as 1 | 2 | 3) ? (Number(b.priority) as 1 | 2 | 3) : 2;
    const entityName = s(b.entity, 40);
    const entity = entityName ? entityByName.get(entityName) : undefined;
    const numRaw = (b.number ?? null) as Record<string, unknown> | null;
    const number = numRaw && s(numRaw.value, 24) ? { value: s(numRaw.value, 24), unit: s(numRaw.unit, 12), labelZh: s(numRaw.labelZh, 40), saidAtMs: 0 } : undefined;
    const bars = list(b.bars)
      .map((bar) => ({ labelZh: s(bar.labelZh, 24), value: Number(bar.value), display: s(bar.display, 24), negative: bar.negative === true }))
      .filter((bar) => bar.labelZh && bar.display && Number.isFinite(bar.value))
      .slice(0, 3);
    const items = list(b.items)
      .map((it) => ({ textZh: s(it.textZh, 40), sentenceId: sid(it.sentenceId) ?? sentenceId }))
      .filter((it) => it.textZh)
      .slice(0, 5);
    const termRaw = (b.term ?? null) as Record<string, unknown> | null;
    const term = termRaw && s(termRaw.term, 24) ? { term: s(termRaw.term, 24), definitionZh: s(termRaw.definitionZh, 60) } : undefined;
    const diagRaw = (b.diagram ?? null) as Record<string, unknown> | null;
    const diagram = diagRaw ? { steps: strings(diagRaw.steps, 3, 16) } : undefined;
    const hRaw = (b.headline ?? null) as Record<string, unknown> | null;
    const headline = hRaw && s(hRaw.quoteZh, 60) ? { outlet: s(hRaw.outlet, 40), date: s(hRaw.date, 24), quoteZh: s(hRaw.quoteZh, 60), url: s(hRaw.url, 300) || undefined } : undefined;
    const anchor = s(b.anchor, 40) || undefined;
    /* The number lands on the word that carries its digits, or on the anchor. */
    if (number) {
      const sent = bySentence.get(sentenceId)!;
      number.saidAtMs = whenSaid(sent, number.value) ?? whenSaid(sent, anchor ?? "") ?? sent.startMs;
    }
    beats.push({
      id: n === 1 ? sentenceId : `${sentenceId}.${n}`,
      sentenceId,
      intent,
      priority,
      punchline: b.punchline === true || undefined,
      queries: zh.length || en.length ? { zh, en } : undefined,
      must: s(b.must, 120) || undefined,
      mustNot: s(b.mustNot, 120) || undefined,
      entity: entity ? { name: entity.name, romanised: entity.romanised, org: entity.org, kind: entity.kind, descriptorZh: entity.descriptorZh, wikiTitleZh: entity.wikiTitleZh, wikiTitleEn: entity.wikiTitleEn } : undefined,
      number,
      items: items.length ? items : undefined,
      headline,
      anchor,
      term,
      diagram: diagram?.steps.length ? diagram : undefined,
      compareTitleZh: s(b.compareTitleZh, 30) || undefined,
      bars: bars.length ? bars : undefined,
      listTitleZh: s(b.listTitleZh, 30) || undefined,
    });
  }

  /* The top-level diagram lands on its sentence's concept beat, or becomes one; a diagram already on a beat wins. */
  const dg = (raw.diagram ?? null) as Record<string, unknown> | null;
  const dgSentence = dg ? sid(dg.sentenceId) : null;
  const dgSteps = dg ? strings(dg.steps, 3, 16) : [];
  if (dgSentence && dgSteps.length >= 2 && !beats.some((b) => b.diagram?.steps?.length)) {
    const host = beats.find((b) => b.sentenceId === dgSentence && b.intent === "concept") ?? beats.find((b) => b.sentenceId === dgSentence);
    if (host && host.intent === "concept") host.diagram = { steps: dgSteps };
    else {
      const n = (perSentence.get(dgSentence) ?? 0) + 1;
      perSentence.set(dgSentence, n);
      beats.push({ id: n === 1 ? dgSentence : `${dgSentence}.${n}`, sentenceId: dgSentence, intent: "concept", priority: 1, diagram: { steps: dgSteps }, anchor: dgSteps[0] });
    }
  }

  const chapters = list(raw.chapters)
    .map((c) => ({ sentenceId: sid(c.sentenceId), titleZh: s(c.titleZh, 12) }))
    .filter((c): c is { sentenceId: string; titleZh: string } => Boolean(c.sentenceId && c.titleZh))
    .slice(0, 6);

  const lt = (raw.lowerThird ?? {}) as Record<string, unknown>;
  const ec = (raw.endCard ?? {}) as Record<string, unknown>;
  return {
    titleZh: s(raw.titleZh, 60),
    subtitleZh: s(raw.subtitleZh, 60),
    hook,
    coldOpen: sid(raw.coldOpen),
    chapters,
    entities,
    beats,
    lowerThird: { sentenceId: sid(lt.sentenceId), name: s(lt.name, 30), sub: s(lt.sub, 60) },
    endCard: { sentenceId: sid(ec.sentenceId), titleZh: s(ec.titleZh, 40), questionZh: s(ec.questionZh, 60) },
    notesZh: s(raw.notesZh, 600),
  };
}

/**
 * When the figure `value` is said in the sentence: the start of the word
 * that carries its first digits (as a whole figure — `6` is not found
 * inside `63.5`), or its literal Han numerals; null when it is not said.
 */
export function whenSaid(sentence: Sentence, value: string): number | null {
  if (!value) return null;
  const first = value
    .replace(/[,，\s]/g, "")
    .split(/[–\-—~～]|到|vs|比|至|和/i)
    .map((p) => p.replace(/[%％]/g, ""))
    .filter(Boolean)[0];
  if (!first) return null;
  const digits = first.match(/\d+(?:\.\d+)?/)?.[0];
  let text = "";
  const spans: { from: number; to: number; startMs: number }[] = [];
  sentence.words.forEach((w, i) => {
    /* Whisper gives 1.51 as the fragments `1.` and `51`: a dot that closes a word stays when the next word opens with a digit, so the figure joins back together; any other dot is punctuation. */
    const next = sentence.words[i + 1]?.text ?? "";
    const raw = w.text.replace(/[。、!?！？；;：:]/g, "");
    const kept = raw.replace(/\.(?!\d)/g, (m, at: number) => (at === raw.length - 1 && /^\d/.test(next) && /\d$/.test(raw.slice(0, -1)) ? m : ""));
    const t = plainFigures(kept);
    spans.push({ from: text.length, to: text.length + t.length, startMs: w.startMs });
    text += t;
  });
  let at = -1;
  if (digits) {
    if (!hasFigure(digits, text)) return null;
    const m = new RegExp(`(?<![\\d.])${digits.replace(/[.]/g, "\\.")}(?![\\d.])`).exec(text);
    at = m ? m.index : -1;
  } else at = text.indexOf(first);
  if (at < 0) return null;
  return spans.find((sp) => sp.to > at)?.startMs ?? null;
}

/* ----------------------------------------------------------------- audits */

/**
 * The figures in a sentence that deserve a counter, as she says them.
 *
 * A figure with a unit (154页, 1.51亿次, 3500多个账号, 近30万条, 63.5%,
 * 十几倍 is Han and left to the model), or a range with one (6到9成); never
 * a date or a clock (9月8号, 今年8月, 5到7月, 2024年), never a bare
 * one-or-two digit count with no unit (三家 is Han anyway). The value is
 * the figure as spoken with its qualifier (近30万, 3500多), the unit is
 * what follows it.
 */
export function figuresIn(text: string): { value: string; unit: string; index: number }[] {
  /* Arabic digits only: a Han count (一个, 三家, 一轮比一轮) is not a stat, and `plainFigures` would turn it into one. */
  const plain = text.replace(/[,，\s]/g, "");
  const out: { value: string; unit: string; index: number }[] = [];
  const unit = "个账号|个|页|次|条|倍|%|％|成|美金|美元|块|人|家|轮|篇|款|种|万美金|亿美金";
  const range = new RegExp(`(\\d+(?:\\.\\d+)?)到(\\d+(?:\\.\\d+)?)(${unit})`, "g");
  const single = new RegExp(`(近|约|超过|逾|将近)?(\\d+(?:\\.\\d+)?)(多|余|来)?(万|亿|千|百)?(多|余)?(${unit})?`, "g");
  const taken: [number, number][] = [];
  for (const m of plain.matchAll(range)) {
    out.push({ value: `${m[1]}到${m[2]}`, unit: m[3], index: m.index ?? 0 });
    taken.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of plain.matchAll(single)) {
    const at = m.index ?? 0;
    if (taken.some(([a, b]) => at >= a && at < b)) continue;
    const after = plain.slice(at + m[0].length, at + m[0].length + 1);
    if (/[月日号年点时分秒]/.test(after) || (!m[6] && /[月日号年到]/.test(after))) continue;
    if (!m[6] && !m[4]) continue; // a bare count with no unit and no 万/亿 is not a stat
    const value = `${m[1] ?? ""}${m[2]}${m[3] ?? ""}${m[4] ?? ""}${m[5] ?? ""}`;
    out.push({ value, unit: m[6] ?? "", index: at });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Figures the model left out get their counter; entities it listed but
 * gave no beat get one at their first mention. The model reads the whole
 * transcript once and does forget: v1's second design pass found what
 * the first missed, and this is the code-side version of that pass, with
 * no second call. Every addition is written down for the notes.
 */
export function auditBeats(outline: Outline, sentences: readonly Sentence[]): { beats: DesignBeat[]; added: { beatId: string; reasonZh: string }[] } {
  const beats = outline.beats.slice();
  const added: { beatId: string; reasonZh: string }[] = [];
  const perSentence = new Map<string, number>();
  for (const b of beats) perSentence.set(b.sentenceId, Math.max(perSentence.get(b.sentenceId) ?? 0, Number(b.id.split(".")[1] ?? 1)));
  const nextId = (sentenceId: string) => {
    const n = (perSentence.get(sentenceId) ?? 0) + 1;
    perSentence.set(sentenceId, n);
    return n === 1 ? sentenceId : `${sentenceId}.${n}`;
  };

  /* figures: a figure the model set anywhere (a counter, a bar, a list item) is covered; the dedupe keeps each once */
  const stats = beats.filter((b) => b.intent === "number" || b.intent === "compare" || b.intent === "list");
  const covered = (value: string) =>
    stats.some((b) => {
      const digits = value.match(/\d+(?:\.\d+)?/g) ?? [];
      const own = [b.number?.value ?? "", ...(b.bars ?? []).map((x) => x.display), ...(b.items ?? []).map((x) => x.textZh)].join("|");
      return digits.every((d) => hasFigure(d, plainFigures(own)));
    });
  for (const s of sentences) {
    for (const f of figuresIn(s.text)) {
      if (covered(f.value)) continue;
      const id = nextId(s.id);
      beats.push({ id, sentenceId: s.id, intent: "number", priority: 2, anchor: `${f.value}${f.unit}`, number: { value: f.value, unit: f.unit, labelZh: "", saidAtMs: whenSaid(s, f.value) ?? s.startMs }, reasonZh: "模型漏掉的数字，按口播补上" });
      added.push({ beatId: id, reasonZh: `数字「${f.value}${f.unit}」模型没有安排，补为计数` });
    }
  }

  /* entities */
  const bySentence = new Map(sentences.map((x) => [x.id, x]));
  for (const e of outline.entities) {
    if (beats.some((b) => b.entity?.name === e.name)) continue;
    const spellings = [e.name, e.romanised].filter((x): x is string => Boolean(x && x.length >= 2));
    const firstFromModel = e.firstSentenceId ? bySentence.get(e.firstSentenceId) : undefined;
    const hit = (firstFromModel && spellings.some((sp) => firstFromModel.text.toLowerCase().includes(sp.toLowerCase())) ? firstFromModel : undefined) ?? sentences.find((x) => spellings.some((sp) => x.text.toLowerCase().includes(sp.toLowerCase()))) ?? firstFromModel;
    if (!hit) continue;
    const spelt = spellings.find((sp) => hit.text.toLowerCase().includes(sp.toLowerCase())) ?? e.name;
    const intent: Intent = e.kind === "person" ? "person" : e.kind === "product" ? "product" : "org";
    const rom = e.romanised ?? e.name;
    const queries =
      intent === "person"
        ? { zh: [`${e.name} 采访`, `${e.name} 演讲`], en: [`${rom} ${e.org ?? ""} interview`.replace(/\s+/g, " ").trim()] }
        : intent === "product"
          ? { zh: [`${e.name} 演示`, `${e.name} 界面`], en: [`${rom} app demo`, `${rom} UI`] }
          : { zh: [`${e.name} 标志`, `${e.name} 总部`], en: [`${rom} logo`, `${rom} headquarters`] };
    const id = nextId(hit.id);
    beats.push({
      id,
      sentenceId: hit.id,
      intent,
      priority: 2,
      anchor: spelt,
      queries,
      must: intent === "person" ? `${e.name}本人的脸` : intent === "product" ? `${e.name} 的界面` : `${e.name} 的标志或建筑`,
      mustNot: intent === "person" ? "其他人；把本人放在描述不法行为的句子上" : "无关公司；带字幕或水印的画面",
      entity: { name: e.name, romanised: e.romanised, org: e.org, kind: e.kind, descriptorZh: e.descriptorZh, wikiTitleZh: e.wikiTitleZh, wikiTitleEn: e.wikiTitleEn },
      reasonZh: "模型列了实体却没给镜头，按首次提及补上",
    });
    added.push({ beatId: id, reasonZh: `「${e.name}」模型没有安排镜头，按首次提及（${hit.id}）补上` });
  }
  return { beats, added };
}

/* ----------------------------------------------------------------- dedupe */

const norm = (q: string) => q.toLowerCase().replace(/[\s，,。.、·・\-_/]/g, "");

/**
 * No twice: queries by normalised text, stats by their digits, entities
 * by name. The first mention keeps the card; a later identical query is
 * demoted to priority 3 (sourcing may still find a *different* clip for
 * it); a repeated figure is dropped outright, because v1's second 3500多个账号
 * was exactly the fault the owner named. A figure whose digits are not in
 * the captions within ±1.5 s of the sentence is dropped too: v1 let
 * 便宜6到9成 appear at 42.5 s because the check was brief-wide.
 */
export function dedupeBeats(beats: DesignBeat[], sentences: readonly Sentence[], captions: DesignInput["captions"]): { beats: DesignBeat[]; dropped: { beatId: string; reasonZh: string }[] } {
  const bySentence = new Map(sentences.map((x) => [x.id, x]));
  const ordered = beats.slice().sort((a, b) => (bySentence.get(a.sentenceId)?.startMs ?? 0) - (bySentence.get(b.sentenceId)?.startMs ?? 0));
  const seenQuery = new Set<string>();
  const seenStat = new Set<string>();
  const seenBars = new Set<string>();
  const cardDone = new Set<string>();
  const dropped: { beatId: string; reasonZh: string }[] = [];
  const out: DesignBeat[] = [];
  /*
   * A compare's bars are each said somewhere near its sentence: in it, in
   * the two after it or the one before (几千万–几亿美金 … 几千–几十万美金 sit
   * eight seconds apart in two sentences). Every bar found → the compare
   * stands, timed by where each figure is said; one missing → dropped. The
   * figures a standing compare carries are not counted again: the bars are
   * the richer graphic.
   */
  const index = new Map(ordered.map((b) => b.sentenceId).map((id) => [id, sentences.findIndex((x) => x.id === id)]));
  const compareAt = new Map<string, number[]>();
  const inBars: string[] = [];
  for (const b of ordered) {
    if (b.intent !== "compare" || !b.bars?.length) continue;
    const i = index.get(b.sentenceId) ?? -1;
    const near = [sentences[i], sentences[i + 1], sentences[i + 2], sentences[i - 1]].filter((x): x is Sentence => Boolean(x));
    const at = b.bars.map((bar) => {
      for (const x of near) {
        const when = whenSaid(x, bar.display);
        if (when !== null) return when;
      }
      return null;
    });
    if (at.every((x): x is number => x !== null) && Math.max(...at) - Math.min(...at) <= 12_000) {
      compareAt.set(b.id, at);
      inBars.push(...b.bars.map((x) => x.display));
    }
  }

  for (const b of ordered) {
    const sent = bySentence.get(b.sentenceId);
    if (!sent) {
      dropped.push({ beatId: b.id, reasonZh: "句子不在成片里" });
      continue;
    }
    /* The presenter introducing herself is the lower third's moment, not a person cutaway. */
    if (b.intent === "person" && !b.entity && /^我是/.test(b.anchor ?? "")) {
      dropped.push({ beatId: b.id, reasonZh: "「我是…」是主播自我介绍，由姓名条处理，不找人物镜头" });
      continue;
    }
    const beat: DesignBeat = { ...b };

    if (beat.queries) {
      const zh = beat.queries.zh.filter((q) => !seenQuery.has(norm(q)));
      const en = beat.queries.en.filter((q) => !seenQuery.has(norm(q)));
      const repeated = zh.length + en.length < beat.queries.zh.length + beat.queries.en.length;
      for (const q of [...beat.queries.zh, ...beat.queries.en]) seenQuery.add(norm(q));
      if (repeated && !zh.length && !en.length) {
        beat.priority = 3;
        beat.reasonZh = "查询词与前面的镜头重复，降为第三优先";
      }
      if (zh.length || en.length) beat.queries = { zh: zh.length ? zh : beat.queries.zh, en: en.length ? en : beat.queries.en };
    }

    if (beat.intent === "number" && beat.number) {
      const key = beat.number.value.replace(/[,，\s]/g, "");
      if (seenStat.has(key)) {
        dropped.push({ beatId: beat.id, reasonZh: `数字「${beat.number.value}」已经上过一次，不重复` });
        continue;
      }
      if (inBars.length && saidNear(beat.number.value, inBars.join("|"))) {
        dropped.push({ beatId: beat.id, reasonZh: `数字「${beat.number.value}」已在对比条里，不再单独计数` });
        continue;
      }
      const near = captions.filter((c) => c.endMs >= sent.startMs - 1500 && c.startMs <= sent.endMs + 1500).map((c) => c.text).join("");
      if (!saidNear(beat.number.value, near || sent.text)) {
        dropped.push({ beatId: beat.id, reasonZh: `数字「${beat.number.value}」在这句 ±1.5 s 的字幕里没有说到，不上屏` });
        continue;
      }
      seenStat.add(key);
    }

    if (beat.intent === "compare" && beat.bars) {
      const key = beat.bars.map((x) => x.display.replace(/[,，\s]/g, "")).sort().join("|");
      if (seenBars.has(key)) {
        dropped.push({ beatId: beat.id, reasonZh: `对比「${key}」已经上过一次，不重复` });
        continue;
      }
      const at = compareAt.get(beat.id);
      if (!at) {
        dropped.push({ beatId: beat.id, reasonZh: `对比「${key}」的数字没有在这句附近（前一句到后两句）说全，不上屏` });
        continue;
      }
      beat.barsAtMs = at;
      seenBars.add(key);
    }

    if ((beat.intent === "org" || beat.intent === "product" || beat.intent === "person") && beat.entity) {
      /* The first beat of an entity is its card; later ones become chips (layout decides) and never need sourcing again. */
      if (cardDone.has(beat.entity.name)) {
        beat.priority = 3;
        beat.queries = undefined;
        beat.reasonZh = "已介绍过，再次提及只用小标识";
      } else cardDone.add(beat.entity.name);
    }

    out.push(beat);
  }
  return { beats: out, dropped };
}

/* -------------------------------------------------------------- the step */

const FOOTAGE_INTENTS = new Set<Intent>(["person", "org", "product", "headline", "scene", "metaphor", "concept"]);

/** The one line per sentence the model reads: id, timing, text. */
export function transcriptLines(sentences: readonly Sentence[]): string {
  return sentences.map((x) => `${x.id} [${(x.startMs / 1000).toFixed(1)}–${(x.endMs / 1000).toFixed(1)}s] ${x.text}`).join("\n");
}

export function outlineMessages(input: DesignInput, window?: { sentences: Sentence[]; seed: Outline }): { system: string; user: string } {
  const system = `${REEL_SPEC}\n\n---\n\n${input.voice ? `The creator whose channel this is for, in their own numbers and words:\n${input.voice}\n\n---\n\n` : ""}${OUTLINE_PROMPT}`;
  const parts = [
    `Brief from the producer:\n${input.brief || "(none given: make the best reel the footage allows)"}`,
    `The finished cut runs ${(input.totalMs / 1000).toFixed(1)} s in ${input.pieces.length} pieces; ${input.sentences.length} sentences.`,
    `Furniture already placed by code: header 「${input.furniture.header.title}」, watermark 「${input.furniture.watermark ?? ""}」, footnote. Captions: bilingual, keywords in ${input.accent}. Do not list them.`,
  ];
  if (window) {
    parts.push(
      `This is a detail pass over sentences ${window.sentences[0]?.id}–${window.sentences[window.sentences.length - 1]?.id}. The whole-video outline is fixed:\n${JSON.stringify({ hook: window.seed.hook, chapters: window.seed.chapters, entities: window.seed.entities.map((e) => e.name) })}\nAnswer with "beats" for these sentences only (and empty hook/chapters/entities).`,
    );
    parts.push(`Transcript for this part:\n${transcriptLines(window.sentences)}`);
  } else {
    parts.push(`Transcript, one sentence per line:\n${transcriptLines(input.sentences)}`);
  }
  return { system, user: parts.join("\n\n") };
}

/** Where each entity is named after its first mention, by scanning the sentences for its spellings. */
export function entityMentions(entities: OutlineEntity[], sentences: readonly Sentence[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of entities) {
    const spellings = [e.name, e.romanised].filter((x): x is string => Boolean(x && x.length >= 2)).map((x) => x.toLowerCase());
    const hits = sentences.filter((x) => spellings.some((sp) => x.text.toLowerCase().includes(sp))).map((x) => x.id);
    const first = e.firstSentenceId ?? hits[0];
    out[e.name] = hits.filter((id) => id !== first);
  }
  return out;
}

/**
 * The plain credits text when W3's `placeCredits` is not wired: one line
 * for the end card (each source once, in the order first used), one block
 * for the copy with the takedown line, and the asset records. Only assets
 * the plan actually put on screen are credited; a fetched clip that found
 * no slot is not a source of the video.
 */
export function fallbackCredits(sourced: Sourced[]): Credits {
  const assets: Sourced["asset"][] = [];
  const seenFile = new Set<string>();
  for (const x of sourced) {
    if (seenFile.has(x.asset.fileId)) continue;
    seenFile.add(x.asset.fileId);
    assets.push(x.asset);
  }
  const line = assets.length ? creditsLineOf(assets) : "";
  const block = assets.length
    ? [
        "素材来源 / Sources",
        ...assets.map((a) => `- ${a.credit || a.candidate.credit} · ${a.candidate.title}${a.candidate.licence ? ` · ${a.candidate.licence}` : ""} · ${a.candidate.url}`),
        "平台视频片段仅作评论引用，版权归原作者所有；如有异议请联系我们删除。",
      ].join("\n")
    : "";
  return { line, block, assets };
}

const PLATFORM_ZH: Record<string, string> = { douyin: "抖音", tiktok: "TikTok", bilibili: "B站", youtube: "YouTube", pinterest: "Pinterest", bing: "Bing", pexels: "Pexels", unsplash: "Unsplash", openverse: "Openverse" };

/** Display width in half-width units: a CJK character (U+2E80 and up) is two, anything else one, which is what fits on a 26 px line. */
const units = (text: string) => Array.from(text).reduce((n, ch) => n + (ch.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0);

/**
 * The end card's 素材来源 line, at most two lines of 26 px (about 72
 * units each, inside the 64 px margins): every source once, in the order
 * first used, grouped by platform; when that does not fit, the first
 * account per platform and 「等 N 位」; when even that does not fit, the
 * counts alone. W3's `placeCredits` does the same with the library's own
 * labels; this is the line when it is not wired.
 */
export function creditsLineOf(assets: readonly Sourced["asset"][], maxUnits = 144): string {
  const groups = new Map<string, string[]>();
  for (const a of assets) {
    const platform = a.candidate.platform;
    const who = (a.credit || a.candidate.credit || "").replace(/^[^@·]*[@·]\s*/, "").trim() || a.candidate.author.name;
    const names = groups.get(platform) ?? [];
    if (!names.includes(who)) names.push(who);
    groups.set(platform, names);
  }
  const label = (p: string) => PLATFORM_ZH[p] ?? p;
  const full = `素材来源：${Array.from(groups, ([p, names]) => `${label(p)} ${names.map((n) => `@${n}`).join(" · ")}`).join(" · ")}`;
  if (units(full) <= maxUnits) return full;
  const compact = `素材来源：${Array.from(groups, ([p, names]) => `${label(p)} @${names[0]}${names.length > 1 ? ` 等${names.length}位` : ""}`).join(" · ")}`;
  if (units(compact) <= maxUnits) return compact;
  return `素材来源：${Array.from(groups, ([p, names]) => `${label(p)} ${names.length}位`).join(" · ")}`;
}

/** The assets the plan put on screen: cutaways, logos on entity cards, images behind headline cards. */
export function usedOnScreen(plan: LayoutPlan, sourced: Sourced[], logos: Record<string, Sourced>): Sourced[] {
  const byFile = new Map<string, Sourced>();
  for (const s of [...sourced, ...Object.values(logos)]) byFile.set(s.asset.fileId, s);
  const out: Sourced[] = [];
  const seen = new Set<string>();
  const take = (fileId: string | undefined) => {
    if (!fileId || seen.has(fileId)) return;
    const s = byFile.get(fileId);
    if (!s) return;
    seen.add(fileId);
    out.push(s);
  };
  for (const c of plan.cutaways) take(c.asset.fileId);
  for (const g of plan.graphics) {
    const pictured = (g.props.logo ?? g.props.image) as { asset?: { fileId?: string } } | null | undefined;
    take(pictured?.asset?.fileId);
    /* A group card carries one logo per name. */
    for (const m of (g.props.group as { logo?: { asset?: { fileId?: string } } | null }[] | undefined) ?? []) take(m.logo?.asset?.fileId);
  }
  return out;
}

/**
 * The design: outline → dedupe → source → layout → lint.
 *
 * Above 150 sentences the outline call keeps its whole-video view (hook,
 * chapters, entities) and the beats come from detail windows of 120
 * sentences, each seeded with that outline, so a twenty-minute take is
 * designed as carefully at the end as at the start.
 */
export async function planDesign(input: DesignInput, deps: DesignDeps): Promise<DesignResult> {
  const say = deps.say ?? (() => undefined);
  const t0 = Date.now();
  let outline: Outline;
  if (deps.outline) {
    outline = deps.outline;
  } else {
    if (!deps.complete) throw new Error("planDesign: no model and no cached outline");
    await say("规划全片：钩子、章节、每句话该配什么");
    const msg = outlineMessages(input);
    const res = await deps.complete({ ...msg, maxTokens: 14_000, temperature: 0.2 });
    outline = parseOutline(res.text, input.sentences);
    if (input.sentences.length > 150) {
      const windows: Sentence[][] = [];
      for (let i = 0; i < input.sentences.length; i += 120) windows.push(input.sentences.slice(i, i + 120));
      await say(`分 ${windows.length} 段细化每句的画面`);
      const results = await Promise.allSettled(windows.map((w) => deps.complete!({ ...outlineMessages(input, { sentences: w, seed: outline }), maxTokens: 12_000, temperature: 0.2 })));
      const beats: DesignBeat[] = [];
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const part = parseOutline(r.value.text, windows[i], { entities: outline.entities });
        beats.push(...part.beats);
      });
      if (beats.length) outline = { ...outline, beats };
    }
  }
  const outlineMs = Date.now() - t0;

  /* Defaults from the brief when the model left a field empty; the brief's own block always wins for the hook. */
  outline.hook.lines = hookFromBrief(input.brief) ?? (outline.hook.lines.length ? outline.hook.lines : hookFromSentence(input.sentences[0]));
  if (!outline.endCard.titleZh) outline.endCard.titleZh = input.furniture.watermark ?? "";
  /* The header's subtitle is the model's distillation of her words when the brief did not write one. */
  const furniture = { ...input.furniture, header: { title: input.furniture.header.title || outline.titleZh, sub: input.furniture.header.sub ?? (outline.subtitleZh || null) } };

  const audited = auditBeats(outline, input.sentences);
  const { beats, dropped } = dedupeBeats(audited.beats, input.sentences, input.captions);

  /* ---- sourcing: the footage beats, in time order ------------------- */
  /*
   * Every beat that wants footage goes, up to two per sentence, in time
   * order (W3 alternates media type across consecutive picks by the order
   * it is given). Not sent: a concept beat that carries a term card or the
   * diagram (the designed card beats a weak explainer clip by the plan's
   * own order); the second and later names of a crowded breath (「DeepSeek、
   * 月之暗面和MiniMax」 gets one glimpse and then the group card, whose logos
   * come from `entityVisual` per entity, so a clip per name would be fetched
   * and never shown); anything demoted to priority 3. W3 answers with its
   * own ids; `sourcedForLayout` maps them back to these beats.
   */
  const t1 = Date.now();
  let sourced: Sourced[] = [];
  const picked = pickForSourcing(beats, input.sentences);
  const forSourcing = picked.map((b) => stripBeat(b));
  const logos: Record<string, Sourced> = {};
  const jobs: Promise<void>[] = [];
  if (deps.sourceBeats && forSourcing.length) {
    const sample = forSourcing.find((b) => b.intent === "person") ?? forSourcing[0];
    await say(`在抖音、B站、YouTube 找『${sample.queries?.zh[0] ?? sample.queries?.en[0] ?? ""}』等 ${forSourcing.length} 组素材`);
    jobs.push(
      deps.sourceBeats(forSourcing).then((out) => {
        sourced = out;
      }),
    );
  }
  if (deps.entityVisual && outline.entities.length) {
    await say(`找 ${outline.entities.length} 个机构、公司、产品的标志`);
    const resolver = deps.entityVisual;
    /* Six at a time, as the plan's limiter; a failure is a card without a logo, never a failed design. */
    const queue = outline.entities.slice();
    const worker = async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const found = await resolver(e).catch(() => null);
        if (found) logos[e.name] = found;
      }
    };
    jobs.push(...Array.from({ length: Math.min(6, queue.length) }, worker));
  }
  await Promise.all(jobs);
  const mapped = sourcedForLayout(sourced, picked);
  sourced = mapped.sourced;
  dropped.push(...mapped.dropped);
  if (sourced.length) await say(`核对 ${sourced.length} 个镜头的相关度`);
  const sourcingMs = Date.now() - t1;

  /* ---- layout ------------------------------------------------------- */
  const t2 = Date.now();
  await say("排版：镜头节奏、图形位置、推近");
  const layoutInput = {
    beats,
    sourced,
    sentences: input.sentences,
    pieces: input.pieces,
    face: input.face,
    pace: input.pace,
    totalMs: input.totalMs,
    hook: outline.hook,
    chapters: outline.chapters,
    lowerThird: outline.lowerThird,
    endCard: outline.endCard,
    furniture,
    mentions: entityMentions(outline.entities, input.sentences),
    logos,
  };
  /* Two passes: the first to learn which assets the plan uses, the second with the credits line those assets make (the end card carries it). Only the second is traced. */
  const draft = resolveLayout(layoutInput);
  await say("生成素材来源");
  const used = usedOnScreen(draft, sourced, logos);
  const credits = deps.placeCredits ? deps.placeCredits(used) : fallbackCredits(used);
  const plan = resolveLayout({ ...layoutInput, credits, trace: deps.trace });
  const layoutMs = Date.now() - t2;
  const lint = lintPlan(plan, { totalMs: input.totalMs, face: input.face, captions: input.captions, hookLines: hookFromBrief(input.brief) ?? undefined });

  const notesZh = [
    outline.notesZh,
    `${plan.graphics.filter((g) => !["header", "watermark", "footnote"].includes(g.kind)).length} 个图形、${plan.cutaways.length} 个空镜（占 ${(plan.stats.coverage * 100).toFixed(0)}%）、${plan.runs.length} 段圆框、${plan.pushes.length} 次推近、${outline.chapters.length} 个章节、${used.length} 个来源。`,
    audited.added.length ? `补上：${audited.added.map((d) => d.reasonZh).join("；")}。` : "",
    dropped.length ? `未上屏：${dropped.map((d) => d.reasonZh).join("；")}。` : "",
    plan.stats.skipped.length ? `没有位置：${plan.stats.skipped.length} 处。` : "",
    ...plan.notesZh,
    input.cut?.noteZh ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return { outline, beats, sourced, logos, plan, credits, lint, notesZh, timings: { outlineMs, sourcingMs, layoutMs }, dropped: [...dropped, ...plan.stats.skipped], added: audited.added };
}

/** The frozen `Beat` for sourcing: the layout-only fields stripped. */
function stripBeat(b: DesignBeat): Beat {
  return { sentenceId: b.sentenceId, intent: b.intent, priority: b.priority, punchline: b.punchline, queries: b.queries, must: b.must, mustNot: b.mustNot, entity: b.entity, number: b.number, items: b.items, headline: b.headline };
}

const ENTITY_INTENTS = new Set<Intent>(["person", "org", "product"]);

/** The beats to send to sourcing, in time order, at most two per sentence and one entity beat per crowded breath (see `planDesign`). */
export function pickForSourcing(beats: readonly DesignBeat[], sentences: readonly Sentence[]): DesignBeat[] {
  const startOf = new Map(sentences.map((s) => [s.id, s.startMs]));
  const entityBeatsIn = new Map<string, number>();
  for (const b of beats) if (ENTITY_INTENTS.has(b.intent) && b.priority < 3) entityBeatsIn.set(b.sentenceId, (entityBeatsIn.get(b.sentenceId) ?? 0) + 1);
  const perSentence = new Map<string, number>();
  const entitySent = new Set<string>();
  const out: DesignBeat[] = [];
  const ordered = beats.slice().sort((a, b) => (startOf.get(a.sentenceId) ?? 0) - (startOf.get(b.sentenceId) ?? 0) || a.priority - b.priority);
  for (const b of ordered) {
    if (!FOOTAGE_INTENTS.has(b.intent) || !b.queries || b.priority === 3) continue;
    if (b.intent === "concept" && (b.term || b.diagram)) continue;
    if ((perSentence.get(b.sentenceId) ?? 0) >= 2) continue;
    if (ENTITY_INTENTS.has(b.intent) && (entityBeatsIn.get(b.sentenceId) ?? 0) >= 3) {
      if (entitySent.has(b.sentenceId)) continue;
      entitySent.add(b.sentenceId);
    }
    perSentence.set(b.sentenceId, (perSentence.get(b.sentenceId) ?? 0) + 1);
    out.push(b);
  }
  return out;
}

/**
 * W3's picks keyed by the design beat they were found for.
 *
 * The frozen `Beat` has no id, so W3 names each pick by its position in
 * the list it was given — `bNN-sNNN-intent` (`sourcing.ts:beatIdOf`) — and
 * the lab's stubs, or an older adapter, may answer with the bare sentence
 * id. All three are read: the index (checked against the sentence it
 * names), a design beat id as is, a sentence id as that sentence's first
 * beat sent. A pick that names nothing sent is left out and written down
 * rather than silently dropped, and a second pick for the same beat is
 * too — one asset per beat.
 */
export function sourcedForLayout(sourced: readonly Sourced[], sent: readonly DesignBeat[]): { sourced: Sourced[]; dropped: { beatId: string; reasonZh: string }[] } {
  const out: Sourced[] = [];
  const dropped: { beatId: string; reasonZh: string }[] = [];
  const taken = new Set<string>();
  for (const s of sourced) {
    let id: string | null = null;
    const byIndex = /^b(\d+)-(s\d+)/.exec(s.beatId);
    if (byIndex) {
      const beat = sent[Number(byIndex[1])];
      if (beat && beat.sentenceId === byIndex[2]) id = beat.id;
    }
    if (!id && sent.some((b) => b.id === s.beatId)) id = s.beatId;
    if (!id) id = sent.find((b) => b.sentenceId === s.beatId)?.id ?? null;
    if (!id) {
      dropped.push({ beatId: s.beatId, reasonZh: `素材「${s.candidate.title.slice(0, 20)}」对应的镜头（${s.beatId}）不在送去找素材的列表里，未使用` });
      continue;
    }
    if (taken.has(id)) {
      dropped.push({ beatId: s.beatId, reasonZh: `镜头 ${id} 已有素材，第二个「${s.candidate.title.slice(0, 20)}」未使用` });
      continue;
    }
    taken.add(id);
    out.push(s.beatId === id ? s : { ...s, beatId: id });
  }
  return { sourced: out, dropped };
}

/** The brief's statement block, when it writes one as 「A | B | C」 or "A | B | C". */
export function hookFromBrief(brief: string): string[] | null {
  const m = /[「“"]([^」”"\n]{2,40}\|[^」”"\n]{2,40})[」”"]/.exec(brief);
  if (!m) return null;
  const lines = m[1].split("|").map((x) => x.trim()).filter(Boolean).slice(0, 3);
  return lines.length >= 2 && lines.every((l) => l.replace(/[【】]/g, "").length <= 8) ? lines : null;
}

function hookFromSentence(sentence: Sentence | undefined): string[] {
  if (!sentence) return [];
  const text = sentence.text.replace(/[，,。！？!?]/g, " ").trim();
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === " ") {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
    if (hanCount(cur) >= 8) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}
