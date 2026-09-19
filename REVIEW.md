# Known defects in the social module (Market Research)

Found by an adversarial review of `lib/social/*`, `app/(app)/research/inbox-actions.ts`
and the two new screens, 19 Sep 2026. **None of these is fixed.** They are
written down here so they are not lost.

Ordered by how much damage they do. The first four are the ones that matter.

---

## 1. Approving a reply can send it twice, publicly

`app/(app)/research/inbox-actions.ts:98` reads `draft.sentAt`, `:111` calls
Zernio, `:117` writes `sentAt`. The check is a read, the write has no
`where sent_at is null`, and there is no transaction. The file header claims
the invariant is "enforced in three places"; none of the three is atomic.

**How it happens:** Zernio's reply call is slow (the timeout is 20s). The
producer clicks Approve, sees nothing, clicks again in another tab — the
disabled state is per-tab React state. Both pass the check, both POST, two
identical replies appear under the video, as the studio.

**Fix shape:** claim the draft first —
`update comment_drafts set sent_at = now() where id = $1 and sent_at is null returning *`
— and only call Zernio if a row came back.

## 2. A reply that *was* sent can be recorded as a draft still waiting

Same file, `:143`. The `try` wraps both the vendor call and the three database
writes, so a database failure *after* a successful send lands in the catch,
which leaves `sentAt` null. `inbox()` then renders the draft as waiting, under
a comment still `open`, and the next person approves it again.

This is the inverse of the stated invariant: not a draft that reads as sent,
but a **sent reply that reads as a draft**. Same public double-reply.

## 3. Zernio's `200 {"success": false}` is treated as a success

`lib/social/zernio.ts:89` throws only on `!res.ok`. `replyToComment` is typed
with `success?: boolean` and no caller reads it. A refusal ("comment thread
closed") is recorded as sent with a null `platformCommentId`, the comment
leaves the inbox, and the customer never gets an answer.

`lib/social/tikhub.ts:70` handles exactly this pattern. `zernio.ts` should too.
Same hole in `hideComment` and `moderateComment`: a comment is marked hidden
locally while still public.

## 4. `/research/inbox?sentiment=anything` is a guaranteed 500

`lib/social/service.ts:272` binds an unvalidated URL string against a
`pgEnum` column (`as never` is the cast that silenced the type error), and
`app/(app)/research/inbox/page.tsx:34` applies no allow-list. A typo or a
stale bookmark crashes the route with `22P02`.

`performance/page.tsx:23` validates `window` with `isWindow`. Do the same here.

---

## 5. Watch-through can render as "4500.0%"

Two writers, two units, one column. `ingest.ts:197` stores `/analytics`'s
`completionRate` raw; `:293` stores `averageViewPercentage / 100`. The column
is documented as a 0..1 fraction and `PerfScreen` multiplies by 100.

Currently masked only by the empirical fact that `/analytics` reports 0 for
YouTube — a coincidence the code relies on and never asserts.

## 6. The KPI tiles and the chart under them are different quantities

`service.ts:117` sums **cumulative lifetime** views for posts published in the
window. `viewsSeries:181` sums **views gained in the window** across all posts.
Both sit under the same "Last 28 days" chip.

On a channel with history: the tile reads 1.4M, the chart under it sums to 40k.
Neither is wrong alone; together they are unreadable. The Watch-thru column has
the same problem (a lifetime average in a window-scoped table).

## 7. Totals are the top 200 rows, and the count says 200

`service.ts:146` caps at 200 ordered by views; `performanceTotals:197` sums
that capped list. 260 posts in a 90-day window → "Posts: 200" and totals
missing the 60 lowest. Nothing says so. The page also runs this expensive
query twice per render.

## 8. Scheduled and failed posts show as published

`ingest.ts:162` falls back to `scheduledFor` for `publishedAt`, and `status` is
read but never used. A post scheduled for next Tuesday sorts to the top of
Content performance with "—" in every column.

## 9. The sync is not idempotent, twice over

- `syncPosts` overwrites today's measured watch-through with null, because its
  upsert `set` includes `completionRate` (`ingest.ts:203`). The hourly job
  undoes the daily job. "Sync now" reproduces it on demand.
- `ingest.ts:148` keys a post by `platformPostId ?? p._id`. A post ingested
  while still publishing gets Zernio's id; the next round gets the platform's.
  Two rows, two metric series, one video appearing twice.

The module header's claim that "running it twice is the same as running it
once" does not hold.

## 10. Scheduled classification escapes the budget stop

`ingest.ts:519` calls `complete()` with no `assertBudget`. Spend is *recorded*
but not *stopped*. With the cap exhausted, `regenerateDraftAction` correctly
refuses every user while `classifyComments` keeps billing 20 calls an hour.

`regenerateDraftAction:219` does it correctly; copy that.

## 11. `servicePrincipal` caches one id across all tenants

`lib/authz/service-principal.ts:31` — the cache is not keyed by tenant, so the
worker can attribute tenant B's spend to tenant A's user. Latent only because
`ingest.ts:32` hardcodes "the first tenant" for everything, which is its own
bug: `syncNowAction` enqueues with `viewer.tenantId` and every handler ignores
it.

## 12. Comments past the first 100 on a post are dropped silently

`ingest.ts:378` requests 100 and never reads `pagination.hasMore` / `cursor`,
which `zernio.ts:313` types. A video with 400 comments contributes 100, and
the inbox reports that as the whole of it.

Adjacent: `ingest.ts:338` re-checks `commentCount`, a field Zernio already
filtered on. If it is ever absent, every post is skipped and the round reports
success with zero comments — the same silent-empty-inbox failure the code
comments say was already hit once.

## 13. Prior-comment counts fan out to one query per commenter, per render

`app/(app)/research/inbox/page.tsx:58` — the comment claims "four queries, not
forty", but the map is keyed per distinct handle over up to 300 comments. 260
commenters means 260 concurrent round trips to Singapore against a pool of 8.
One `group by author_handle` returns the same data.

## 14. The provider's error is stored and never shown

`inbox-actions.ts:147` writes the vendor's words onto the draft. Nothing
selects that column and no screen renders it. Three overnight failures leave
three drafts that look untouched.

## 15. "Check now" on Content performance swallows every failure

`components/research/PerfView.tsx:93` discards the action's `{ error }`.
`InboxView.tsx:138` handles the same action correctly.

---

## Smaller, substantiated

- `ingest.ts:104` — the channels upsert clears `lastError` unconditionally,
  erasing the per-channel reason written at `:386`.
- `inbox-actions.ts:264` — discard-then-insert in `regenerateDraftAction` is
  not in a transaction; a failure between them leaves no draft at all.
- `inbox-actions.ts:125` — sets `sentAt` even when Zernio returned no id,
  contradicting the schema comment and making reconciliation impossible.
- `inbox-actions.ts:100` — `approveReplyAction` never checks `comment.state`,
  so a stale draft can reply to a comment that was just hidden.
- `inbox-actions.ts:189` — `discardDraftAction` ignores `rowCount` and reports
  success for an already-sent draft.
- `service.ts:136` — only YouTube posts can ever show watch-through, because
  `views_day` is only written for YouTube.
- `service.ts:523` — `postSeries` maps null to a drawn zero, the exact mistake
  `viewsSeries` avoids. No callers today.
- `inbox-actions.ts:383` — `draftsForAction` trusts its parameter's type at a
  public boundary. No callers today.

## Checked and clean

- **Tenant scoping.** Every read and write is scoped, directly or through a
  tenant-scoped id resolution. `post_metrics` has no `tenant_id` but is only
  reached through a scoped join. The only cross-tenant issue is #11.
- **Vendor calls on a page render.** None. `zernio.ts` and `tikhub.ts` are
  imported by exactly two files: the worker's ingest and the server actions.
  Both pages read only `service.ts`, which is pure SQL.
- **Model calls escaping the ledger.** None. Both `complete()` call sites
  record usage. The gap is the budget *stop*, not the meter (#10).
- **Raw-row coercion.** Every `db.execute` result is coerced properly
  (`numOrNull`, `Number(...)` on `::bigint`, `::text` before `new Date`). The
  class of 500 that has bitten this codebase twice is not present. The one
  crash from real input is the enum in #4, a different mechanism.
- **Credential leaks.** No key value ever enters an error string. Vendor
  errors do reach the client by design (spec §6) and can name a route shape or
  an env var name to anyone holding the `research` module.
