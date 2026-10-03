import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  applications,
  candidates,
  employeeRecords,
  leaveBalances,
  leaveRequests,
  onboardingTasks,
  requisitions,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { checkLeaveBalance, checkLeaveDays } from "@/lib/hr/leave-rules";

/**
 * Human Resources (spec §4.11).
 *
 * Manual, at the client's own direction: leave starts at Hong Kong statutory
 * entitlement with a single approver, both edited on the screen, and
 * candidates are entered by hand.
 *
 * Two rules are structural rather than cosmetic:
 *
 *   — **No external sourcing, ever** (Schedule A3(8)). Nothing here fetches a
 *     profile from anywhere, there is no job-board client to add one to, and a
 *     candidate exists because somebody typed them in.
 *   — **Consent and retention are columns.** A candidate record says when they
 *     consented and when the record is to be destroyed, and `dueForDeletion`
 *     below is the query that makes the retention date mean something.
 *
 * The `hr` module gate is the door and this service is the lock: an employee
 * can always see their own leave, and everything about anybody else needs
 * `canManage`.
 */
/* (QA, 2 Oct: the allowance table listed 定时任务, the AI staff and other
   system accounts.) Leave and the staff list are for people who work here:
   not an AI employee, not the service account, not suspended or deleted. */
function realStaff() {
  return and(
    eq(users.isAgent, false),
    eq(users.status, "active"),
    isNull(users.deletedAt),
    sql`${users.email} not like 'service@%'`,
    sql`${users.email} not like '%.invalid'`,
  );
}

/** A person's name the way the reader reads it: the Chinese name on a Chinese screen. */
function personName(viewer: Viewer) {
  return (viewer.locale ?? "zh-CN").startsWith("zh")
    ? sql<string | null>`coalesce(nullif(${users.nameLocal}, ''), ${users.name})`
    : sql<string | null>`${users.name}`;
}

export function canManage(viewer: Viewer): boolean {
  return viewer.role === "owner" || viewer.role === "admin";
}

/**
 * Hong Kong statutory annual leave: 7 days in the first year, rising by one a
 * year to 14 after nine years. A starting point the screen edits, not a rule
 * this code enforces.
 */
export function statutoryDays(yearsOfService: number): number {
  if (yearsOfService < 1) return 0;
  if (yearsOfService < 3) return 7;
  return Math.min(14, 7 + (yearsOfService - 2));
}

/* ----------------------------------------------------------------- leave */

export type LeaveRow = {
  id: string;
  userId: string;
  personName: string | null;
  kind: string;
  startOn: string;
  endOn: string;
  days: number;
  reason: string | null;
  state: string;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: Date;
};

export async function listLeave(viewer: Viewer): Promise<LeaveRow[]> {
  const rows = await db
    .select({
      r: leaveRequests,
      personName: personName(viewer),
      deciderName: (viewer.locale ?? "zh-CN").startsWith("zh")
        ? sql<string | null>`coalesce(nullif(decider.name_local, ''), decider.name)`
        : sql<string | null>`decider.name`,
    })
    .from(leaveRequests)
    .leftJoin(users, eq(users.id, leaveRequests.userId))
    .leftJoin(sql`${users} as decider`, sql`decider.id = ${leaveRequests.decidedBy}`)
    .where(
      and(
        eq(leaveRequests.tenantId, viewer.tenantId),
        // Everyone sees their own. Only a manager sees everybody's.
        canManage(viewer) ? undefined : eq(leaveRequests.userId, viewer.id),
      ),
    )
    .orderBy(desc(leaveRequests.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.r.id,
    userId: r.r.userId,
    personName: r.personName,
    kind: r.r.kind,
    startOn: r.r.startOn,
    endOn: r.r.endOn,
    days: r.r.days,
    reason: r.r.reason,
    state: r.r.state,
    decidedByName: r.deciderName,
    decisionNote: r.r.decisionNote,
    createdAt: r.r.createdAt,
  }));
}

export type BalanceRow = {
  id: string;
  userId: string;
  personName: string | null;
  year: number;
  kind: string;
  entitlementDays: number;
  carriedDays: number;
  takenDays: number;
};

export async function listBalances(viewer: Viewer, year: number): Promise<BalanceRow[]> {
  const rows = await db
    .select({ b: leaveBalances, personName: personName(viewer) })
    .from(leaveBalances)
    .innerJoin(users, eq(users.id, leaveBalances.userId))
    .where(
      and(
        eq(leaveBalances.tenantId, viewer.tenantId),
        eq(leaveBalances.year, year),
        realStaff(),
        canManage(viewer) ? undefined : eq(leaveBalances.userId, viewer.id),
      ),
    )
    .orderBy(users.name);

  if (!rows.length) return [];

  // Days already approved this year, per person and kind. One group-by, not a
  // query per balance row.
  const taken = await db
    .select({
      userId: leaveRequests.userId,
      kind: leaveRequests.kind,
      days: sql<number>`coalesce(sum(${leaveRequests.days}), 0)::float8`,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.tenantId, viewer.tenantId),
        eq(leaveRequests.state, "approved"),
        sql`substring(${leaveRequests.startOn} from 1 for 4) = ${String(year)}`,
      ),
    )
    .groupBy(leaveRequests.userId, leaveRequests.kind);

  const takenBy = new Map(taken.map((t) => [`${t.userId}:${t.kind}`, Number(t.days)]));

  return rows.map((r) => ({
    id: r.b.id,
    userId: r.b.userId,
    personName: r.personName,
    year: r.b.year,
    kind: r.b.kind,
    entitlementDays: r.b.entitlementDays,
    carriedDays: r.b.carriedDays,
    takenDays: takenBy.get(`${r.b.userId}:${r.b.kind}`) ?? 0,
  }));
}

/** Give everybody a starting balance for the year, at statutory entitlement.
 * Editable afterwards; run again and it adds only what is missing. */
export async function seedBalances(viewer: Viewer, year: number) {
  if (!canManage(viewer)) throw new Error("只有所有者或管理员可以设置假期额度");

  const people = await db
    .select({ id: users.id, startedOn: employeeRecords.startedOn })
    .from(users)
    .leftJoin(employeeRecords, eq(employeeRecords.userId, users.id))
    .where(and(eq(users.tenantId, viewer.tenantId), realStaff()));

  if (!people.length) return 0;

  const rows = people.map((p) => {
    const started = p.startedOn ? Number(p.startedOn.slice(0, 4)) : year;
    return {
      id: newId("lv"),
      tenantId: viewer.tenantId,
      userId: p.id,
      year,
      kind: "annual",
      entitlementDays: statutoryDays(Math.max(0, year - started)),
    };
  });

  await db.insert(leaveBalances).values(rows).onConflictDoNothing();
  await audit(viewer, "hr.balances.seed", { module: "hr", meta: { year, people: rows.length } });
  return rows.length;
}

export async function setEntitlement(viewer: Viewer, balanceId: string, days: number) {
  if (!canManage(viewer)) throw new Error("只有所有者或管理员可以设置假期额度");
  if (!Number.isFinite(days) || days < 0 || days > 365) throw new Error("天数不对");
  await db
    .update(leaveBalances)
    .set({ entitlementDays: days, updatedAt: new Date() })
    .where(and(eq(leaveBalances.id, balanceId), eq(leaveBalances.tenantId, viewer.tenantId)));
  await audit(viewer, "hr.entitlement.set", { module: "hr", objectId: balanceId, meta: { days } });
}

export async function requestLeave(
  viewer: Viewer,
  input: { kind: string; startOn: string; endOn: string; days: number; reason: string | null },
) {
  const bad = checkLeaveDays(input.startOn, input.endOn, input.days);
  if (bad) throw new Error(bad);

  /* Not more than is left. Only where a balance is kept for this kind and
     year: sick and unpaid leave usually have none, and are not capped here. */
  const year = Number(input.startOn.slice(0, 4));
  const [balance] = await db
    .select({ entitlementDays: leaveBalances.entitlementDays, carriedDays: leaveBalances.carriedDays })
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.tenantId, viewer.tenantId),
        eq(leaveBalances.userId, viewer.id),
        eq(leaveBalances.year, year),
        eq(leaveBalances.kind, input.kind),
      ),
    )
    .limit(1);
  if (balance) {
    const used = await db
      .select({
        state: leaveRequests.state,
        days: sql<number>`coalesce(sum(${leaveRequests.days}), 0)::float8`,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, viewer.tenantId),
          eq(leaveRequests.userId, viewer.id),
          eq(leaveRequests.kind, input.kind),
          inArray(leaveRequests.state, ["approved", "requested"]),
          sql`substring(${leaveRequests.startOn} from 1 for 4) = ${String(year)}`,
        ),
      )
      .groupBy(leaveRequests.state);
    const short = checkLeaveBalance({
      kind: input.kind,
      days: input.days,
      entitlementDays: Number(balance.entitlementDays),
      carriedDays: Number(balance.carriedDays),
      approvedDays: Number(used.find((u) => u.state === "approved")?.days ?? 0),
      pendingDays: Number(used.find((u) => u.state === "requested")?.days ?? 0),
    });
    if (short) throw new Error(short);
  }

  const id = newId("lv");
  await db.insert(leaveRequests).values({
    id,
    tenantId: viewer.tenantId,
    userId: viewer.id,
    kind: input.kind,
    startOn: input.startOn,
    endOn: input.endOn,
    days: input.days,
    reason: input.reason?.slice(0, 1000) ?? null,
  });
  await audit(viewer, "hr.leave.request", { module: "hr", objectType: "leave_request", objectId: id });
  return id;
}

/**
 * Approve or refuse. One approver, which is the studio's own starting policy.
 *
 * The state is claimed in the statement that checks it, so two managers
 * deciding at once produce one decision rather than a request that is both
 * approved and rejected.
 */
export async function decideLeave(
  viewer: Viewer,
  requestId: string,
  decision: "approved" | "rejected",
  note: string | null,
) {
  if (!canManage(viewer)) throw new Error("只有所有者或管理员可以审批请假");

  const [req] = await db
    .select({ userId: leaveRequests.userId })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.tenantId, viewer.tenantId)))
    .limit(1);
  if (!req) throw new Error("这条申请不存在");
  if (req.userId === viewer.id) throw new Error("自己的请假需要由别人审批");

  const claimed = await db
    .update(leaveRequests)
    .set({ state: decision, decidedBy: viewer.id, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.state, "requested")))
    .returning({ id: leaveRequests.id });
  if (!claimed.length) throw new Error("这条申请已经处理过了");

  await audit(viewer, `hr.leave.${decision}`, {
    module: "hr",
    objectType: "leave_request",
    objectId: requestId,
  });
}

export async function cancelLeave(viewer: Viewer, requestId: string) {
  const claimed = await db
    .update(leaveRequests)
    .set({ state: "cancelled" })
    .where(
      and(
        eq(leaveRequests.id, requestId),
        eq(leaveRequests.tenantId, viewer.tenantId),
        eq(leaveRequests.userId, viewer.id),
        eq(leaveRequests.state, "requested"),
      ),
    )
    .returning({ id: leaveRequests.id });
  if (!claimed.length) throw new Error("只能撤回自己还在等待审批的申请");
  await audit(viewer, "hr.leave.cancel", { module: "hr", objectId: requestId });
}

/* ---------------------------------------------------------- recruitment */

export type RequisitionRow = {
  id: string;
  title: string;
  department: string | null;
  headcount: number;
  description: string;
  state: string;
  openedByName: string | null;
  openedAt: Date;
  applicationCount: number;
};

export async function listRequisitions(viewer: Viewer): Promise<RequisitionRow[]> {
  const rows = await db
    .select({ r: requisitions, byName: personName(viewer) })
    .from(requisitions)
    .leftJoin(users, eq(users.id, requisitions.openedBy))
    .where(eq(requisitions.tenantId, viewer.tenantId))
    .orderBy(desc(requisitions.openedAt));

  if (!rows.length) return [];

  const counts = await db
    .select({ requisitionId: applications.requisitionId, n: sql<number>`count(*)::int` })
    .from(applications)
    .where(inArray(applications.requisitionId, rows.map((r) => r.r.id)))
    .groupBy(applications.requisitionId);
  const byReq = new Map(counts.map((c) => [c.requisitionId, c.n]));

  return rows.map((r) => ({
    id: r.r.id,
    title: r.r.title,
    department: r.r.department,
    headcount: r.r.headcount,
    description: r.r.description,
    state: r.r.state,
    openedByName: r.byName,
    openedAt: r.r.openedAt,
    applicationCount: byReq.get(r.r.id) ?? 0,
  }));
}

export async function openRequisition(
  viewer: Viewer,
  input: { title: string; department: string | null; headcount: number; description: string },
) {
  if (!canManage(viewer)) throw new Error("只有所有者或管理员可以开放职位");
  const title = input.title.trim();
  if (!title) throw new Error("请填写职位名称");

  const id = newId("rq");
  await db.insert(requisitions).values({
    id,
    tenantId: viewer.tenantId,
    title,
    department: input.department?.trim() || null,
    headcount: Math.max(1, Math.min(50, Math.round(input.headcount || 1))),
    description: input.description.slice(0, 8000),
    openedBy: viewer.id,
  });
  await audit(viewer, "hr.requisition.open", { module: "hr", objectId: id });
  return id;
}

export async function setRequisitionState(viewer: Viewer, requisitionId: string, state: string) {
  if (!canManage(viewer)) throw new Error("你没有权限这样做");
  await db
    .update(requisitions)
    .set({ state, closedAt: state === "closed" || state === "filled" ? new Date() : null })
    .where(and(eq(requisitions.id, requisitionId), eq(requisitions.tenantId, viewer.tenantId)));
  await audit(viewer, "hr.requisition.state", { module: "hr", objectId: requisitionId, meta: { state } });
}

export type CandidateRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  notes: string | null;
  consentAt: Date | null;
  retainUntil: string | null;
  addedByName: string | null;
  createdAt: Date;
  applications: { id: string; requisitionId: string; requisitionTitle: string; stage: string }[];
};

export async function listCandidates(viewer: Viewer): Promise<CandidateRow[]> {
  if (!canManage(viewer)) return [];

  const rows = await db
    .select({ c: candidates, byName: personName(viewer) })
    .from(candidates)
    .leftJoin(users, eq(users.id, candidates.addedBy))
    .where(eq(candidates.tenantId, viewer.tenantId))
    .orderBy(desc(candidates.createdAt))
    .limit(300);

  if (!rows.length) return [];

  const apps = await db
    .select({ a: applications, title: requisitions.title })
    .from(applications)
    .innerJoin(requisitions, eq(requisitions.id, applications.requisitionId))
    .where(inArray(applications.candidateId, rows.map((r) => r.c.id)));

  const byCandidate = new Map<string, CandidateRow["applications"]>();
  for (const a of apps) {
    const list = byCandidate.get(a.a.candidateId) ?? [];
    list.push({ id: a.a.id, requisitionId: a.a.requisitionId, requisitionTitle: a.title, stage: a.a.stage });
    byCandidate.set(a.a.candidateId, list);
  }

  return rows.map((r) => ({
    id: r.c.id,
    name: r.c.name,
    email: r.c.email,
    phone: r.c.phone,
    source: r.c.source,
    notes: r.c.notes,
    consentAt: r.c.consentAt,
    retainUntil: r.c.retainUntil,
    addedByName: r.byName,
    createdAt: r.c.createdAt,
    applications: byCandidate.get(r.c.id) ?? [],
  }));
}

export async function addCandidate(
  viewer: Viewer,
  input: {
    name: string;
    email: string | null;
    phone: string | null;
    source: string;
    notes: string | null;
    consented: boolean;
    retainMonths: number;
    requisitionId: string | null;
  },
) {
  if (!canManage(viewer)) throw new Error("你没有权限这样做");
  const name = input.name.trim();
  if (!name) throw new Error("请填写候选人姓名");

  const retain = new Date();
  retain.setMonth(retain.getMonth() + Math.max(1, Math.min(60, input.retainMonths || 12)));

  const id = newId("cand");
  await db.insert(candidates).values({
    id,
    tenantId: viewer.tenantId,
    name,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    // The studio's own words for where they came from. Never a scrape.
    source: input.source.trim() || "direct",
    notes: input.notes?.slice(0, 4000) || null,
    consentAt: input.consented ? new Date() : null,
    retainUntil: retain.toISOString().slice(0, 10),
    addedBy: viewer.id,
  });

  if (input.requisitionId) {
    await db
      .insert(applications)
      .values({ id: newId("app"), tenantId: viewer.tenantId, candidateId: id, requisitionId: input.requisitionId })
      .onConflictDoNothing();
  }

  await audit(viewer, "hr.candidate.add", { module: "hr", objectType: "candidate", objectId: id });
  return id;
}

export async function setStage(viewer: Viewer, applicationId: string, stage: string) {
  if (!canManage(viewer)) throw new Error("你没有权限这样做");
  await db
    .update(applications)
    .set({ stage: stage as "applied", updatedAt: new Date() })
    .where(and(eq(applications.id, applicationId), eq(applications.tenantId, viewer.tenantId)));
  await audit(viewer, "hr.application.stage", { module: "hr", objectId: applicationId, meta: { stage } });
}

export async function deleteCandidate(viewer: Viewer, candidateId: string) {
  if (!canManage(viewer)) throw new Error("你没有权限这样做");
  await db
    .delete(candidates)
    .where(and(eq(candidates.id, candidateId), eq(candidates.tenantId, viewer.tenantId)));
  await audit(viewer, "hr.candidate.delete", { module: "hr", objectId: candidateId });
}

/** Candidate records past their retention date. The date is only a promise
 * until something asks this question. */
export async function dueForDeletion(viewer: Viewer): Promise<CandidateRow[]> {
  if (!canManage(viewer)) return [];
  const today = new Date().toISOString().slice(0, 10);
  const all = await listCandidates(viewer);
  return all.filter((c) => c.retainUntil !== null && c.retainUntil < today);
}

/* ------------------------------------------------------------- employees */

export type EmployeeRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  department: string | null;
  startedOn: string | null;
  employmentType: string;
  onboarding: { id: string; label: string; done: boolean; dueOn: string | null }[];
};

export async function listEmployees(viewer: Viewer): Promise<EmployeeRow[]> {
  const rows = await db
    .select({ u: users, r: employeeRecords })
    .from(users)
    .leftJoin(employeeRecords, eq(employeeRecords.userId, users.id))
    .where(
      and(
        eq(users.tenantId, viewer.tenantId),
        isNull(users.deletedAt),
        canManage(viewer) ? realStaff() : eq(users.id, viewer.id),
      ),
    )
    .orderBy(users.name);

  const tasks = await db
    .select()
    .from(onboardingTasks)
    .where(
      and(
        eq(onboardingTasks.tenantId, viewer.tenantId),
        canManage(viewer) ? undefined : eq(onboardingTasks.userId, viewer.id),
      ),
    );

  const byUser = new Map<string, EmployeeRow["onboarding"]>();
  for (const t of tasks) {
    const list = byUser.get(t.userId) ?? [];
    list.push({ id: t.id, label: t.label, done: t.done, dueOn: t.dueOn });
    byUser.set(t.userId, list);
  }

  return rows.map((r) => ({
    id: r.r?.id ?? r.u.id,
    userId: r.u.id,
    name: ((viewer.locale ?? "zh-CN").startsWith("zh") && r.u.nameLocal) || r.u.name,
    email: r.u.email,
    jobTitle: r.r?.jobTitle ?? r.u.title,
    department: r.r?.department ?? null,
    startedOn: r.r?.startedOn ?? null,
    employmentType: r.r?.employmentType ?? "full_time",
    onboarding: byUser.get(r.u.id) ?? [],
  }));
}

export async function saveEmployee(
  viewer: Viewer,
  userId: string,
  input: { jobTitle: string | null; department: string | null; startedOn: string | null; employmentType: string },
) {
  if (!canManage(viewer)) throw new Error("你没有权限这样做");

  await db
    .insert(employeeRecords)
    .values({
      id: newId("emp"),
      tenantId: viewer.tenantId,
      userId,
      jobTitle: input.jobTitle,
      department: input.department,
      startedOn: input.startedOn,
      employmentType: input.employmentType,
    })
    .onConflictDoUpdate({
      target: [employeeRecords.tenantId, employeeRecords.userId],
      set: {
        jobTitle: input.jobTitle,
        department: input.department,
        startedOn: input.startedOn,
        employmentType: input.employmentType,
        updatedAt: new Date(),
      },
    });

  await audit(viewer, "hr.employee.save", { module: "hr", objectType: "user", objectId: userId });
}

export async function addOnboardingTask(viewer: Viewer, userId: string, label: string, dueOn: string | null) {
  if (!canManage(viewer)) throw new Error("你没有权限这样做");
  const id = newId("emp");
  await db.insert(onboardingTasks).values({
    id,
    tenantId: viewer.tenantId,
    userId,
    label: label.slice(0, 200),
    dueOn,
  });
  await audit(viewer, "hr.onboarding.add", { module: "hr", objectId: id });
  return id;
}

export async function setTaskDone(viewer: Viewer, taskId: string, done: boolean) {
  // Anybody may tick their own; a manager may tick anybody's.
  await db
    .update(onboardingTasks)
    .set({ done })
    .where(
      and(
        eq(onboardingTasks.id, taskId),
        eq(onboardingTasks.tenantId, viewer.tenantId),
        canManage(viewer) ? undefined : eq(onboardingTasks.userId, viewer.id),
      ),
    );
  await audit(viewer, "hr.onboarding.tick", { module: "hr", objectId: taskId, meta: { done } });
}
