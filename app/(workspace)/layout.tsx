import Link from "next/link";

const NAV = [
  { href: "/chat", label: "Chat", spec: "§4.2" },
  { href: "/files", label: "Files", spec: "§3" },
  { href: "/research", label: "Research", spec: "§4.3" },
  { href: "/script", label: "Script", spec: "§4.4" },
  { href: "/video", label: "Video", spec: "§4.5" },
  { href: "/publish", label: "Publish", spec: "§4.6" },
  { href: "/accounting", label: "Accounting", spec: "§4.7" },
  { href: "/finance", label: "Finance", spec: "§4.8" },
  { href: "/legal", label: "Legal", spec: "§4.9" },
  { href: "/hr", label: "HR", spec: "§4.10" },
  { href: "/admin", label: "Admin", spec: "§4.11", gated: true },
];

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white p-4">
        <p className="px-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Modules
        </p>
        <nav className="mt-2 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span>{item.label}</span>
              {item.gated && (
                <span className="text-[10px] text-neutral-400">gated</span>
              )}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3 text-sm text-neutral-500">
          <span>Global search — not wired up</span>
          <div className="flex items-center gap-4">
            <span>Notifications</span>
            <span>Usage: —</span>
          </div>
        </header>
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
