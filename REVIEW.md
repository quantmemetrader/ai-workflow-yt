# Market Research: the defect list, and what happened to it

Found by an adversarial review of `lib/social/*`, `app/(app)/research/inbox-actions.ts`
and the two screens, 19 Sep 2026. **All of them are now fixed.** The list is
kept because each fix is only understandable next to the thing it fixed.

Ordered as they were found, worst first.

---

## 1. Approving a reply could send it twice, publicly — **fixed**

The check was a read, the write had no `where sent_at is null`, and there was
nothing between them. Zernio's reply call has a 20-second timeout, so a
producer who saw nothing happen and pressed Approve in a second tab passed the
check twice and posted the same reply twice, in public, as the studio.

The draft is now claimed in the statement that checks it:
`update comment_drafts set sent_at = now() where id = $1 and sent_at is null
returning *`. Whoever's update returns a row owns the send; the other gets
nothing and stops. A failed send hands the claim back with the vendor's words
on it.

## 2. A sent reply could be recorded as a draft still waiting — **fixed**

The database writes sat inside the same `try` as the vendor call, so a database
failure *after* a successful send landed in the catch, cleared `sentAt` and
left a public reply reading as a draft for the next person to approve again.

The vendor call and the bookkeeping are now separate blocks. Past the send,
nothing may undo it: a failure there is logged and reported, and the draft
stays marked sent.

## 3. Zernio's `200 {"success": false}` was treated as a success — **fixed**

A refusal ("comment thread closed", a revoked scope, a deleted post) was
recorded as sent with a null `platformCommentId`. The comment left the inbox
and the customer never got an answer.

The check is in `call()` in `zernio.ts`, the one place every request goes
through, so `replyToComment`, `hideComment` and `moderateComment` are all
covered rather than each remembering separately.

## 4. `/research/inbox?sentiment=anything` was a guaranteed 500 — **fixed**

An unvalidated URL string bound against a `pgEnum` column (`as never` being the
cast that silenced the type error). A typo or a stale bookmark crashed the
route with a Postgres `22P02`.

`isSentiment` now guards it, in the query and on the page, the way
`performance/page.tsx` has always guarded `window`.

## 5. Watch-through could render as "4500.0%" — **fixed**

Two writers, two units, one column: `syncPosts` stored `/analytics`'s
`completionRate` raw and the daily job stored `averageViewPercentage / 100`.
Masked only by the empirical fact that Zernio reports 0 for YouTube — a
coincidence the code relied on and never asserted. Both write a fraction now.

## 6. The KPI tiles and the chart under them were different quantities — **fixed**

The tile summed **lifetime** views of posts published in the window; the chart
summed views **gained during** the window across all posts. On a channel with
history the tile read 1.4M and the chart under it summed to 40k. Neither was
wrong alone; together under one "Last 28 days" chip they were unreadable.

Two tiles now, named for what each is: "Views in window" (what the chart sums)
and "Lifetime views".

## 7. Totals were the top 200 rows, and the count said 200 — **fixed**

`performance()` caps at 200 ordered by views and `performanceTotals` summed
that capped list, so 260 posts in a window reported "Posts: 200" with the sixty
smallest missing — and ran the expensive query twice per render. Totals are one
aggregate over the whole window now.

## 8. Scheduled and failed posts showed as published — **fixed**

`publishedAt` fell back to `scheduledFor` and `status` was read and never used,
so a post scheduled for next Tuesday sorted to the top of Content performance
with a future date and a dash in every column. `channel_posts` carries `status`
and `scheduledFor`, only a published post gets a `publishedAt`, and the
performance query asks for published posts.

## 9. The sync was not idempotent, twice over — **fixed**

- `syncPosts` overwrote the measured watch-through with null because its upsert
  `set` included `completionRate`; the hourly job undid the daily one and "Sync
  now" reproduced it on demand. A null is now left out of the `set`.
- A post was keyed by `platformPostId ?? p._id`, so one ingested while still
  publishing got Zernio's id and the next round got the platform's: two rows,
  two metric series, one video twice. Only the platform's id is a key now, and
  a post without one has not been published.

## 10. Scheduled classification escaped the budget stop — **fixed**

`classifyComments` called `complete()` with no `assertBudget`, so spend was
recorded but not stopped: with the cap exhausted `regenerateDraftAction`
correctly refused every person while this kept billing twenty calls an hour,
unattended. Checked before the batch and again between comments. `budgetState`
takes the three fields it reads, so the service principal can be asked the same
question a person is.

## 11. `servicePrincipal` cached one id across all tenants — **fixed**

A single module-level string meant the first studio the worker touched supplied
the id for every studio after it. Keyed by tenant now.

## 12. Comments past the first 100 were dropped silently — **fixed**

`pagination.hasMore` and `cursor` were typed in `zernio.ts` and never read, so
a video with 400 comments contributed 100 and the inbox reported that as the
whole of it. It pages now, bounded at ten pages. The adjacent re-check of
`commentCount` — a field Zernio has already filtered on, whose absence skipped
every post and reported success with an empty inbox — only skips an explicit
zero.

## 13. Prior-comment counts fanned out per commenter — **fixed**

The comment said "four queries, not forty", but the map was keyed per distinct
handle over up to 300 comments: 260 commenters meant 260 concurrent round trips
to Singapore against a pool of eight. `priorCommentCounts` is one `group by`.

## 14. The provider's error was stored and never shown — **fixed**

`inbox-actions.ts` wrote the vendor's words onto the draft and nothing selected
that column, so three overnight failures left three drafts that looked
untouched. The inbox renders it above the draft.

## 15. "Check now" on Content performance swallowed every failure — **fixed**

`PerfView` discarded the action's `{ error }`, so a refused sync looked exactly
like a successful one. It reports both outcomes now, through the toaster.

## Smaller, and also fixed

- The channels upsert cleared `lastError` unconditionally, erasing the
  per-channel reason written when a post's comments could not be read.
- `discardDraftAction` ignored `rowCount` and reported success for an
  already-sent draft.
- `approveReplyAction` never checked `comment.state`, so a stale draft could
  reply to a comment that had just been hidden.
- `draftsForAction` trusted its parameter's type at a public boundary.

## The thing that was missing rather than wrong

**Trends had no competitor rows.** Zernio can only see the accounts the studio
owns, so "how are we doing against them" had no source at all and the TikHub
key — bought precisely for this — was used by nothing.

There are now `competitors` and `competitor_posts`, a `social.syncCompetitors`
job in the hourly round, and a panel on the Trends dashboard putting the
studio's median views beside each watched channel's. A handle or a URL is
resolved to a channel id once and written back, because `get_channel_videos`
answers an empty list for anything else rather than an error — the worst way
for it to fail.

Proven against the live vendor: `@yafanghk` resolved to
`UCtkINxz2iQYpdW1r0XAnu7A` and returned 30 videos.

## Checked and still clean

- **Tenant scoping.** Every read and write is scoped. The one cross-tenant
  issue was #11 and it is fixed.
- **Vendor calls on a page render.** None. `zernio.ts` and `tikhub.ts` are
  imported by the worker's ingest and the server actions only.
- **Model calls escaping the ledger.** None, and since #10 none escaping the
  stop either.
- **Raw-row coercion.** Every `db.execute` result is coerced properly.
- **Credential leaks.** No key value ever enters an error string.
