/**
 * Who a person *is*, for permission purposes: themselves, their teams, and —
 * only if they are staff — the tenant.
 *
 * The tenant subject is what a folder shared "with the studio" grants to. A
 * guest is inside the tenant but is not the studio: they reach named folders
 * and nothing else (brief: "a guest with time-boxed access to named folders
 * only"). Leaving them out of the tenant subject is what makes that true, and
 * it is why this lives in one function that every caller uses — a second
 * implementation that forgot the rule would quietly hand a freelancer the
 * whole studio.
 */
export function subjectsFor(user: { id: string; tenantId: string; role: string }, teamIds: string[]): string[] {
  const subjects = [`user:${user.id}`, ...teamIds.map((id) => `team:${id}`)];
  if (user.role !== "guest") subjects.push(`tenant:${user.tenantId}`);
  // Shared "with all members" (or guests): the account role, per studio.
  subjects.push(`role:${user.tenantId}:${user.role}`);
  return subjects;
}
