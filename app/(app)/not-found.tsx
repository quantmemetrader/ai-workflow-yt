import Link from "next/link";

/** Any address that leads nowhere: said in Chinese, with a way back (QA, 2 Oct: it was Next's English 404). */
export default function NotFound() {
  return (
    <div style={{ minHeight: "60vh", flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "inherit" }}>
      <div style={{ maxWidth: 420, textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 40, fontWeight: 700, color: "#d4d4d0", letterSpacing: "0.02em" }}>404</div>
        <div style={{ fontSize: 18, fontWeight: 650, color: "#171717" }}>这个页面找不到了</div>
        <div style={{ fontSize: 13.5, color: "#6b6b6b", lineHeight: 1.7 }}>它可能已经被删除、移走，或者你没有权限打开。如果是同事发给你的链接，可以请对方重新分享一次。</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Link href="/home" style={{ height: 36, padding: "0 16px", borderRadius: 9, background: "#171717", color: "#fff", fontSize: 13.5, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            回首页
          </Link>
          <Link href="/projects" style={{ height: 36, padding: "0 16px", borderRadius: 9, border: "1px solid #dcdbd6", color: "#262626", fontSize: 13.5, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            看全部项目
          </Link>
        </div>
      </div>
    </div>
  );
}
