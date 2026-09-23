import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { topics, users } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { BacklogView } from "@/components/research/BacklogView";
import { connectedSources, decisionCount } from "@/lib/research/service";
import { openCommentCount } from "@/lib/social/service";

export const metadata = { title: "选题储备 · Backlog" };

/** Adopted topics, with owner, target channel and due date — what Script needs
 * before it can start (brief §4.3, Topic backlog). */
const CHANNELS = ["YouTube", "Instagram", "TikTok", "LinkedIn", "WeChat", "Xiaohongshu"];

export default async function BacklogPage() {
  const viewer = await requireModule("research");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  const [rows, people, sources, decisions, open] = await Promise.all([
    db
      .select({ topic: topics, ownerName: users.name, ownerNameLocal: users.nameLocal })
      .from(topics)
      .leftJoin(users, eq(users.id, topics.ownerId))
      .where(and(eq(topics.tenantId, viewer.tenantId), inArray(topics.status, ["adopted", "saved"])))
      .orderBy(topics.dueDate),
    db
      .select({ id: users.id, name: users.name, nameLocal: users.nameLocal })
      .from(users)
      .where(eq(users.tenantId, viewer.tenantId))
      .orderBy(users.name),
    connectedSources(),
    decisionCount(viewer),
    openCommentCount(viewer),
  ]);

  return (
    <>
      <ResearchSidebar
        locale={viewer.locale ?? "zh-CN"}
        decisionCount={decisions}
        inboxCount={open}
        backlogCount={rows.length}
        sources={sources.map((s) => ({
          key: s.key,
          name: s.name,
          kind: s.kind,
          status: s.status,
          note: s.note ?? s.lastError,
        }))}
      />
      <BacklogView
      locale={viewer.locale ?? "zh-CN"}
      region="HK / TW / SG"
      model={answeringModel()}
      channels={CHANNELS}
      people={people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name }))}
      items={rows.map((r) => ({
        id: r.topic.id,
        name: (zh && r.topic.nameLocal) || r.topic.name,
        category: r.topic.category,
        summary: r.topic.summary,
        ownerName: (zh && r.ownerNameLocal) || r.ownerName,
        ownerId: r.topic.ownerId,
        targetChannel: r.topic.targetChannel,
        dueDate: r.topic.dueDate,
        heat: r.topic.heat,
        change: r.topic.change14d,
        adoptedAt: r.topic.updatedAt.toISOString(),
        stage: r.topic.stage,
        flagged: r.topic.flagged,
        flagReason: r.topic.flagReason,
      }))}
      />
    </>
  );
}
