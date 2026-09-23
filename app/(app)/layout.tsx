import { after } from "next/server";
import { requireViewer } from "@/lib/auth/dal";
import { readSessionToken, touchSession } from "@/lib/auth/session";
import { Rail } from "@/components/canvas/Rail";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { BackgroundWork } from "@/components/shell/BackgroundWork";
import { RenderWatch } from "@/components/shell/RenderWatch";
import { Toaster } from "@/components/shell/Toaster";
import { BusyBar } from "@/components/shell/BusyBar";

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
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

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
      className="scr"
      style={{
        width: "100%",
        height: "100dvh",
        display: "flex",
        background: "#ffffff",
        color: "#171717",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 420,
        letterSpacing: "0.02em",
      }}
    >
      <Rail
        modules={viewer.modules}
        locale={viewer.locale ?? "zh-CN"}
        avatarUrl={viewer.avatarUrl}
        name={zh && viewer.nameLocal ? viewer.nameLocal : viewer.name}
      />
      {children}

      {/* Above the page, not inside it: ⌘K has to work on every module, and
        * the palette has to survive the navigation it causes. */}
      <CommandPalette modules={viewer.modules} locale={viewer.locale ?? "zh-CN"} />

      {/* Work that outlives the page that started it. */}
      <BackgroundWork locale={viewer.locale ?? "zh-CN"} />
      <RenderWatch locale={viewer.locale ?? "zh-CN"} />

      {/* Where a failure goes, now that nothing calls window.alert. */}
      <Toaster />

      {/* And where "something is happening" goes. */}
      <BusyBar />
    </div>
  );
}
