import * as React from "react";
import { ResearchTabs } from "@/components/research/ResearchTabs";

/**
 * A 选题 page: the tabs across the top (`ResearchTabs`), the page under
 * them filling the rest. The pages that used to draw the module's left
 * column are wrapped in this instead.
 */
export function ResearchShell({ zh, savedCount, children }: { zh: boolean; savedCount?: number; children: React.ReactNode }) {
  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#f6f5f2" }}>
      <ResearchTabs zh={zh} savedCount={savedCount} />
      <div style={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: "flex" }}>{children}</div>
    </div>
  );
}
