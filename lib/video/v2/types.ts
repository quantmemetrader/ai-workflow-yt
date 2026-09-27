/**
 * Director v2: the contracts every workstream codes against.
 *
 * Frozen after Stage 0 (PLAN.md §2, Stage 0 item 4). Seven workstreams build
 * on disjoint files and meet only here, so a change to any of these shapes is
 * a change to the plan, made by the lead and announced, never slipped into a
 * branch. The bodies below are the plan's text verbatim; only this comment and
 * the doc lines are additions.
 *
 * Times are milliseconds unless the name says otherwise. `Sentence.id` is
 * stable (`s000`, `s001`, …) so the outline call, the cut report and the gold
 * labels can all name the same line. `Sourced.asset` and `.candidate` are the
 * media library's own records (`lib/media/types.ts`); the director never
 * invents a shape for something the library already describes.
 */

export interface Word { text: string; startMs: number; endMs: number }
export interface Sentence { id: string; clipId: string; startMs: number; endMs: number; text: string; words: Word[] }
export interface Silence { startMs: number; endMs: number }
export interface Retake { dropStartMs: number; dropEndMs: number; keptSentenceId: string; droppedSentenceIds: string[];
  kind: "restart"|"reworded"|"stutter"|"repeat"; score: number; decidedBy: "rule"|"model" }
export interface CutPiece { clipId: string; inMs: number; outMs: number }
export interface CutReport { removed: { sentenceIds: string[]; ms: number; reason: "retake"|"pause"|"filler"|"off-topic"|"aside"; text: string }[];
  restored: string[]; overBudgetMs: number; noteZh: string }
export interface FaceTrack { clipId: string; box: [number,number,number,number]; eyeY: number; chinY: number; samples: number }
export type Intent = "person"|"org"|"product"|"headline"|"number"|"compare"|"list"|"concept"|"scene"|"metaphor"|"none";
export interface Beat { sentenceId: string; intent: Intent; priority: 1|2|3; punchline?: boolean;
  queries?: { zh: string[]; en: string[] };            // ≤ 2 each, shootable phrases, romanised names for people
  must?: string; mustNot?: string;                     // what the frame must / must not show
  entity?: { name: string; romanised?: string; org?: string; kind: "company"|"agency"|"person"|"product"|"publication"|"legislature"; descriptorZh: string; wikiTitleZh?: string; wikiTitleEn?: string };
  number?: { value: string; unit: string; labelZh: string; saidAtMs: number };
  items?: { textZh: string; sentenceId: string }[]; headline?: { outlet: string; date: string; quoteZh: string; url?: string } }
export type Layout = "full"|"split"|"run";
export interface Sourced { beatId: string; asset: import("@/lib/media").Asset; candidate: import("@/lib/media").Candidate;
  kind: "video"|"image"|"logo"; score: number; reasonZh: string; windowMs: [number, number]; subjectX: number; dhash: string;
  layout: Layout; alternatives: { candidate: import("@/lib/media").Candidate; score: number }[] }
export interface GraphicSpecV2 { id: string; kind: string; startMs: number; endMs: number; zone: "T"|"full"|"lower"|"corner"; props: Record<string, unknown> }
export interface MotionClip { id: string; startMs: number; endMs: number; x: number; y: number; w: number; h: number; parts: { full?: string; in?: string; hold?: string; out?: string } }
export interface RenderPlan { width: number; height: number; fps: 30;
  cuts: (CutPiece & { file: string; zoom: number; anchor: [number, number]; push?: { fromMs: number; toMs: number; to: number } })[];
  cutaways: { file: string; startMs: number; endMs: number; sourceInMs: number; cropX: number; still: boolean; layout: Layout; runId?: string }[];
  motion: MotionClip[]; furniture?: string; assFile?: string;
  audio: { voiceChain: boolean; cutFadeMs: 12; music?: { file: string; gainDb: number }; sfx?: { file: string; atMs: number; gainDb: number }[] } }
export interface Credits { line: string; block: string; assets: import("@/lib/media").Asset[] }
