import "server-only";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  checklistRuns,
  checklists,
  clauseFindings,
  contracts,
  templates,
  tenants,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { fillTemplate, resolveDraft, templateLanguage } from "@/lib/legal/fill";
import { clauseOrder, compareClauses } from "@/lib/legal/compare";
import { RELEASE_ZH } from "@/lib/legal/release-zh";
import { RELEASE_EN } from "@/lib/legal/release-en";
import { BUILTIN_HISTORY } from "@/lib/legal/builtin-history";

/** (QA, 2 Oct) A person's name the way the reader reads it: the Chinese name on a Chinese screen. */
function personName(viewer: Viewer) {
  return (viewer.locale ?? "zh-CN").startsWith("zh")
    ? sql<string | null>`coalesce(nullif(${users.nameLocal}, ''), ${users.name})`
    : sql<string | null>`${users.name}`;
}


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
 * module, and at the end of everything 法务 drafts or compares, which is why
 * it is a constant rather than a string somebody might forget to paste onto a
 * new tab. It is defined in `./notice`, which a plain script can load.
 */

/**
 * The two a video channel of this kind actually signs.
 *
 * Starting points the studio edits, seeded on request and never silently:
 * a contributor release for anybody who appears on camera, and a production
 * services agreement for the freelancers who make the thing.
 */
const STARTER_TEMPLATES = [
  /* (4 Oct) Its own module, revised with the Chinese one; see ./release-en. */
  RELEASE_EN,
  {
    builtinKey: "agreement.en",
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
  /** 'release.zh' and so on for a template the app added; null for one a person wrote. */
  builtinKey: string | null;
  name: string;
  kind: string;
  body: string;
  fields: { key: string; label: string; hint?: string }[];
  active: boolean;
  updatedAt: Date;
};

/** The template new drafts start from: the Chinese release. */
export const DEFAULT_TEMPLATE_KEY = RELEASE_ZH.builtinKey;

/** The current text of every built-in that has been revised, by key. */
const CURRENT_BUILTINS: Record<string, { body: string; fields: { key: string; label: string; hint?: string }[] }> = {
  [RELEASE_ZH.builtinKey]: RELEASE_ZH,
  [RELEASE_EN.builtinKey]: RELEASE_EN,
};

const sameText = (a: string, b: string) => a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();

/**
 * Templates the app adds to a studio that already has its starters, on read,
 * so they appear without anybody running a script. Only for a studio that has
 * templates: an empty one is still offered the starters on request and never
 * silently (`seedTemplates`, which includes these). Idempotent through the
 * (tenant_id, builtin_key) index; a template somebody hid stays hidden.
 *
 * (4 Oct) Also brings a built-in up to its revised text — but only while its
 * stored body is still exactly an earlier built-in text (./builtin-history).
 * A template somebody edited is theirs and is never overwritten. The update
 * repeats the old body in its WHERE, so an edit saved in between wins.
 */
async function ensureBuiltinTemplates(viewer: Viewer, existing: { id: string; builtinKey: string | null; body: string }[]) {
  if (!existing.length) return false;
  let changed = false;

  if (!existing.some((r) => r.builtinKey === RELEASE_ZH.builtinKey)) {
    const added = await db
      .insert(templates)
      .values({
        id: newId("tpl"),
        tenantId: viewer.tenantId,
        builtinKey: RELEASE_ZH.builtinKey,
        name: RELEASE_ZH.name,
        kind: RELEASE_ZH.kind,
        body: RELEASE_ZH.body,
        fields: RELEASE_ZH.fields,
      })
      .onConflictDoNothing({ target: [templates.tenantId, templates.builtinKey] })
      .returning({ id: templates.id });
    if (added.length) {
      await audit(viewer, "legal.template.builtin", { module: "legal", objectId: added[0].id, meta: { builtinKey: RELEASE_ZH.builtinKey } });
      changed = true;
    }
  }

  for (const row of existing) {
    /* A starter seeded before built-ins carried a key has none, but its text
       is still word for word one we shipped: adopt it under that key (only
       when no other row already holds the key), so it upgrades like the rest.
       A template somebody edited matches nothing and is left alone. */
    const adopted = row.builtinKey
      ? null
      : Object.keys(BUILTIN_HISTORY).find(
          (key) =>
            !existing.some((other) => other.builtinKey === key) &&
            (BUILTIN_HISTORY[key] ?? []).some((old) => sameText(old, row.body)),
        ) ?? null;
    const key = row.builtinKey ?? adopted;
    const current = key ? CURRENT_BUILTINS[key] : undefined;
    if (!current || !key || sameText(row.body, current.body)) continue;
    if (!(BUILTIN_HISTORY[key] ?? []).some((old) => sameText(old, row.body))) continue;
    const upgraded = await db
      .update(templates)
      .set({ body: current.body, fields: current.fields, updatedAt: new Date(), ...(adopted ? { builtinKey: adopted } : {}) })
      .where(and(eq(templates.id, row.id), eq(templates.tenantId, viewer.tenantId), eq(templates.body, row.body)))
      .returning({ id: templates.id });
    if (upgraded.length) {
      await audit(viewer, "legal.template.builtin.upgrade", { module: "legal", objectId: row.id, meta: { builtinKey: key, adopted: Boolean(adopted) } });
      changed = true;
    }
  }
  return changed;
}

export async function listTemplates(viewer: Viewer): Promise<TemplateRow[]> {
  const read = () =>
    db
      .select()
      .from(templates)
      .where(eq(templates.tenantId, viewer.tenantId))
      .orderBy(templates.name);
  let rows = await read();
  if (await ensureBuiltinTemplates(viewer, rows)) rows = await read();
  /* The default (the Chinese release) first, so every list opens on it. */
  rows.sort((a, b) => Number(b.builtinKey === DEFAULT_TEMPLATE_KEY) - Number(a.builtinKey === DEFAULT_TEMPLATE_KEY));
  return rows.map((r) => ({
    id: r.id,
    builtinKey: r.builtinKey,
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
    [RELEASE_ZH, ...STARTER_TEMPLATES].map((t) => ({
      id: newId("tpl"),
      tenantId: viewer.tenantId,
      builtinKey: t.builtinKey,
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
  if (!name) throw new Error("请给模板起个名字");

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
    .select({ c: contracts, templateName: templates.name, ownerName: personName(viewer) })
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

/* `{{ key }}` filling lives in ./fill, where it can be checked without a database. */
export { fillTemplate };

export async function draftContract(
  viewer: Viewer,
  input: { templateId: string; title: string; counterparty: string | null; values: Record<string, string>; studio: string },
) {
  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, input.templateId), eq(templates.tenantId, viewer.tenantId)))
    .limit(1);
  if (!template) throw new Error("这个模板不存在");

  /* Blank optional fields take their default, in the template's language
     (授权地区 → 全球 in Chinese, worldwide in English; a party detail → a
     line to write on); anything else blank is refused by name. A draft never
     carries a {{ placeholder }}. */
  const draft = resolveDraft(template.body, template.fields, input.values, input.studio, templateLanguage(template));
  if ("error" in draft) throw new Error(draft.error);

  const id = newId("con");
  await db.insert(contracts).values({
    id,
    tenantId: viewer.tenantId,
    templateId: template.id,
    title: input.title.trim() || template.name,
    counterparty: input.counterparty?.trim() || null,
    body: draft.text,
    /* The values as used, defaults included, so a review rebuilds the same text. */
    values: draft.values,
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

/** (4 Oct) A signed, expired or terminated contract is a record: its text
 * and title can be read and downloaded but not changed. Its state and dates
 * still can (a signed contract is terminated, an expiry date corrected). */
export const READ_ONLY_STATES: readonly ContractState[] = ["signed", "expired", "terminated"];
export const isReadOnlyState = (state: string) => (READ_ONLY_STATES as readonly string[]).includes(state);

/** One contract with its template's name and fields, for the contract view and its download. */
export async function getContract(viewer: Viewer, contractId: string) {
  const [row] = await db
    .select({ c: contracts, templateName: templates.name, templateFields: templates.fields, ownerName: personName(viewer) })
    .from(contracts)
    .leftJoin(templates, eq(templates.id, contracts.templateId))
    .leftJoin(users, eq(users.id, contracts.ownerId))
    .where(and(eq(contracts.id, contractId), eq(contracts.tenantId, viewer.tenantId)))
    .limit(1);
  return row ?? null;
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
  const [current] = await db
    .select({ state: contracts.state })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!current) throw new Error("这份合同不存在");
  const editsText = input.body !== undefined || input.title !== undefined;
  if (editsText && isReadOnlyState(current.state)) {
    throw new Error("已签署、已到期或已终止的合同不能修改正文或标题，只能查看和下载");
  }

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
    .where(
      and(
        eq(contracts.id, contractId),
        eq(contracts.tenantId, viewer.tenantId),
        /* Signed between the read and the write: the text stays as signed. */
        editsText ? notInArray(contracts.state, [...READ_ONLY_STATES]) : undefined,
      ),
    );
  await audit(viewer, "legal.contract.update", {
    module: "legal",
    objectType: "contract",
    objectId: contractId,
    meta: { fields: Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined) },
  });
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
    .select({ f: clauseFindings, byName: personName(viewer) })
    .from(clauseFindings)
    .leftJoin(users, eq(users.id, clauseFindings.acknowledgedBy))
    .where(eq(clauseFindings.contractId, contractId));
  /* Preamble, then clauses in number order (as text, "10" sorted before "2"), then the signing block. */
  rows.sort((a, b) => clauseOrder(a.f.clause, b.f.clause));

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
  if (!row) throw new Error("这份合同不存在");
  if (!row.template) throw new Error("这份合同不是用模板生成的，没有可以对照的版本");

  /* Against the template *as this contract filled it*: its own values and the
     studio's name put in, so a filled draft nobody edited has no findings.
     Compared with the raw placeholders, every filled clause read as changed
     (QA, 3 Oct). The name is the one drafting used (`draftContractAction`). */
  const [studio] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, viewer.tenantId)).limit(1);
  /* (4 Oct) A built-in template may have been revised since this contract was
     drafted from it. Compare with whichever version of the text it came from:
     the current one and every earlier built-in text, keeping the comparison
     with the fewest departures. A contract nobody edited still shows none. */
  const versions = [row.template.body, ...(row.template.builtinKey ? (BUILTIN_HISTORY[row.template.builtinKey] ?? []) : [])];
  /* Numbered clauses in either language ("3." or 第三条), the preamble and the signing block; see ./compare. */
  const diffs = versions
    .map((body) => compareClauses(fillTemplate(body, row.c.values ?? {}, studio?.name ?? "the Studio"), row.c.body))
    .reduce((best, d) => (d.length < best.length ? d : best));
  const findings: (typeof clauseFindings.$inferInsert)[] = diffs.map((d) => ({ id: newId("rev"), contractId, ...d }));

  // A review replaces the last one: a finding that is no longer true should
  // not sit on the screen next to one that is.
  await db.delete(clauseFindings).where(eq(clauseFindings.contractId, contractId));
  if (findings.length) await db.insert(clauseFindings).values(findings);

  /* Only a draft moves to 审阅中. Comparing a contract that was already sent,
     signed or terminated is reading it, and must not change where it stands
     (QA, 4 Oct: comparing a signed contract set it back to 审阅中). */
  await db
    .update(contracts)
    .set({ state: "in_review", updatedAt: new Date() })
    .where(and(eq(contracts.id, contractId), eq(contracts.tenantId, viewer.tenantId), eq(contracts.state, "draft")));

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
    .where(
      and(
        eq(clauseFindings.id, findingId),
        inArray(clauseFindings.contractId, db.select({ id: contracts.id }).from(contracts).where(eq(contracts.tenantId, viewer.tenantId))),
      ),
    );
  await audit(viewer, "legal.finding.acknowledge", { module: "legal", objectId: findingId });
}

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
    .select({ r: checklistRuns, name: checklists.name, byName: personName(viewer) })
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
