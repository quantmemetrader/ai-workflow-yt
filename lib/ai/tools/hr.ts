import "server-only";
import type { ToolDef } from "@/lib/ai/openrouter";
import {
  addCandidate,
  canManage,
  decideLeave,
  listBalances,
  listCandidates,
  listLeave,
  listRequisitions,
  requestLeave,
  setStage,
} from "@/lib/hr/service";
import { calendarDays, leaveKindZh } from "@/lib/hr/leave-rules";
import { dayOf, hkTodayNow, officePerson } from "./office";
import { id, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * HR, by conversation.
 *
 * "我下周三周四请两天年假" and "小林那条请假批了吧" are the two things people
 * ask the HR screen most, and recruiting is the third: who is in the pipeline,
 * add the person I just met, move them to interview.
 *
 * There is no AI employee for HR. This pack serves the person's own
 * assistant, and every tool runs *as that person* through `lib/hr/service.ts`,
 * so its rules are the screen's: everyone sees and requests their own leave;
 * deciding anybody's leave and everything about candidates needs `canManage`
 * (owner or admin); nobody decides their own leave.
 *
 * No external sourcing, ever (Schedule A3(8)): `add_candidate` records a
 * person somebody met or who applied, in the words the person typed. Nothing
 * here looks a candidate up anywhere.
 */
const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"] as const;
const KINDS = ["annual", "sick", "unpaid", "other"] as const;

const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_leave",
      description:
        "Leave requests: the person's own, or everybody's when they manage the studio (owner or admin). Each with id, who, kind (annual, sick, unpaid, other), dates, days, reason, state (requested, approved, rejected, cancelled) and who decided it. With balances set, also the leave balances for a year: entitlement, carried over, taken.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["requested", "approved", "rejected", "cancelled"], description: "Optional." },
          mine: { type: "boolean", description: "Only the person's own, even for a manager. Default false." },
          balances: { type: "boolean", description: "Also list leave balances. Default false." },
          year: { type: "number", description: "The year for balances. Default this year." },
          limit: { type: "number", description: "Default 20." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_leave",
      description:
        "Request leave for the person you are working for (always themselves, never somebody else), to be decided by a manager. Only when the person explicitly asked in this turn to request it. Days are whole or half days and cannot exceed the calendar days in the range; a kind with a balance cannot go over what is left.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...KINDS], description: "Default annual." },
          start_on: { type: "string", description: "YYYY-MM-DD, first day." },
          end_on: { type: "string", description: "YYYY-MM-DD, last day (same as start_on for one day)." },
          days: { type: "number", description: "Working days taken, e.g. 2 or 1.5. Optional; defaults to the calendar days in the range — ask if weekends or holidays fall inside." },
          reason: { type: "string", description: "Optional." },
        },
        required: ["start_on", "end_on"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "decide_leave",
      description:
        "Approve or reject somebody's leave request, as the person you are working for, who must manage the studio (owner or admin) and cannot decide their own. Only when that person explicitly asked in this turn to approve or reject this request. Use an id from list_leave.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The leave request id, lv_…" },
          decision: { type: "string", enum: ["approved", "rejected"] },
          note: { type: "string", description: "Optional." },
        },
        required: ["id", "decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_candidates",
      description:
        "The recruiting pipeline, for a person who manages the studio: candidates newest first with id, contact, source, consent and retention date, and each application (application id, role, stage); and the open roles (requisitions) with their ids.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words from a name or a role. Optional." },
          stage: { type: "string", enum: [...STAGES], description: "Only candidates with an application at this stage. Optional." },
          limit: { type: "number", description: "Default 20." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_candidate",
      description:
        "Add a candidate the person met or who applied, as the person you are working for (who must manage the studio), optionally to an open role. Only with details the person gave you in this conversation; never look anybody up or fill in details yourself. Consent is whether the candidate agreed to their details being kept; set consented only if the person said so. Only when the person explicitly asked in this turn to add them.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string", description: "Optional." },
          phone: { type: "string", description: "Optional." },
          source: { type: "string", description: "Where they came from, in the person's words: referral, applied, event… Default direct." },
          notes: { type: "string", description: "Optional." },
          consented: { type: "boolean", description: "The candidate agreed to their details being kept. Default false." },
          retain_months: { type: "number", description: "How long to keep the record, 1 to 60 months. Default 12." },
          role: { type: "string", description: "The open role to apply them to, by requisition id or title. Optional." },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_candidate_stage",
      description:
        "Move a candidate's application to a stage (applied, screening, interview, offer, hired, rejected, withdrawn), as the person you are working for (who must manage the studio). Only when the person explicitly asked in this turn. Give the application id from list_candidates, or the candidate id when they have exactly one application.",
      parameters: {
        type: "object",
        properties: {
          application_id: { type: "string", description: "app_… from list_candidates. Optional if candidate_id has one application." },
          candidate_id: { type: "string", description: "cand_…. Optional." },
          stage: { type: "string", enum: [...STAGES] },
        },
        required: ["stage"],
      },
    },
  },
];

const STATE: Record<string, string> = {
  requested: "waiting for a decision",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
};

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const WRITES = new Set(["request_leave", "decide_leave", "add_candidate", "set_candidate_stage"]);

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const gate = officePerson(ctx, "hr");
  if ("refuse" in gate) return { text: gate.refuse };
  const person = gate.person;
  const who = person.nameLocal || person.name;
  if (ctx.readOnly && WRITES.has(name)) return { text: `${name} changes HR records, and this turn only looks things up.` };

  if (name === "list_leave") {
    const state = str(args.state, 20);
    const rows = (await listLeave(person)).filter(
      (r) => (!state || r.state === state) && (args.mine !== true || r.userId === person.id),
    );
    const lines = rows
      .slice(0, Math.min(100, Math.max(1, num(args.limit, 20))))
      .map(
        (r) =>
          `- ${r.personName ?? "somebody"}${r.userId === person.id ? " (you)" : ""}: ${leaveKindZh(r.kind)} (${r.kind}) ${r.startOn}${r.endOn !== r.startOn ? ` to ${r.endOn}` : ""}, ${fmtDays(r.days)} day(s) · ${STATE[r.state] ?? r.state}` +
          (r.decidedByName ? ` by ${r.decidedByName}` : "") +
          (r.decisionNote ? ` ("${r.decisionNote}")` : "") +
          (r.reason ? ` · reason: ${r.reason}` : "") +
          ` (id: ${r.id})`,
      );
    const parts = [
      lines.length
        ? `${canManage(person) && args.mine !== true ? "Leave requests in the studio" : "Your leave requests"}:\n${lines.join("\n")}`
        : state
          ? `No leave request is ${STATE[state] ?? state}.`
          : "There are no leave requests.",
    ];
    if (args.balances === true) {
      const year = Math.round(num(args.year, Number(hkTodayNow().slice(0, 4))));
      const balances = (await listBalances(person, year)).filter((b) => args.mine !== true || b.userId === person.id);
      parts.push(
        balances.length
          ? `Leave balances, ${year}:\n` +
              balances
                .map((b) => {
                  const left = b.entitlementDays + b.carriedDays - b.takenDays;
                  return `- ${b.personName ?? "somebody"}: ${leaveKindZh(b.kind)} ${fmtDays(b.entitlementDays)} + ${fmtDays(b.carriedDays)} carried, ${fmtDays(b.takenDays)} taken, ${fmtDays(left)} left`;
                })
                .join("\n")
          : `No leave balances are set for ${year}. A manager sets them on the HR screen.`,
      );
    }
    if (!canManage(person)) parts.push("(Only your own leave is shown: everybody's is for the studio's owner and admins.)");
    return { text: parts.join("\n\n") };
  }

  if (name === "request_leave") {
    const kind = (KINDS as readonly string[]).includes(str(args.kind, 20)) ? str(args.kind, 20) : args.kind === undefined || args.kind === "" ? "annual" : null;
    if (!kind) return { text: "The kind of leave is annual, sick, unpaid or other." };
    const startOn = dayOf(args.start_on);
    const endOn = dayOf(args.end_on);
    if (!startOn || !endOn) return { text: "Both dates are needed, written YYYY-MM-DD." };
    const span = calendarDays(startOn, endOn);
    const days = args.days === undefined || args.days === "" ? span ?? 0 : num(args.days, NaN);
    /* requestLeave checks the days against the range and the balance and
       says why in Chinese; its message is passed on as it is. */
    const leaveId = await requestLeave(person, { kind, startOn, endOn, days, reason: str(args.reason, 1000) || null });
    return {
      artifacts: [{ kind: "leave_request", id: leaveId, title: `${leaveKindZh(kind)} ${startOn}`, action: "created" }],
      changed: true,
      text: `Requested for ${who}: ${leaveKindZh(kind)} (${kind}) ${startOn}${endOn !== startOn ? ` to ${endOn}` : ""}, ${fmtDays(days)} day(s) (id: ${leaveId}). It waits for a manager's decision; nothing is approved yet.`,
    };
  }

  if (name === "decide_leave") {
    if (!canManage(person)) return { text: `${who} is not an owner or admin of the studio, so they cannot decide leave. Nothing was changed.` };
    const leaveId = id(args.id);
    const decision = args.decision === "approved" || args.decision === "rejected" ? args.decision : null;
    if (!decision) return { text: "The decision is approved or rejected." };
    const row = leaveId ? (await listLeave(person)).find((r) => r.id === leaveId) : undefined;
    if (!row) return { text: "No such leave request. Use an id from list_leave." };
    if (row.userId === person.id) return { text: "That is the person's own request, and nobody decides their own leave. Another manager has to." };
    if (row.state !== "requested") return { text: `That request is already ${STATE[row.state] ?? row.state}; nothing was changed.` };
    const note = str(args.note, 1000) || null;
    await decideLeave(person, row.id, decision, note);
    return {
      artifacts: [{ kind: "leave_request", id: row.id, title: `${row.personName ?? ""} ${leaveKindZh(row.kind)} ${row.startOn}`.trim(), action: "updated" }],
      changed: true,
      text: `${decision === "approved" ? "Approved" : "Rejected"} as ${who}: ${row.personName ?? "somebody"}'s ${leaveKindZh(row.kind)} ${row.startOn}${row.endOn !== row.startOn ? ` to ${row.endOn}` : ""}, ${fmtDays(row.days)} day(s) (id: ${row.id}).${note ? ` Note: ${note}` : ""}`,
    };
  }

  /* Everything below is recruiting, which is the managers'. */
  if (!canManage(person)) {
    return { text: `Candidates and hiring are for the studio's owner and admins, and ${who} is neither. Nothing was read or changed.` };
  }

  if (name === "list_candidates") {
    const query = str(args.query, 100).toLowerCase();
    const stage = str(args.stage, 20);
    const [candidates, roles] = await Promise.all([listCandidates(person), listRequisitions(person)]);
    const rows = candidates.filter(
      (c) =>
        (!query || c.name.toLowerCase().includes(query) || c.applications.some((a) => a.requisitionTitle.toLowerCase().includes(query))) &&
        (!stage || c.applications.some((a) => a.stage === stage)),
    );
    const today = hkTodayNow();
    const lines = rows.slice(0, Math.min(100, Math.max(1, num(args.limit, 20)))).map(
      (c) =>
        `- ${c.name} (id: ${c.id})` +
        (c.email ? ` · ${c.email}` : "") +
        (c.phone ? ` · ${c.phone}` : "") +
        ` · source: ${c.source}` +
        ` · ${c.consentAt ? "consented" : "no consent recorded"}` +
        (c.retainUntil ? ` · keep until ${c.retainUntil}${c.retainUntil < today ? " (past due for deletion)" : ""}` : "") +
        (c.applications.length
          ? `\n  ${c.applications.map((a) => `${a.requisitionTitle}: ${a.stage} (application id: ${a.id})`).join("; ")}`
          : "\n  No application to a role.") +
        (c.notes ? `\n  Notes: ${c.notes.replace(/\s+/g, " ").slice(0, 300)}` : ""),
    );
    const open = roles.filter((r) => r.state === "open" || r.state === "on_hold");
    return {
      text: [
        lines.length ? `Candidates:\n${lines.join("\n")}` : query || stage ? "No candidate matches." : "There are no candidates yet.",
        open.length
          ? `Open roles:\n${open.map((r) => `- ${r.title}${r.department ? ` (${r.department})` : ""}, ${r.headcount} to hire, ${r.applicationCount} application(s), ${r.state} (id: ${r.id})`).join("\n")}`
          : "No role is open.",
      ].join("\n\n"),
    };
  }

  if (name === "add_candidate") {
    const candidateName = str(args.name, 200);
    if (!candidateName) return { text: "A candidate needs a name." };
    let role: { id: string; title: string } | null = null;
    const wanted = str(args.role, 200);
    if (wanted) {
      const roles = await listRequisitions(person);
      const lower = wanted.toLowerCase();
      const exact = roles.find((r) => r.id === wanted || r.title.toLowerCase() === lower);
      const partial = roles.filter((r) => r.title.toLowerCase().includes(lower));
      const found = exact ?? (partial.length === 1 ? partial[0] : undefined);
      if (!found) {
        return {
          text: partial.length > 1
            ? `"${wanted}" matches more than one role: ${partial.map((r) => `${r.title} (${r.id})`).join(", ")}. Say which.`
            : `No role matches "${wanted}". The roles are: ${roles.map((r) => r.title).join(", ") || "none open"}.`,
        };
      }
      role = { id: found.id, title: found.title };
    }
    const candidateId = await addCandidate(person, {
      name: candidateName,
      email: str(args.email, 320) || null,
      phone: str(args.phone, 60) || null,
      source: str(args.source, 80) || "direct",
      notes: str(args.notes, 4000) || null,
      consented: args.consented === true,
      retainMonths: Math.round(num(args.retain_months, 12)) || 12,
      requisitionId: role?.id ?? null,
    });
    return {
      artifacts: [{ kind: "candidate", id: candidateId, title: candidateName, action: "created" }],
      changed: true,
      text:
        `Added as ${who}: ${candidateName} (id: ${candidateId})${role ? `, applied to "${role.title}" at the applied stage` : ""}.` +
        (args.consented === true ? " Consent to keep their details is recorded." : " No consent is recorded yet; ask the candidate and note it on the HR screen."),
    };
  }

  if (name === "set_candidate_stage") {
    const stage = (STAGES as readonly string[]).includes(str(args.stage, 20)) ? str(args.stage, 20) : null;
    if (!stage) return { text: `A stage is one of ${STAGES.join(", ")}.` };
    const candidates = await listCandidates(person);
    const applicationId = id(args.application_id);
    const candidateId = id(args.candidate_id);
    let target: { candidate: string; app: { id: string; requisitionTitle: string; stage: string } } | null = null;
    for (const c of candidates) {
      for (const a of c.applications) {
        if (applicationId ? a.id === applicationId : c.id === candidateId) {
          if (!applicationId && target) {
            return { text: `${c.name} has more than one application: ${c.applications.map((x) => `${x.requisitionTitle} (application id: ${x.id})`).join(", ")}. Say which.` };
          }
          target = { candidate: c.name, app: a };
        }
      }
    }
    if (!target) return { text: "No such application. Use an application id from list_candidates (a candidate with no application has to be added to a role first)." };
    if (target.app.stage === stage) return { text: `${target.candidate} is already at ${stage} for "${target.app.requisitionTitle}".` };
    await setStage(person, target.app.id, stage);
    return {
      artifacts: [{ kind: "candidate", id: target.app.id, title: `${target.candidate} · ${target.app.requisitionTitle}`, action: "updated" }],
      changed: true,
      text: `Moved as ${who}: ${target.candidate}, "${target.app.requisitionTitle}": ${target.app.stage} → ${stage} (application id: ${target.app.id}).`,
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const hrPack: ToolPack = { module: "hr", defs, run };
