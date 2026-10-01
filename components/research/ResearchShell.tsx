import * as React from "react";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { topics } from "@/lib/db/schema";
import { ResearchTabs } from "@/components/research/ResearchTabs";

/**
 * A 选题 page: the tabs across the top (`ResearchTabs`), the page under
 * them filling the rest. The pages that used to draw the module's left
 * column are wrapped in this instead.
 *
 * (QA, 2 Oct) 我的储备 lost its count on 热点榜, 搜索与对比 and the inbox,
 * which never passed one. A page that names its studio (`tenantId`) and no
 * count gets it read here, the same count 推荐 reads.
 */
export async function ResearchShell({ zh, savedCount, tenantId, children }: { zh: boolean; savedCount?: number; tenantId?: string; children: React.ReactNode }) {
  let count = savedCount;
  if (count === undefined && tenantId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(topics)
      .where(and(eq(topics.tenantId, tenantId), inArray(topics.status, ["adopted", "saved"])))
      .catch(() => [{ n: 0 }]);
    count = row?.n ?? 0;
  }
  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#f6f5f2" }}>
      <ResearchTabs zh={zh} savedCount={count} />
      <div style={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: "flex" }}>{children}</div>
    </div>
  );
}
