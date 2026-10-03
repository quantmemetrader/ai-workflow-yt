import { after } from "next/server";
import { requireViewer } from "@/lib/auth/dal";
import { AgentNamesSync } from "@/components/shell/AgentNamesSync";
import { agentNamesNow } from "@/lib/agents/names-store";
import { readSessionToken, touchSession } from "@/lib/auth/session";
import { Rail } from "@/components/canvas/Rail";
import { TopBar } from "@/components/shell/TopBar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { BackgroundWork } from "@/components/shell/BackgroundWork";
import { RenderWatch } from "@/components/shell/RenderWatch";
import { LiveProjects } from "@/components/shell/LiveProjects";
import { Toaster } from "@/components/shell/Toaster";
import { UploadTray } from "@/components/shell/UploadTray";
import { BusyBar } from "@/components/shell/BusyBar";
import { Warmup } from "@/components/shell/Warmup";

/**
 * The shell every module sits in — the artboards' outer frame, with one
 * deliberate difference: the canvas draws a fixed 1440x900 window and the
 * product fills the viewport.
 *
 * Authentication is resolved here *and* again inside every action and route
 * handler. A layout is a convenience, never a security boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  /* What the studio calls its AI employees, for every client component (`lib/agents/names.ts`). */
  const agentNames = await agentNamesNow();

  // "Last active" drives the presence dots and the Admin list. It is worth a
  // write at most once an hour, and never one the reader waits for — `after`
  // runs it once the response has been sent.
  if (viewer.staleSeen) {
    /*
     * The cookie is read *here*, not in the callback.
     *
     * Next 16 refuses `cookies()` inside `after()` — the request is gone by
     * then — and it was throwing on every single page load: "Route /chat used
     * `cookies()` inside `after()` while rendering". The write still happens
     * after the response, which was the point; only the read moved.
     */
    const token = await readSessionToken();
    if (token) after(() => touchSession(token, viewer.id));
  }

  return (
    <div
      data-agent-names=""
      className="scr"
      style={{
        width: "100%",
        height: "100dvh",
        display: "flex",
        background: "#ffffff",
        color: "#171717",
        overflow: "hidden",
        fontFamily: "Inter, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif",
        fontWeight: 420,
        letterSpacing: "0.02em",
      }}
    >
      <script dangerouslySetInnerHTML={{ __html: `window.__agentNames=${JSON.stringify(agentNames).replace(/</g, "\\u003c")};` }} />
      <AgentNamesSync names={agentNames} />
      <a href="#main" className="skip-link">{(viewer.locale ?? "zh-CN").startsWith("zh") ? "跳到主要内容" : "Skip to main content"}</a>
      <Rail
        modules={viewer.modules}
        locale={viewer.locale ?? "zh-CN"}
        account={{ id: viewer.id, name: viewer.name, nameLocal: viewer.nameLocal, role: viewer.role, avatarUrl: viewer.avatarUrl }}
        isAdmin={viewer.role === "owner" || viewer.role === "admin"}
      />

      {/*
        * Everything right of the rail is a column now, not the page itself.
        *
        * The rail stays full height — it is the artboards' 52px edge and the
        * brand sits at the top of it — and the top bar spans only the working
        * area, the way the reference the studio picked does it. `minWidth: 0`
        * and `minHeight: 0` because every module screen inside is a flex child
        * that expects to be allowed to shrink; without them a wide table
        * pushes the whole shell sideways.
        */}
      <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar
          userId={viewer.id}
          name={viewer.name}
          nameLocal={viewer.nameLocal}
          title={viewer.title}
          role={viewer.role}
          avatarUrl={viewer.avatarUrl}
          locale={viewer.locale ?? "zh-CN"}
        />
        <main id="main" style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>{children}</main>
      </div>

      {/* Above the page, not inside it: ⌘K has to work on every module, and
        * the palette has to survive the navigation it causes. */}
      <CommandPalette modules={viewer.modules} locale={viewer.locale ?? "zh-CN"} />

      {/* Work that outlives the page that started it. */}
      <BackgroundWork locale={viewer.locale ?? "zh-CN"} />
      {/* The films being made, polled once for every live surface (Home's
        * cards, the sidebar, the channel's status row, the corner chip). */}
      <LiveProjects />
      <RenderWatch locale={viewer.locale ?? "zh-CN"} />
      {/* Uploads keep going while you move between pages; this is where they show. */}
      <UploadTray locale={viewer.locale ?? "zh-CN"} />

      {/* Where a failure goes, now that nothing calls window.alert. */}
      <Toaster locale={viewer.locale ?? "zh-CN"} />

      {/* And where "something is happening" goes. */}
      <BusyBar />

      {/* Every page's scripts, fetched while you read this one. */}
      <Warmup />
    </div>
  );
}
