import type { DocApproval, DocReference } from "@/lib/script/doc";
import type { SentBack } from "@/lib/projects/sendback";
import type { RichDoc } from "@/lib/script/rich";

export type DocBeat = { visual: string; voiceover: string; subtitle: string; naturalSound: boolean };

export type DocComment = {
  id: string;
  beatOrd: number | null;
  quote: string | null;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  authorId: string | null;
  authorName: string;
  authorAvatar: string | null;
};

export type DocVersion = {
  versionNo: number;
  createdAt: string;
  authorName: string | null;
  note: string | null;
  wordCount: number;
  spokenSeconds: number | null;
  model: string | null;
};

export type ScriptDocProps = {
  projectId: string;
  projectTitle: string;
  zh: boolean;
  me: { id: string; name: string; avatarUrl: string | null; isAdmin: boolean; canEdit: boolean };
  script: { id: string; title: string; version: number; lockedVersion: number | null; status: string; targetSeconds: number | null; mandatoryPoints: string[] } | null;
  beats: DocBeat[];
  /** The rich document the page opens (`lib/script/rich.ts` docForBeats). */
  doc: RichDoc;
  versions: DocVersion[];
  approvals: DocApproval[];
  comments: DocComment[];
  references: DocReference[];
  writing: boolean;
  sentBack: SentBack | null;
  people: { id: string; name: string; avatarUrl: string | null; title: string | null }[];
  /** Who can open the project (and so the link), in one line. */
  accessNote: string;
  /** The project's own access, for who sees an uploaded reference file. */
  accessMode: "private" | "everyone" | "groups" | "people";
};

export type { DocApproval, DocReference };
