import { requireModule } from "@/lib/auth/dal";
import {
  auditActions,
  isAdmin,
  keyInventory,
  listAudit,
  listBudgets,
  listConnections,
  listKnowledge,
  listPeople,
  usage,
} from "@/lib/admin/service";
import { listInvites } from "@/lib/invites/service";
import { listTeams } from "@/lib/teams/service";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { answeringModel } from "@/lib/ai/models";

export const metadata = { title: "后台 · Admin" };

/**
 * Admin (spec §4.8, §8).
 *
 * The module entitlement is the door; the role is the lock. Holding `admin`
 * without being an owner or an administrator shows the module's description
 * rather than the studio's audit log, and every service function re-checks the
 * role anyway.
 */
export default async function AdminPage() {
  const viewer = await requireModule("admin");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  /*
   * The module is the door; the role is the lock. Somebody holding `admin`
   * without being an owner or an administrator is told exactly that, rather
   * than being shown the studio's audit log or an empty screen that looks
   * broken. Every service function refuses them again regardless.
   */
  if (!isAdmin(viewer)) {
    return (
      <div style={{ flexGrow: 1, minWidth: 0, padding: "34px 26px", maxWidth: 520 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          {zh ? "需要管理员权限" : "This needs administrator rights"}
        </h1>
        <p style={{ fontSize: 13, color: "#7c7c7c", lineHeight: 1.65, margin: "10px 0 0" }}>
          {zh
            ? "你可以打开这个模块，但里面的内容只对所有者和管理员开放。如果你确实需要，请让所有者调整你的角色。"
            : "You can open this module, but what is inside is for the owner and administrators. Ask the owner to change your role if you need it."}
        </p>
      </div>
    );
  }

  const [people, tokens, budgets, connections, audit, actions, knowledge, teams, invites] =
    await Promise.all([
      listPeople(viewer),
      usage(viewer, 30),
      listBudgets(viewer),
      listConnections(viewer),
      listAudit(viewer, { limit: 500 }),
      auditActions(viewer),
      listKnowledge(viewer),
      listTeams(viewer),
      listInvites(viewer),
    ]);

  return (
    <AdminScreen
      model={answeringModel()}
      people={people}
      teams={teams}
      /* Somebody invited is not in `users` until they accept, so without this
         the roster looks unchanged straight after adding them. Only the ones
         still outstanding, and never the token — that is hashed and was shown
         once, to the person who made it. */
      invites={invites
        .filter((i) => !i.acceptedAt)
        .map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt.toISOString(),
        }))}
      usage={tokens}
      budgets={budgets}
      keys={keyInventory()}
      connections={connections}
      audit={audit}
      auditActions={actions}
      knowledge={knowledge}
      viewerId={viewer.id}
      viewerRole={viewer.role}
      locale={viewer.locale ?? "zh-CN"}
    />
  );
}
