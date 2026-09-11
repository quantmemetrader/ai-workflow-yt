# Product brief — screen requirements

What each screen is **for**, what it must let someone **decide or do**, and
what must be **true** of it. Traced to
[`01_Build-Spec 2.pdf`](../01_Build-Spec%202.pdf) v2.4.

**This document does not specify how anything looks.** No colours, no
dimensions, no fonts, no layout. That is the design system's job (Espresso
via Frappe UI, or Blend) and the design tool's job. If you find a visual
instruction in here, it is a bug — delete it.

Feed a section of this to Claude Design, Figma or Framer along with the
design system, and let the tool decide the form.

---

## Ground rules that constrain every screen

These are product constraints, not style. They change what a screen must
do, so they belong here.

1. **An agent has exactly the permissions of the employee who invoked it**
   (§2). Nothing on any screen may show, cite, or hint at content the
   viewer cannot read — including the *existence* of a file, via a title in
   a citation list (§2.2.4).
2. **Permission is checked at query time, never at index time** (§2.2.1).
   Every list, search and retrieval filters against the requesting user, so
   every screen needs a coherent "you are seeing a filtered subset" story.
3. **The left navigation shows only entitled modules** (§4.1). No screen may
   assume a peer module exists. A `member` with two modules must get a
   complete product.
4. **Nothing in a module is reachable only through chat** (§4). Every module
   screen must be independently useful and independently loadable. §4.3
   states it outright for Content performance: it *"loads without a chat
   prompt."*
5. **Default locale is Traditional Chinese, Hong Kong usage** (§4.1), with
   an English toggle. All strings externalised (§8). Design must survive
   both, and zh-HK is the case to design for, not the afterthought.
6. **Desktop only.** Current Chrome, Edge, Safari, Firefox. No mobile
   layout is in scope (§8).
7. **Every AI call is metered and every spend is attributable** (§5). Cost
   is a first-class thing a user sees, not an admin-only concern.
8. **Nothing irreversible happens without a named human approving it** —
   publishing (§4.6), accounting entries (§4.7), spend (§4.8), leave
   (§4.10). Approval is a product primitive, reused across five modules.

---

## Shell (§4.1)

**Purpose.** Carry the employee between modules and tell them, at all
times, what they are spending and what needs their attention.

**Must support these decisions**
- Where do I go next?
- Is something waiting on me?
- Am I about to run out of budget?

**Information required**
- The modules this employee is entitled to — and only those.
- Global search across everything they can read, permission-filtered.
- Notifications of three distinct kinds: job completions, approval
  requests, budget warnings. These have different urgencies and different
  destinations.
- The employee's own consumption against their own cap.

**States that must exist**
- Entitled to one module. Entitled to all eleven.
- Nothing pending vs. many things pending.
- Under cap / near cap / at cap (at cap, consumption has *stopped* — §4.11).
- English and Traditional Chinese.

**Done when** an admin grants an employee two modules and one file group,
and that employee sees exactly those and no others (§9).

---

## Chat (§4.2)

**Purpose.** The employee's agent. Holds the conversation, decides which
module to call, writes results into the employee's file space.

**Must support these decisions**
- Can I trust this answer? (What did it read? What did it run?)
- Where did this come from, and can I open it?
- What did this cost me?

**Information required**
- The response, streaming.
- Which module ran and which files were read — visible, not buried.
- Citations that link to the file, filtered by the same permission check as
  the content itself.
- A list of resources the current answer used.
- Inline previews of files referenced.

**Actions**
- Trigger any module the employee is entitled to; results land in their
  file space.
- Open a cited file, subject to their own permissions.

**States that must exist**
- Streaming, complete, failed mid-stream.
- An answer that used no files at all.
- An answer where some matching files were withheld for permission — the
  user should understand the answer is partial without learning what was
  withheld.
- Provider credit exhausted: name the account and provider, stop retrying,
  say plainly it is not a platform fault (§5).

**Done when** an employee asks their agent about a document they cannot
access and the agent does not return, reference or cite it (§9).

---

## Database / files (§3, §4.1)

**Purpose.** The shared media and document store, with per-file
permissions.

**Must support these decisions**
- Which version is the real one?
- Who can see this, and should they?
- Can I safely delete this?

**Information required**
- Files and folders the viewer can access, with kind, size, owner and
  modification time.
- Version history with author, timestamp and note.
- Who a file is shared with, and at what relation
  (`owner > editor > commenter > viewer`).
- For media: duration, resolution, checksum, storage location.

**Actions**
- Upload, move, share, restore a version, soft-delete.
- **Sharing is bounded by the sharer** — an employee can grant only
  relations they themselves hold, enforced server-side (§2.2.7). The screen
  must make the ceiling legible *before* someone tries.

**States that must exist**
- Empty folder. Folder where everything is filtered out by permission.
- Soft-deleted, inside the 30-day recovery window.
- A guest with time-boxed access to named folders only.

**Done when** an employee shares a folder they hold `editor` on and the
recipient gets no more than `editor`; attempting to share a folder they
only view fails (§9).

---

## Market Research (§4.3)

Five screens. Each must load on its own.

### Trends dashboard
**Decision:** what should we make next?
**Needs:** ranked topics from client-designated sources for a chosen region
and window; for each — how hot, whether it is rising or falling, what it is
in one line, angles we could take, and links to primary sources.
**Actions:** adopt, reject, save for later. Adopt and reject feed back into
ranking weights, so the user should understand their choices are training
something.
**Constraint:** sensitive topics carry a flag **and a reason** — the reason
is what makes the flag actionable.

### Search and compare
**Decision:** is this topic actually bigger than that one?
**Needs:** keyword and topic search across connected sources; up to five
series on one time axis.
**Actions:** export the comparison to the database as a research report.

### Content performance
**Decision:** did what we made work?
**Needs:** our own published videos — views, watch-through, engagement,
comment volume; filterable by channel, date range, campaign; time-series
for any one video; per-channel breakdown; best and worst for the period.
**Constraint:** loads without a chat prompt, defaults to the last 28 days.

### Comment inbox
**Decision:** which of these needs a human, and what do we say?
**Needs:** comments across channels that expose one, grouped by video, with
sentiment, language, flagged keywords and business-lead signals.
**Actions:** approve/edit/reject an AI-drafted reply; bulk hide and
mark-as-spam where the platform supports it.
**Constraint:** **replies require human approval before sending.** The
draft must never be mistakable for something already sent.

### Topic backlog
**Decision:** what is queued, and who owns it?
**Needs:** adopted topics with owner, target channel, due date.
**Actions:** hand off directly to Script.

**Charts across this module:** time series as lines, channel comparison as
horizontal bars, distribution as a histogram. Every chart states its date
range and its source. *(This is the one place the spec constrains form —
§4.3 — because it is about honesty, not taste.)*

**Done when** the dashboard returns ranked topics for a selected source and
region, the performance screen shows metrics for a published video, and a
comment reply sends only after approval (§9).

---

## Script (§4.4)

**Purpose.** Turn a brief into one authorised script.

**Must support these decisions**
- Does this sound like us?
- Is this the version we agreed?

**Information required**
- Structured brief: topic (or pulled from the backlog), angle, target
  channel, target duration, tone, mandatory points, things to avoid.
- The draft, alongside house-style conformance, flagged terms, estimated
  spoken duration, reading level.
- Diff between any two versions, with author and timestamp.

**Actions**
- Accept or reject each inline suggestion individually.
- Natural-language rewrite of a selection.
- Approve and lock.

**Constraint that shapes everything.** Locking produces *the single
authorised version* and hands it to Video. Locked scripts are read-only;
changes create a new version and require re-approval. The screen must make
locked-ness unmistakable, because Video depends on it.

**Out of scope:** no fine-tuning. House style comes from a prompt template
plus retrieval over approved past scripts (§4.4, contract A7).

**Done when** the module produces a draft from a brief, flags style
deviations, and locks to a single authorised version (§9).

---

## Video Edit (§4.5)

**Purpose.** Get from a locked script to delivered cuts.

**Must support these decisions**
- Which beats still have no footage?
- Is this job stuck, and what did it cost?
- Is this cut better than the last one?

**Information required**
- The locked script, beat by beat, and for each beat a shot with its source
  (existing footage / generated clip / b-roll / still), duration, status.
- Media available to *this employee*, filtered by permission, with type,
  duration, resolution, tags.
- Every generation and render job: state, progress, provider, attempt
  count, cost, and on failure the provider's own error.
- Costs rolled up to the project.

**Actions**
- Assign media to a shot. Retry a failed job. Render to multiple aspect
  ratios. Export with subtitles, audio and covers, archived to the database.
- Choose voice, alternate takes, music, and duck music under voice-over.

**States that must exist**
- Script not yet locked — the project cannot really start.
- Job queued / running / succeeded / failed / cancelled (§6).
- A permanent failure, surfacing the provider error intact.
- Comparison against the previous cut.

**Done when** the module produces a rough cut from a locked script and
renders 16:9, 9:16 and 1:1 with subtitles (§9).

---

## Publish (§4.6)

**Purpose.** Get approved content out, and prove what happened.

**Must support these decisions**
- Can this channel actually publish right now?
- Is this approved?
- Did it land, and if not, is retrying safe?

**Information required**
- Per channel: connection state, granted scopes, audit/verification status,
  remaining quota, last successful publish.
- Per item: master version plus per-channel overrides, with each platform's
  character limits and format rules enforced.
- Per transmission: what went where, when, approved by whom, the platform's
  response, the resulting URL.

**Actions**
- Compose and schedule. Approve, reject with comment, request changes.

**Constraints that shape everything**
- **Nothing leaves the platform without an approval record.**
- Channels connected but **not yet audited** must be marked *with the
  consequence stated* — YouTube ships in draft mode, TikTok via
  upload-to-inbox, until the client passes audit (§7).
- Xiaohongshu, WeChat Channels and Bilibili have no publish interface —
  those get an exported asset pack for manual posting. That is a real user
  journey, not an error state.
- Weibo does not work and is out (§7).

**Done when** an approved item transmits to a connected channel in draft
mode and records the platform response, and separately to X (§9).

---

## Accounting (§4.7)

**Purpose.** A bookkeeping assistant. **Not a ledger of record.**

**Must support these decisions**
- Is this extraction right?
- What is still unprocessed?

**Information required**
- Per document: extracted date, amount, counterparty, line items, tax; a
  suggested account from the client's chart of accounts; **a confidence
  indicator**.
- Bank lines with no matching document, and documents with no matching
  payment.
- Income and expense by account, receivables and payables ageing, count of
  unprocessed documents.

**Actions**
- Confirm or correct each document. Corrections feed future suggestions.
- Export approved entries in the client's designated format.

**Constraint that shapes everything.** Output is drafts for a human
accountant. **Nothing posts anywhere without confirmation.** The screen
must never let a draft read as posted.

**Build note:** one exporter behind an interface — expect more formats.

**Done when** the inbox extracts fields from a receipt, suggests an
account, and the confirmed entry appears in the export file in the
designated format (§9).

---

## Finance (§4.8)

**Purpose.** See what was planned, what was spent, and approve what's next.

**Must support these decisions**
- Are we over?
- Should I approve this?

**Information required**
- Budget lines by department, project and period, against client templates,
  with actuals from *confirmed* accounting entries beside them.
- Forward cash-flow from client-entered inflows and outflows.
- Cost by category over time — **including AI consumption from the token
  ledger**.
- Per request: amount, purpose, attachments, the approver chain determined
  by configurable thresholds, and full history.

**Actions**
- Approve, reject, request more information.

**Constraints**
- Every projection is labelled **indicative**.
- A requester cannot approve their own request.

**Done when** a spend request above a threshold routes to the correct
approver and cannot be approved by the requester (§9).

---

## Legal (§4.9)

**Purpose.** Draft from approved templates; show where an inbound document
departs from our position.

**Must support these decisions**
- Where is this contract different from ours, and how much does it matter?
- What is coming up for renewal?

**Information required**
- Templates with merge fields and a guided intake for the variable parts.
- Per departure: what the template says, what this document says, and a
  short explanation — as a marked-up view *and* a summary list.
- Repository: counterparty, dates, renewal and notice terms, owner, with
  reminders ahead of key dates.
- Recurring compliance items with owners and due dates.

**Constraints that shape everything**
- **Output is never a verdict.** Departures are marked and explained; the
  judgement is the human's.
- A standing disclaimer that the module does not give legal advice is
  **contractually required** (Clause 8.4) and is not optional or dismissible.

**Done when** clause review marks the departures between an uploaded
document and the client's template (§9).

---

## Human Resources (§4.10)

**Purpose.** Leave, recruitment and employee records.

**Gate before anything else.** Every screen sits behind a dedicated `hr`
permission scope. The agent reads HR records **only** when invoked by
someone holding it. This is the sharpest permission boundary in the
product.

**Must support these decisions**
- Can I take this week off? Who is already out?
- Which candidates are worth interviewing?

**Information required**
- Leave: balances, approver routing, team calendar. Types and accrual rules
  are client configuration, not constants.
- Recruitment: requisition and approval chain, drafted job description,
  applications parsed and ranked against the requisition, interview slots,
  structured interview notes.
- Candidates: searchable, **with consent and retention dates**.
- Employees: core record, role, contract reference, onboarding and
  offboarding checklists.

**Hard constraint — contractual (Schedule A3(8)).** No sourcing from
external platforms. The module works only with applications the client
receives and channels the client owns. It does not fetch, scrape or enrich
profiles from LinkedIn or anywhere else. Nothing in the UI may imply
otherwise.

**Done when** a leave request routes to the configured approver and updates
the balance, and an employee without the `hr` scope cannot see any HR
record — directly or through their agent (§9).

---

## Admin (§4.11)

**Purpose.** The client runs the platform without us.

### People and entitlements
**Decision:** what should this person be able to reach?
**Needs:** employees with role, team, status, last active; a matrix of
employee against modules and file groups, editable in place.
**Constraint:** the entitlements matrix is a **top-level screen, not nested
under settings — this is the onboarding path** (§4.11). Where it lives is a
product decision, not a navigation detail.

### Token dashboard
**Decision:** who is spending what, and is it worth it?
**Needs:** consumption over time split by module; per employee — requests,
prompt and completion tokens, cost, trend; per model; filters for person,
team, date range; CSV export.
**Constraint:** figures update in near real time, **with the lag stated** if
aggregation is batched. CSV must match what is on screen.

### Budgets
**Decision:** where do we stop?
**Needs:** caps per employee and per team.
**Constraint:** on reaching a cap the platform **stops consumption** and
notifies both admin and employee. Not a warning — a stop.

### Channels and credentials
**Needs:** connection status, scope inventory, audit state, key rotation
dates.
**Constraint:** **keys are referenced, never displayed** (§8).

### Audit log
**Needs:** filterable by actor, action, resource, date.
**Constraint:** admin file access appears here like any other access. An
admin reading a file they were not granted is logged and visible.

### Knowledge and skills
**Purpose.** The client's own tuning surface — **a contract deliverable**
(Schedule A2(a)) and the thing that replaces most post-handover work.

**Needs:** upload Markdown of four kinds (instructions, style guides,
skills, worked examples), each scoped to tenant, module or employee role;
versions with diff and rollback; active/inactive toggle; every change in
the audit log; **a preview of the assembled system prompt** so an admin can
see what the agent will actually receive.

**The constraint that defines this screen:** *"it has to be usable by a
non-engineer: plain upload, plain toggle, plain rollback."* If a
non-technical admin cannot operate it unaided, it has failed regardless of
how it looks.

**Done when** an admin uploads a style file scoped to Script, the next
draft observes it, the assembled-prompt preview shows the file, and rolling
the file back reverts the behaviour (§9).

---

## Handing this to a design tool

Give the tool three things and nothing else:

1. **The design system** — Espresso (Frappe UI) or Blend. Its tokens and
   components decide colour, type, spacing, density, component anatomy.
2. **The ground rules** above.
3. **One screen's section** from this document.

Then let it design. If it asks what colour something should be, the answer
is in the design system, not here.

**What to push back on in whatever comes out:**
- Does it work for a `member` with two modules, not just the admin?
- Does it work in Traditional Chinese?
- Does an empty or fully-filtered state exist?
- Is the approval step unmistakable, where there is one?
- Does it leak the existence of anything the viewer cannot read?
