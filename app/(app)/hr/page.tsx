import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import {
  canManage,
  dueForDeletion,
  listBalances,
  listCandidates,
  listEmployees,
  listLeave,
  listRequisitions,
} from "@/lib/hr/service";
import { HrScreen } from "@/components/hr/HrScreen";

export const metadata = { title: "人事 · HR" };

/**
 * Human Resources (spec §4.11).
 *
 * The `hr` module is the door; the role is the lock. Somebody who holds the
 * module sees their own leave and their own record; everything about anybody
 * else needs `canManage`, and the service enforces that again on every read.
 */
export default async function HrPage() {
  const viewer = await requireModule("hr");
  const year = new Date().getUTCFullYear();

  const [leave, balances, requisitions, candidates, overdue, employees] = await Promise.all([
    listLeave(viewer),
    listBalances(viewer, year),
    listRequisitions(viewer),
    listCandidates(viewer),
    dueForDeletion(viewer),
    listEmployees(viewer),
  ]);

  return (
    <HrScreen
      year={year}
      leave={leave}
      balances={balances}
      requisitions={requisitions}
      candidates={candidates}
      overdue={overdue}
      employees={employees}
      canManage={canManage(viewer)}
      viewerId={viewer.id}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
    />
  );
}
