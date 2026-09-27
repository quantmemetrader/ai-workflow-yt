import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, conversations, toolCalls } from "@/lib/db/schema";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { listPeople } from "@/lib/chat/service";
import { workProjectDetail } from "@/lib/projects/service";
import { scriptWriting } from "@/lib/script/writing";
import { ProjectScreen } from "@/components/projects/ProjectScreen";
import { voicesForUi } from "@/lib/video/tts";

export const metadata = { title: "项目 · Project" };

/** One project: its steps, what it has made, and its own conversation. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [project, people] = await Promise.all([workProjectDetail(viewer, id, zh), listPeople(viewer)]);
  if (!project) notFound();
  /* Whether 编剧 is writing into its script now, with the mark's time limit
     applied here rather than in the browser, whose clock may differ. */
  const writing = project.script ? (await scriptWriting(viewer.tenantId, project.script.id)).writing : false;
  /* The narration voices for the video card's AI 配音 — only for somebody who
     can make the video, and only when there is a video to make. */
  const voices = project.video && viewer.modules.includes("video") ? await voicesForUi().catch(() => []) : [];
  /* Your own private chats that worked on this project (编剧 wrote its script
     there, 剪辑师 made its video there): linked from the page, which used to
     say "对话 0" while the whole conversation had happened in private. */
  const refs = [project.id, project.script?.id, project.video?.id].filter((x): x is string => Boolean(x));
  const privateChats = refs.length
    ? await db
        .selectDistinct({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
        .from(conversations)
        .innerJoin(agentMessages, eq(agentMessages.conversationId, conversations.id))
        .innerJoin(toolCalls, eq(toolCalls.messageId, agentMessages.id))
        .where(and(eq(conversations.userId, viewer.id), isNull(conversations.archivedAt), or(...refs.map((r) => sql`${toolCalls.result}::text like ${`%${r}%`}`))))
        .orderBy(desc(conversations.updatedAt))
        .limit(5)
        .catch(() => [])
    : [];
  return (
    <ProjectScreen
      project={project}
      zh={zh}
      writing={writing}
      voices={voices}
      privateChats={privateChats.map((c) => ({ id: c.id, title: c.title }))}
      canApprove={viewer.role === "owner" || viewer.role === "admin"}
      people={people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name, avatarUrl: p.avatarUrl, title: p.title, email: p.email }))}
    />
  );
}
