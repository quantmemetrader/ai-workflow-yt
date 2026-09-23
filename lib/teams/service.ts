import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgets, teamMembers, teams, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";

/**
 * Teams.
 *
 * `teams` and `team_members` have been in the schema since the first
 * migration with nothing writing to them, so the People screen's Team column
 * read "—" for everybody and its team filter had one option. This is the
 * writer.
 *
 * Membership is the many-to-many table, never `users.team_id`. That column is
 * the legacy single-team field the design outgrew — the People screen shows a
 * list per person, and half a studio is on two teams (a shoot crew and a
 * language desk). Writing both would leave two answers to the same question
 * and no rule for which wins.
 *
 * Same lock as the rest of Admin: owner or administrator, re-checked here
 * rather than trusted from the screen, and every write leaves an audit line.
 */
function assertAdmin(viewer: Viewer) {
  if (viewer.role !== "owner" && viewer.role !== "admin") {
    throw new Error("Only an owner or an administrator can do that");
  }
}

export type TeamRow = {
  id: string;
  name: string;
  nameLocal: string | null;
  /** Who is on it. Ids rather than names: the screen already has the people. */
  memberIds: string[];
};

export async function listTeams(viewer: Viewer): Promise<TeamRow[]> {
  assertAdmin(viewer);

  // Two queries and a join in memory rather than a query per team: a studio
  // has a handful of teams and this runs on every Admin page load.
  const [rows, members] = await Promise.all([
    db.select().from(teams).where(eq(teams.tenantId, viewer.tenantId)).orderBy(asc(teams.name)),
    db
      .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teams.tenantId, viewer.tenantId)),
  ]);

  const byTeam = new Map<string, string[]>();
  for (const m of members) {
    const list = byTeam.get(m.teamId) ?? [];
    list.push(m.userId);
    byTeam.set(m.teamId, list);
  }

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    nameLocal: t.nameLocal,
    memberIds: byTeam.get(t.id) ?? [],
  }));
}

export async function createTeam(
  viewer: Viewer,
  input: { name: string; nameLocal?: string | null },
): Promise<string> {
  assertAdmin(viewer);

  const name = input.name.trim();
  const nameLocal = input.nameLocal?.trim() || null;
  if (!name) throw new Error("A team needs a name");
  if (name.length > 80 || (nameLocal?.length ?? 0) > 80) {
    throw new Error("That is longer than a team name needs to be");
  }

  /*
   * The People screen filters by team *name*, so two teams called the same
   * thing would answer as one filter and neither could be told from the
   * other. There is no unique index to lean on — adding one would be a
   * migration — so the rule lives here.
   */
  const [clash] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.tenantId, viewer.tenantId), sql`lower(${teams.name}) = lower(${name})`))
    .limit(1);
  if (clash) throw new Error("There is already a team with that name");

  const id = newId("team");
  await db.insert(teams).values({ id, tenantId: viewer.tenantId, name, nameLocal });

  await audit(viewer, "admin.team.create", {
    objectType: "team",
    objectId: id,
    module: "admin",
    meta: { name, nameLocal },
  });
  return id;
}

/**
 * Put one person on a team, or take them off.
 *
 * One membership at a time, for the reason `setEntitlement` grants one module
 * at a time: that is how somebody uses it, and a whole-team save would
 * silently undo a change a colleague made while the screen was open.
 */
export async function setTeamMember(
  viewer: Viewer,
  teamId: string,
  userId: string,
  member: boolean,
): Promise<void> {
  assertAdmin(viewer);

  // Both ends are re-read inside the viewer's tenant. That is the whole point
  // of the lookup: it is what stops an id typed into a request from putting
  // somebody else's staff on this studio's team.
  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.tenantId, viewer.tenantId)))
    .limit(1);
  if (!team) throw new Error("There is no such team");

  const [person] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.tenantId, viewer.tenantId),
        isNull(users.deletedAt),
        eq(users.isAgent, false),
      ),
    )
    .limit(1);
  if (!person) throw new Error("Nobody here has that id");

  if (member) {
    // `team_members_pk` is unique on (teamId, userId), so a double click adds
    // nothing rather than failing in front of the person who clicked.
    await db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing();
  } else {
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  }

  await audit(viewer, member ? "admin.team.member.add" : "admin.team.member.remove", {
    objectType: "team",
    objectId: teamId,
    module: "admin",
    meta: { team: team.name, userId },
  });
}

/**
 * Dissolve a team.
 *
 * Nobody loses an account, a file or an entitlement — `team_members` cascades
 * off the foreign key and the grouping is all that goes. A spending cap is
 * different: `budgets` holds the team id as free text with nothing to cascade
 * from, so a cap would outlive its team and show a raw id in the Budgets tab.
 * Refusing is better than leaving that behind.
 */
export async function deleteTeam(viewer: Viewer, teamId: string): Promise<void> {
  assertAdmin(viewer);

  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.tenantId, viewer.tenantId)))
    .limit(1);
  if (!team) throw new Error("There is no such team");

  const [cap] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(eq(budgets.tenantId, viewer.tenantId), eq(budgets.scope, "team"), eq(budgets.scopeId, teamId)),
    )
    .limit(1);
  if (cap) throw new Error("This team has a spending cap. Remove the cap first.");

  await db.delete(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, viewer.tenantId)));

  await audit(viewer, "admin.team.delete", {
    objectType: "team",
    objectId: teamId,
    module: "admin",
    meta: { name: team.name },
  });
}
