import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  checklistRuns,
  checklists,
  clauseFindings,
  contracts,
  templates,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";

/**
 * Legal (spec §4.10).
 *
 * Manual and template-driven, at the client's own direction: the studio writes
 * its own templates here rather than handing a pack over first.
 *
 * One rule shapes everything on the review side: **a departure is marked and
 * explained; a verdict is never rendered.** A finding says what the template
 * said, what the contract says and how they differ. There is no risk score,
 * and `acknowledge` records that a person read it, not that it is fine.
 *
 * The non-advice notice (contract clause 8.4) is on every screen in this
 * module, which is why it lives here as a constant rather than as a string
 * somebody might forget to paste onto a new tab.
 */
export const NON_ADVICE = {
  en: "This is drafting and comparison, not legal advice. A qualified adviser decides what any of it means.",
  zh: "这里提供的是起草与比对，不是法律意见。具体含义请咨询有资质的法律顾问。",
};

/**
 * The two a video channel of this kind actually signs.
 *
 * Starting points the studio edits, seeded on request and never silently:
 * a contributor release for anybody who appears on camera, and a production
 * services agreement for the freelancers who make the thing.
 */
const STARTER_TEMPLATES = [
  {
    name: "Contributor and likeness release",
    kind: "release",
    fields: [
      { key: "contributor", label: "Contributor's full name" },
      { key: "production", label: "Production or episode" },
      { key: "recorded_on", label: "Date of recording" },
      { key: "territory", label: "Territory", hint: "Worldwide, unless the contributor asks otherwise" },
    ],
    body: `CONTRIBUTOR AND LIKENESS RELEASE

Between {{ studio }} ("the Studio") and {{ contributor }} ("the Contributor").

1. Recording. The Contributor agrees to take part in {{ production }}, recorded on {{ recorded_on }}.

2. Grant. The Contributor grants the Studio the right to record, edit, reproduce and publish their name, voice, likeness and contribution as part of {{ production }} and its promotion, in {{ territory }}.

3. Editing. The Contributor understands the recording will be edited, and that the Studio decides the final cut.

4. Warranty. The Contributor confirms that what they say is their own, and that they are free to give this permission.

5. Withdrawal. The Contributor may withdraw before publication by writing to the Studio. After publication the Studio is not required to remove material already published, but will not use the contribution in a new production without asking again.

6. No fee. No payment is due for this permission unless a separate agreement says otherwise.

7. Data. The Studio keeps the Contributor's contact details only while needed for this production and for records, and handles them under the Personal Data (Privacy) Ordinance.

8. Governing law. Hong Kong.

Signed: ____________________   Date: ____________
{{ contributor }}

Signed: ____________________   Date: ____________
for {{ studio }}`,
  },
  {
    name: "Freelance production services agreement",
    kind: "agreement",
    fields: [
      { key: "contractor", label: "Contractor's name" },
      { key: "role", label: "Role", hint: "Editor, camera operator, colourist…" },
      { key: "services", label: "What they are doing" },
      { key: "fee", label: "Fee" },
      { key: "starts_on", label: "Start date" },
      { key: "delivery", label: "Delivery date" },
    ],
    body: `FREELANCE PRODUCTION SERVICES AGREEMENT

Between {{ studio }} ("the Studio") and {{ contractor }} ("the Contractor"), engaged as {{ role }}.

1. Services. The Contractor will provide: {{ services }}.

2. Dates. Work starts on {{ starts_on }}. Delivery is due by {{ delivery }}.

3. Fee. {{ fee }}, payable within 14 days of delivery and acceptance.

4. Status. The Contractor is an independent contractor, not an employee, and is responsible for their own taxes and insurance.

5. Ownership. On payment in full, all rights in the work made under this agreement pass to the Studio. The Contractor may show the work in a personal portfolio unless the Studio asks otherwise in writing.

6. Third-party material. The Contractor will not include music, footage or fonts they do not have the right to use, and will tell the Studio what licences any supplied material carries.

7. Confidentiality. Neither side will disclose the other's unpublished material or commercial terms.

8. Equipment. Each side provides its own unless agreed in writing.

9. Termination. Either side may end this agreement with 7 days' notice. The Studio pays for work done to that point.

10. Governing law. Hong Kong.

Signed: ____________________   Date: ____________
{{ contractor }}

Signed: ____________________   Date: ____________
for {{ studio }}`,
  },
];

export type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  body: string;
  fields: { key: string; label: string; hint?: string }[];
  active: boolean;
  updatedAt: Date;
};

export async function listTemplates(viewer: Viewer): Promise<TemplateRow[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.tenantId, viewer.tenantId))
    .orderBy(templates.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    body: r.body,
    fields: r.fields,
    active: r.active,
    updatedAt: r.updatedAt,
  }));
}

export async function seedTemplates(viewer: Viewer) {
  const existing = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(eq(templates.tenantId, viewer.tenantId));
  if ((existing[0]?.n ?? 0) > 0) return;

  await db.insert(templates).values(
    STARTER_TEMPLATES.map((t) => ({
      id: newId("tpl"),
      tenantId: viewer.tenantId,
      name: t.name,
      kind: t.kind,
      body: t.body,
      fields: t.fields,
      updatedBy: viewer.id,
    })),
  );
  await audit(viewer, "legal.templates.seed", { module: "legal" });
}

export async function saveTemplate(
  viewer: Viewer,
  input: { id?: string | null; name: string; kind: string; body: string; fields: { key: string; label: string }[] },
) {
  const name = input.name.trim();
  if (!name) throw new Error("A template needs a name");

  if (input.id) {
    await db
      .update(templates)
      .set({ name, kind: input.kind, body: input.body, fields: input.fields, updatedBy: viewer.id, updatedAt: new Date() })
      .where(and(eq(templates.id, input.id), eq(templates.tenantId, viewer.tenantId)));
    await audit(viewer, "legal.template.update", { module: "legal", objectId: input.id });
    return input.id;
  }

  const id = newId("tpl");
  await db.insert(templates).values({
    id,
    tenantId: viewer.tenantId,
    name,
    kind: input.kind,
    body: input.body,
    fields: input.fields,
    updatedBy: viewer.id,
  });
  await audit(viewer, "legal.template.create", { module: "legal", objectId: id });
  return id;
}

/* ------------------------------------------------------------- contracts */

export type ContractRow = {
  id: string;
  templateId: string | null;
  templateName: string | null;
  title: string;
  counterparty: string | null;
  body: string;
  values: Record<string, string>;
  state: string;
  signedOn: string | null;
  expiresOn: string | null;
  ownerName: string | null;
  updatedAt: Date;
  findingCount: number;
  unacknowledged: number;
};

export async function listContracts(viewer: Viewer): Promise<ContractRow[]> {
  const rows = await db
    .select({ c: contracts, templateName: templates.name, ownerName: users.name })
    .from(contracts)
    .leftJoin(templates, eq(templates.id, contracts.templateId))
    .leftJoin(users, eq(users.id, contracts.ownerId))
    .where(eq(contracts.tenantId, viewer.tenantId))
    .orderBy(desc(contracts.updatedAt))
    .limit(200);

  if (!rows.length) return [];

  const counts = await db
    .select({
      contractId: clauseFindings.contractId,
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${clauseFindings.acknowledgedAt} is null)::int`,
    })
    .from(clauseFindings)
    .where(inArray(clauseFindings.contractId, rows.map((r) => r.c.id)))
    .groupBy(clauseFindings.contractId);

  const byContract = new Map(counts.map((c) => [c.contractId, c]));

  return rows.map((r) => ({
    id: r.c.id,
    templateId: r.c.templateId,
    templateName: r.templateName,
    title: r.c.title,
    counterparty: r.c.counterparty,
    body: r.c.body,
    values: r.c.values,
    state: r.c.state,
    signedOn: r.c.signedOn,
    expiresOn: r.c.expiresOn,
    ownerName: r.ownerName,
    updatedAt: r.c.updatedAt,
    findingCount: byContract.get(r.c.id)?.total ?? 0,
    unacknowledged: byContract.get(r.c.id)?.open ?? 0,
  }));
}

/** `{{ key }}` filled from the values the drafting screen collected. A field
 * nobody filled stays visible as its own placeholder rather than becoming an
 * empty space nobody notices. */
export function fillTemplate(body: string, values: Record<string, string>, studio: string): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    if (key === "studio") return studio;
    const v = values[key];
    return v && v.trim() ? v : whole;
  });
}

export async function draftContract(
  viewer: Viewer,
  input: { templateId: string; title: string; counterparty: string | null; values: Record<string, string>; studio: string },
) {
  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, input.templateId), eq(templates.tenantId, viewer.tenantId)))
    .limit(1);
  if (!template) throw new Error("That template does not exist");

  const id = newId("con");
  await db.insert(contracts).values({
    id,
    tenantId: viewer.tenantId,
    templateId: template.id,
    title: input.title.trim() || template.name,
    counterparty: input.counterparty?.trim() || null,
    body: fillTemplate(template.body, input.values, input.studio),
    values: input.values,
    ownerId: viewer.id,
  });

  await audit(viewer, "legal.contract.draft", { module: "legal", objectType: "contract", objectId: id });
  return id;
}

export const CONTRACT_STATES = ["draft", "in_review", "sent", "signed", "expired", "terminated"] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export function isContractState(v: unknown): v is ContractState {
  return typeof v === "string" && (CONTRACT_STATES as readonly string[]).includes(v);
}

export async function updateContract(
  viewer: Viewer,
  contractId: string,
  input: {
    title?: string;
    body?: string;
    counterparty?: string | null;
    state?: ContractState;
    signedOn?: string | null;
    expiresOn?: string | null;
  },
) {
  await db
    .update(contracts)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim().slice(0, 300) } : {}),
      ...(input.body !== undefined ? { body: input.body.slice(0, 200_000) } : {}),
      ...(input.counterparty !== undefined ? { counterparty: input.counterparty } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.signedOn !== undefined ? { signedOn: input.signedOn } : {}),
      ...(input.expiresOn !== undefined ? { expiresOn: input.expiresOn } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(contracts.id, contractId), eq(contracts.tenantId, viewer.tenantId)));
  await audit(viewer, "legal.contract.update", { module: "legal", objectType: "contract", objectId: contractId });
}

/* --------------------------------------------------------- clause review */

export type FindingRow = {
  id: string;
  clause: string;
  templateText: string | null;
  contractText: string | null;
  explanation: string;
  departure: string;
  acknowledgedByName: string | null;
  acknowledgedAt: Date | null;
};

export async function listFindings(viewer: Viewer, contractId: string): Promise<FindingRow[]> {
  const [own] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!own) return [];

  const rows = await db
    .select({ f: clauseFindings, byName: users.name })
    .from(clauseFindings)
    .leftJoin(users, eq(users.id, clauseFindings.acknowledgedBy))
    .where(eq(clauseFindings.contractId, contractId))
    .orderBy(clauseFindings.clause);

  return rows.map((r) => ({
    id: r.f.id,
    clause: r.f.clause,
    templateText: r.f.templateText,
    contractText: r.f.contractText,
    explanation: r.f.explanation,
    departure: r.f.departure,
    acknowledgedByName: r.byName,
    acknowledgedAt: r.f.acknowledgedAt,
  }));
}

/**
 * Compare a contract against the template it came from.
 *
 * Clause by clause, by the numbered headings both texts use. A clause present
 * in one and not the other is `missing` or `added`; one whose text differs is
 * `changed`, or `reworded` when only whitespace and punctuation moved.
 *
 * Deliberately mechanical. It states the difference and nothing about what the
 * difference means, because what it means is a question for somebody
 * qualified, and a plausible-sounding verdict from a machine is worse than
 * none.
 */
export async function reviewContract(viewer: Viewer, contractId: string) {
  const [row] = await db
    .select({ c: contracts, template: templates })
    .from(contracts)
    .leftJoin(templates, eq(templates.id, contracts.templateId))
    .where(and(eq(contracts.id, contractId), eq(contracts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row) throw new Error("That contract does not exist");
  if (!row.template) throw new Error("This contract did not come from a template, so there is nothing to compare it with");

  const templateClauses = splitClauses(row.template.body);
  const contractClauses = splitClauses(row.c.body);

  const keys = new Set([...templateClauses.keys(), ...contractClauses.keys()]);
  const findings: (typeof clauseFindings.$inferInsert)[] = [];

  for (const key of [...keys].sort(byClauseNumber)) {
    const a = templateClauses.get(key) ?? null;
    const b = contractClauses.get(key) ?? null;

    let departure = "same";
    let explanation = "";

    if (a && !b) {
      departure = "missing";
      explanation = "The template has this clause and the contract does not.";
    } else if (!a && b) {
      departure = "added";
      explanation = "The contract has a clause the template does not.";
    } else if (a && b) {
      const na = normalise(a);
      const nb = normalise(b);
      if (na === nb) continue;
      departure = na.replace(/\W/g, "") === nb.replace(/\W/g, "") ? "reworded" : "changed";
      explanation =
        departure === "reworded"
          ? "The same words, punctuated or spaced differently."
          : "The wording differs from the template.";
    } else {
      continue;
    }

    findings.push({
      id: newId("rev"),
      contractId,
      clause: key,
      templateText: a,
      contractText: b,
      explanation,
      departure,
    });
  }

  // A review replaces the last one: a finding that is no longer true should
  // not sit on the screen next to one that is.
  await db.delete(clauseFindings).where(eq(clauseFindings.contractId, contractId));
  if (findings.length) await db.insert(clauseFindings).values(findings);

  await db
    .update(contracts)
    .set({ state: "in_review", updatedAt: new Date() })
    .where(eq(contracts.id, contractId));

  await audit(viewer, "legal.contract.review", {
    module: "legal",
    objectType: "contract",
    objectId: contractId,
    meta: { findings: findings.length },
  });

  return findings.length;
}

/** Somebody read it. Not a verdict on the clause: a record that a person
 * looked at the departure and is content to leave it. */
export async function acknowledgeFinding(viewer: Viewer, findingId: string) {
  await db
    .update(clauseFindings)
    .set({ acknowledgedBy: viewer.id, acknowledgedAt: new Date() })
    .where(eq(clauseFindings.id, findingId));
  await audit(viewer, "legal.finding.acknowledge", { module: "legal", objectId: findingId });
}

/** Numbered clauses, as both texts write them: "3. Fee." and so on. */
function splitClauses(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = body.split("\n");
  let key: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (key) out.set(key, buffer.join("\n").trim());
    buffer = [];
  };

  for (const line of lines) {
    const m = line.match(/^\s*(\d{1,2})[.)]\s+(.*)$/);
    if (m) {
      flush();
      key = m[1];
      buffer = [m[2]];
    } else if (key) {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const byClauseNumber = (a: string, b: string) => Number(a) - Number(b);

/* ------------------------------------------------------------ compliance */

export type ChecklistRow = {
  id: string;
  name: string;
  items: { key: string; text: string }[];
  runCount: number;
  lastRunAt: Date | null;
};

const STARTER_CHECKLIST = {
  name: "Before a video goes out",
  items: [
    { key: "releases", text: "Every person on camera has signed a contributor release." },
    { key: "music", text: "Music and sound effects are licensed for this use." },
    { key: "footage", text: "Third-party footage is licensed, or is ours." },
    { key: "claims", text: "Factual claims in the script can be sourced." },
    { key: "sponsorship", text: "Any sponsorship or gifting is disclosed on screen and in the caption." },
    { key: "personal_data", text: "No personal data of a non-participant is visible (screens, documents, faces)." },
    { key: "trademarks", text: "Brands shown are incidental, or we have permission." },
  ],
};

export async function listChecklists(viewer: Viewer): Promise<ChecklistRow[]> {
  const rows = await db
    .select()
    .from(checklists)
    .where(eq(checklists.tenantId, viewer.tenantId))
    .orderBy(checklists.name);
  if (!rows.length) return [];

  const runs = await db
    .select({
      checklistId: checklistRuns.checklistId,
      n: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${checklistRuns.createdAt})`,
    })
    .from(checklistRuns)
    .where(inArray(checklistRuns.checklistId, rows.map((r) => r.id)))
    .groupBy(checklistRuns.checklistId);

  const byList = new Map(runs.map((r) => [r.checklistId, r]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    items: r.items,
    runCount: byList.get(r.id)?.n ?? 0,
    lastRunAt: byList.get(r.id)?.last ?? null,
  }));
}

export async function seedChecklist(viewer: Viewer) {
  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(checklists)
    .where(eq(checklists.tenantId, viewer.tenantId));
  if ((existing?.n ?? 0) > 0) return;

  await db.insert(checklists).values({
    id: newId("comp"),
    tenantId: viewer.tenantId,
    name: STARTER_CHECKLIST.name,
    items: STARTER_CHECKLIST.items,
  });
  await audit(viewer, "legal.checklist.seed", { module: "legal" });
}

export type RunRow = {
  id: string;
  checklistName: string;
  subject: string | null;
  answers: Record<string, { value: string; note?: string }>;
  ranByName: string | null;
  completedAt: Date | null;
  createdAt: Date;
};

export async function listRuns(viewer: Viewer, limit = 40): Promise<RunRow[]> {
  const rows = await db
    .select({ r: checklistRuns, name: checklists.name, byName: users.name })
    .from(checklistRuns)
    .innerJoin(checklists, eq(checklists.id, checklistRuns.checklistId))
    .leftJoin(users, eq(users.id, checklistRuns.ranBy))
    .where(eq(checklistRuns.tenantId, viewer.tenantId))
    .orderBy(desc(checklistRuns.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.r.id,
    checklistName: r.name,
    subject: r.r.subject,
    answers: r.r.answers,
    ranByName: r.byName,
    completedAt: r.r.completedAt,
    createdAt: r.r.createdAt,
  }));
}

export async function saveRun(
  viewer: Viewer,
  input: { id?: string | null; checklistId: string; subject: string; answers: Record<string, { value: string; note?: string }>; complete: boolean },
) {
  if (input.id) {
    await db
      .update(checklistRuns)
      .set({
        subject: input.subject.slice(0, 300),
        answers: input.answers,
        completedAt: input.complete ? new Date() : null,
      })
      .where(and(eq(checklistRuns.id, input.id), eq(checklistRuns.tenantId, viewer.tenantId)));
    await audit(viewer, "legal.checklist.run", { module: "legal", objectId: input.id });
    return input.id;
  }

  const id = newId("comp");
  await db.insert(checklistRuns).values({
    id,
    tenantId: viewer.tenantId,
    checklistId: input.checklistId,
    subject: input.subject.slice(0, 300),
    answers: input.answers,
    ranBy: viewer.id,
    completedAt: input.complete ? new Date() : null,
  });
  await audit(viewer, "legal.checklist.run", { module: "legal", objectId: id });
  return id;
}
