import type { DocApproval, DocReference } from "@/lib/script/doc";
import type { SentBack } from "@/lib/projects/sendback";
import type { RichDoc } from "@/lib/script/rich";

export type DocBeat = { visual: string; voiceover: string; subtitle: string; naturalSound: boolean };

export type DocComment = {
  id: string;
  /** Set on a reply: the thread's first comment. */
  parentId: string | null;
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
  /** Why the last first draft failed (null once one lands). */
  draftFailed?: { at: string; note: string } | null;
  sentBack: SentBack | null;
  people: { id: string; name: string; avatarUrl: string | null; title: string | null }[];
  /** Who can open the project (and so the link), in one line. */
  accessNote: string;
  /** The topic the script is written from, shown above the AI panel (Avon, 8 Oct: the topic chosen with 研究员 could not be seen on the script page). */
  topic?: { title: string; label: string | null; why: string | null; angle: string | null; hook: string | null; points: string[]; href: string } | null;
  /** The project's own access, for who sees an uploaded reference file. */
  accessMode: "private" | "everyone" | "groups" | "people";
  /** The project's whole access setting, and whether this person may change it (谁能看). */
  access?: { mode: "private" | "everyone" | "groups" | "people"; groups?: string[]; userIds?: string[] };
  canManageAccess?: boolean;
  /** 有链接的人: nobody extra, view, or edit. */
  linkAccess?: "view" | "edit" | null;
};

export type { DocApproval, DocReference };
