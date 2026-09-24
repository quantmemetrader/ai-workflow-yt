import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { inviteByToken } from "@/lib/invites/service";
import { AcceptForm } from "./accept-form";

export const metadata = { title: "加入工作台" };

/**
 * Accepting an invitation.
 *
 * Read without a session, because the person opening it does not have one yet.
 * The token is not shown back in any error: an invitation that has expired and
 * one that never existed give the same page, so the link cannot be used to
 * find out which addresses have been invited.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  if (await getViewer()) redirect("/chat");

  const { token } = await params;
  const invite = await inviteByToken(token);

  if (!invite) {
    return (
      <Shell>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>This invitation is no longer open</h1>
        <p style={{ fontSize: 13.5, color: "#7c7c7c", lineHeight: 1.65, margin: "10px 0 0" }}>
          It has been used already, or it has expired. Ask whoever sent it for a fresh link.
        </p>
        <a href="/login" style={{ fontSize: 13, color: "#007be0", display: "inline-block", marginTop: 18 }}>
          Go to sign in
        </a>
      </Shell>
    );
  }

  const [studio] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, invite.tenantId))
    .limit(1);

  return (
    <Shell>
      <h1 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>
        Join {studio?.name ?? "the studio"}
      </h1>
      <p style={{ fontSize: 13.5, color: "#7c7c7c", lineHeight: 1.65, margin: "10px 0 0" }}>
        You were invited as <b style={{ color: "#383838", fontWeight: 500 }}>{invite.email}</b>. Choose a
        password and the account is yours.
      </p>

      <div style={{ margin: "16px 0 0", display: "flex", flexWrap: "wrap", gap: 5 }}>
        {invite.modules.map((m) => (
          <span
            key={m}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 21,
              padding: "0 8px",
              borderRadius: 11,
              background: "#f3f3f3",
              color: "#525252",
              fontSize: 11,
            }}
          >
            {m}
          </span>
        ))}
      </div>

      <AcceptForm token={token} suggestedName={invite.name ?? ""} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 22,
        background: "#f8f8f8",
        fontFamily: "Inter, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif",
        fontWeight: 420,
        letterSpacing: "0.02em",
        color: "#171717",
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          padding: "28px 26px 26px",
          background: "#fff",
          border: "1px solid #ededed",
          borderRadius: 14,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
