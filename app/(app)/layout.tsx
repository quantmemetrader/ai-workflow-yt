import { after } from "next/server";
import { requireViewer } from "@/lib/auth/dal";
import { readSessionToken, touchSession } from "@/lib/auth/session";
import { Rail } from "@/components/canvas/Rail";

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
    after(async () => {
      const token = await readSessionToken();
      if (token) await touchSession(token, viewer.id);
    });
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
    </div>
  );
}
