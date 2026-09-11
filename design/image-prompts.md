# Screen mockup image prompts

Prompts for generating UI reference images of the Video Agent Platform's
screens, derived from [`01_Build-Spec 2.pdf`](../01_Build-Spec%202.pdf) §4
(Client surfaces). These are visual targets for the frontend, not a
substitute for the spec — where an image and the spec disagree, the spec
wins.

**Design direction:** ERPNext / Frappe UI component language — light, dense,
neutral, one blue accent, real data tables — arranged with Slack's shell
ergonomics: a persistent dark icon rail, a light context sidebar, a main
column, and a right-hand detail panel.

## How to use

1. Copy the **Style block** below.
2. Append one **Screen block**.
3. Render at 16:10, 1600×1000 or larger.

Notes:

- The style block is long on purpose — image models have no memory between
  prompts, so every render needs the full design system restated.
- For Midjourney, cut the style block to the first paragraph plus the colour
  line; it degrades past ~60 words. Nano Banana / GPT-Image / Seedream
  handle the full block and render legible UI text far better.
- **Language:** these prompts specify English UI strings. The product's
  default locale is Traditional Chinese (HK) per spec §4.1, but image models
  garble CJK glyphs badly. Generate in English for layout, then have the
  real components carry `zh-HK` strings. If you want zh-HK mockups anyway,
  add *"all UI text in Traditional Chinese, Hong Kong usage"* to a screen
  block and expect to regenerate several times.
- Keep people, brands and numbers HK-plausible: names like Chan Ka-ming,
  Amy Wong, Leung Chi-hang; amounts in HKD; dates in 2026.

## Suggested render order

If you only generate five, generate these — they set the language every
other screen inherits: **S1 Chat**, **S2 Files**, **S3 Trends dashboard**,
**S14 Entitlements matrix**, **S7 Video project workspace**.

---

## Style block

> A pixel-perfect, flat, front-facing screenshot of a desktop business web
> application, 1600×1000, filling the entire frame. No browser chrome, no OS
> window, no title bar, no device frame, no drop shadow, no background,
> no perspective, no people, no hands, no photographs.
>
> Layout: a 64px-wide dark slate `#161B22` vertical icon rail pinned to the
> far left, holding a small square workspace avatar at top and eight simple
> monochrome line icons in a column, one highlighted with a white rounded
> square. Next to it a 260px light sidebar `#F4F6F8` with a section header in
> 11px uppercase grey letter-spaced text, and a vertical list of navigation
> items in 13px `#3A4652`, the active one on a white pill with a `#2490EF`
> left border. Then the main content column on white `#FFFFFF`. A 1px
> `#E2E5E9` border separates every zone.
>
> Top bar of the main column: 52px tall, white, 1px bottom border, page title
> in 16px semibold `#1F272E` on the left, a centred 420px search field with a
> magnifier icon and grey placeholder, and on the right a bell icon with a
> small red dot, a thin horizontal usage meter, and a 28px circular avatar.
>
> Component language: ERPNext / Frappe UI. Dense data tables with a 36px
> sticky header row in `#F8F9FA`, 11px uppercase grey column labels, 40px
> body rows, 1px `#EDF0F2` row separators, left-aligned text and
> right-aligned tabular numerals. Filter bar above the table with small
> white pill dropdowns, 28px tall, 6px radius, thin `#D8DDE3` borders and a
> chevron. Status shown as a small pill with a coloured dot: blue `#2490EF`,
> green `#48BB74`, amber `#F5A623`, red `#E24C4C`, grey `#8D99A6`. Buttons
> are 30px tall with 6px radius — primary solid `#2490EF` with white text,
> secondary white with a `#D8DDE3` border. Cards are white with a 1px
> `#E2E5E9` border, 8px radius, no shadow.
>
> Typography: Inter, 13px base, 600 weight for headings, `#1F272E` primary
> text, `#6B7A8C` secondary text. Realistic, specific, readable English
> labels and real numbers — never lorem ipsum, never repeated placeholder
> words.
>
> Style: clean, professional, calm, high information density, generous
> internal padding, a single blue accent against neutrals. Enterprise
> software, not a marketing page.
>
> Negative: no gradients, no glassmorphism, no neon, no dark mode, no 3D, no
> isometric view, no large rounded corners, no drop shadows, no illustration,
> no mascot, no stock photography, no mobile layout, no floating cards, no
> blurred text.

Every screen block below assumes the eight-item icon rail is
Chat · Files · Research · Script · Video · Publish · Back-office · Admin.

---

## S1 — Chat (spec §4.2)

> Sidebar titled "CHAT", listing recent conversations with one-line
> previews and timestamps, plus a "New conversation" button at the top; the
> Chat rail icon is active. Main column is a conversation thread: a user
> message in a light grey bubble asking to compare last month's Cantonese
> shorts against the 16:9 cuts, then a long assistant response as plain
> flowing text on white with a small square agent avatar, containing a short
> paragraph, a three-column comparison table, and two inline citation chips
> reading "Q3-performance-export.csv" and "shorts-brief-v4.md" underlined in
> `#2490EF`. Above the response, a collapsed tool-call strip: a thin bordered
> row reading "Ran Market Research · read 3 files" with a chevron and a small
> green check. Below the thread, a composer box with a 1px border, a
> placeholder, a paperclip icon, a small model-name pill, and a blue send
> button. On the right, a 340px "Sources" panel listing four file cards, each
> with a file-type icon, filename, folder path in grey, and a small
> permission label. A thin blue progress line at the very top of the main
> column indicates streaming.

## S2 — Files / database browser (spec §3, §4.1)

> Sidebar titled "DATABASE" showing a collapsible folder tree — 2026-Q3-
> campaign expanded with child folders Footage, Scripts, Renders, Exports —
> with disclosure triangles and small folder icons. Main column: breadcrumb
> "Database / 2026-Q3-campaign / Renders", a filter bar with pill dropdowns
> for Type, Owner, Modified and Tag plus a blue "Upload" button, then a dense
> file table with columns Name, Kind, Size, Version, Owner, Modified,
> Access. Rows show video, script, report and asset files with a leading
> checkbox and file-type icon; Kind shows small grey pills; Version shows
> "v3", "v1"; Access shows pills reading Owner, Editor, Viewer in blue,
> green and grey. One row is selected and highlighted very pale blue. On the
> right, a 360px detail panel for the selected video file: a 16:9 thumbnail
> placeholder as a flat grey rectangle, filename, a metadata list of
> resolution, duration, checksum and storage key in monospace, a "Shared
> with" list of three avatars with role labels, and a version history list of
> three entries with author and timestamp.

## S3 — Market Research: trends dashboard (spec §4.3)

> Sidebar titled "MARKET RESEARCH" with items Trends, Search & compare,
> Content performance, Comment inbox, Topic backlog — Trends active. Main
> column top: a filter bar with pill dropdowns reading "Sources: GDELT,
> YouTube", "Region: HK / TW / SG" and "Last 14 days". Below it, a
> three-column grid of six ranked topic cards. Each card: a rank number in
> grey, a bold topic headline, a heat score as a large number with a small
> blue horizontal bar beneath, a 60×24px momentum sparkline drawn as a thin
> blue line, one line of grey summary text, two small grey "suggested angle"
> pills, a row of two source links underlined in blue, and a footer row with
> three small buttons — Adopt (blue solid), Reject (white outline), Save. One
> card carries a small amber pill reading "Sensitive · political figure"
> above its headline. Cards are white with 1px borders, evenly spaced, no
> shadows.

## S4 — Market Research: content performance (spec §4.3)

> Sidebar as in S3, Content performance active. Main column: filter bar with
> pills reading "Channel: All", "Last 28 days", "Campaign: 2026-Q3", and a
> secondary "Export" button. A row of four flat stat tiles across the top,
> each a bordered white card with an 11px uppercase grey label, a large
> tabular number, and a small green or red delta — Views 1,284,300;
> Watch-through 41.2%; Engagement 6.8%; Comments 3,912. Below, a wide line
> chart on white: two thin lines, one `#2490EF` and one `#8D99A6`, a light
> `#EDF0F2` horizontal grid, dated x-axis labels, a small top-left legend, and
> a caption underneath reading "28 Jul – 24 Aug 2026 · source: YouTube Data
> API". Beneath the chart, a dense table of published videos with columns
> Video, Channel, Published, Views, Watch-through, Engagement, Comments;
> Channel shown as small grey pills reading YouTube, Instagram, LinkedIn;
> percentage columns right-aligned with tabular numerals.

## S5 — Market Research: comment inbox (spec §4.3)

> Sidebar as in S3, Comment inbox active. Main column split in two. Left
> 380px list: filter pills for Sentiment, Language, Flagged and
> Business-lead, then comment rows grouped under bold video-title headers,
> each row showing a 24px circular avatar, a username, one line of comment
> text truncated, a timestamp, and small pills — a green "Positive", an amber
> "Flagged", a blue "Lead". One row selected on pale blue. Right side: the
> selected comment reproduced in full at the top in a bordered grey box with
> channel and video metadata, then a section labelled "AI-suggested reply" —
> an editable text box with a 1px border containing two sentences of draft
> reply, a small grey note beneath reading "Draft · requires approval before
> sending", and an action row with a blue "Approve & send" button, a white
> "Edit" button, and text links for Hide and Mark as spam. Bottom right, a
> small bordered panel listing three bulk actions with checkboxes.

## S6 — Script: split editor (spec §4.4)

> Sidebar titled "SCRIPT" with items Brief intake, Drafts, Version history,
> Approvals — Drafts active. Main column top bar shows the script title, a
> grey "v4 · Draft" pill, and on the right a white "Compare versions" button
> and a blue "Approve & lock" button. Below, a two-pane split. Left pane:
> the script draft as flowing editable text on white with a numbered beat
> structure, roughly eight paragraphs, three phrases underlined with a wavy
> amber line and one highlighted pale yellow. Right pane, 380px, titled
> "Style": a house-style conformance score shown as a large number over 100
> with a thin blue progress bar; a "Flagged terms" list of four entries, each
> with the term in bold, a one-line grey reason, and small Accept / Reject
> buttons; then two small stat rows reading "Estimated spoken duration 3 min
> 48 s" and "Reading level Grade 8". Floating above the left pane's
> selection, a small bordered command bar with a text input reading "Rewrite
> this section more conversationally" and a blue arrow button.

## S7 — Video Edit: project workspace (spec §4.5)

> Sidebar titled "VIDEO EDIT" with items Projects, Media bin, Render queue,
> Exports — Projects active. Main column in three vertical panes. Left 300px:
> the locked script, a grey "Locked · v4" pill at the top, then read-only
> numbered beats in small text, one beat highlighted. Centre: a "Shot list"
> header with a count, then a vertical column of eight shot cards; each card
> is white with a 1px border, an 80×45px flat grey thumbnail on the left, a
> beat title, a source pill reading "Existing footage", "Generated clip",
> "B-roll" or "Still", a duration like "0:06", and a status dot — green
> assigned, amber pending, grey empty. One card is mid-drag with a dashed
> blue outline. Right 320px: the media bin, with type and duration filter
> pills and a scrolling list of file rows each showing a small thumbnail,
> filename, resolution and duration. Bottom of the centre pane: a compact
> preview player with a scrub bar, a subtitle line overlaid on the frame, and
> three aspect-ratio toggle buttons reading 16:9, 9:16, 1:1 with 16:9
> selected.

## S8 — Video Edit: render queue (spec §4.5, §6)

> Sidebar as in S7, Render queue active. Main column: filter bar with pills
> for State, Provider and Project, and a right-aligned grey line reading
> "Project cost to date: HK$412.80". A dense job table with columns Job,
> Type, State, Progress, Provider, Attempts, Cost, Requested by, Started.
> Rows show a mix of states as pills — blue "Running" with a thin blue
> progress bar in the Progress column at 62%, green "Succeeded", grey
> "Queued", red "Failed". Type column shows small grey pills reading
> Generation, Transcription, Render, Assembly. Provider column reads Veo 3.1
> Fast, Azure Speech, FFmpeg, ElevenLabs. One failed row is expanded into a
> pale red inset panel showing a monospace provider error string, a
> "Attempt 3 of 3" note, and a white "Retry" button. Numbers right-aligned
> and tabular throughout.

## S9 — Publish: channel board and approval queue (spec §4.6)

> Sidebar titled "PUBLISH" with items Channels, Composer, Approvals, Publish
> log — Channels active. Main column top: a four-column grid of seven channel
> cards for YouTube, Instagram, Facebook, LinkedIn, WeChat Official Account,
> TikTok and X. Each card is white with a 1px border and holds a small
> monochrome channel glyph, the channel name in semibold, a connection pill
> — green "Connected", amber "Connected · audit pending", grey "Not
> connected" — a two-line grey list of granted scopes, a thin quota bar with
> a "Quota 82% remaining" label, and a last-publish timestamp. The TikTok and
> YouTube cards carry an amber inset strip reading "Audit pending — publishes
> to draft only". Below the grid, a section header "Awaiting approval" and a
> table with columns Item, Channels, Approver, Requested, State; the Channels
> column shows two or three small channel glyphs stacked; State shows amber
> "Pending" pills; the rightmost column of each row has small Approve,
> Reject and Request changes buttons.

## S10 — Accounting: document inbox (spec §4.7)

> Sidebar titled "ACCOUNTING" with items Document inbox, Draft entries,
> Period summary, Export — Document inbox active. Main column split. Left
> 420px: a list of uploaded documents, each row with a small document icon,
> a counterparty name, an amount in HKD right-aligned, a date, and a
> confidence pill — green "High", amber "Review" — one row selected on pale
> blue. Right side: a two-column detail view. Left half shows a flat grey
> rectangle standing in for a scanned receipt image with a few thin grey
> lines suggesting text and two thin blue rectangles drawn around extracted
> regions. Right half shows an extraction form with labelled fields — Date,
> Amount, Counterparty, Tax, Line items — each an input with a 1px border and
> a small percentage confidence figure in grey to its right; then a
> "Suggested account" row showing a dropdown reading "6120 · Production
> equipment" with a small amber "82% confidence" pill; then a line-items
> table with three rows; then an action row with a blue "Confirm" button and
> a white "Correct" button. A grey banner at the top of the main column
> reads "Drafts only — nothing posts without confirmation".

## S11 — Finance: spend requests and cost dashboard (spec §4.8)

> Sidebar titled "FINANCE" with items Budget, Cash-flow, Cost dashboard,
> Spend requests, Reports — Spend requests active. Main column top: four flat
> stat tiles reading Committed HK$1,840,000; Actual HK$1,204,500; Variance
> −12.4% in green; Open requests 9. Below, a wide stacked bar chart of cost
> by category over eight months, bars in `#2490EF` and three neutral greys,
> a light horizontal grid, a small legend including a segment labelled "AI
> consumption", and a source caption underneath. Beneath the chart, a spend
> request table with columns Request, Department, Amount, Approver chain,
> State, Requested. The Approver chain column renders as two or three small
> circular avatars connected by thin grey arrows, one ringed blue as the
> current approver. State shows pills reading "Awaiting CFO" in amber,
> "Approved" in green, "More info requested" in grey. Amounts right-aligned
> and tabular.

## S12 — Legal: clause review (spec §4.9)

> Sidebar titled "LEGAL" with items Drafting, Clause review, Repository,
> Compliance — Clause review active. A persistent grey disclaimer bar spans
> the top of the main column reading "This module does not provide legal
> advice." Below it, a two-pane split. Left pane: an uploaded contract
> rendered as flowing document text with numbered clauses, four passages
> highlighted — two pale amber, one pale red, one pale grey — each with a
> small numbered marker in the left margin. Right pane, 400px, titled
> "Departures from template": four expandable cards, each with a numbered
> badge matching a margin marker, a clause name in semibold, a severity pill
> — amber "Deviation", red "Missing", grey "Additional" — a short grey
> explanation paragraph, and a two-column mini-diff showing "Template" and
> "This document" as short quoted lines with the differing words underlined.
> No verdict, no score, no traffic-light summary anywhere on the screen.

## S13 — HR: leave (spec §4.10)

> Sidebar titled "HUMAN RESOURCES" with items Leave, Recruitment, Candidates,
> Employee records — Leave active, and a small grey lock icon beside the
> section header. Main column: three flat stat tiles reading Annual leave
> remaining 11.5 days; Pending approvals 4; Team out today 2. Below, a
> horizontal team calendar — employee names in a left column of eight rows,
> dates across the top for one month, and coloured horizontal bars spanning
> date ranges: blue for annual leave, amber for pending, grey for public
> holiday, with a light vertical grid and today marked by a thin blue
> vertical line. Beneath the calendar, a leave request table with columns
> Employee, Type, Dates, Days, Approver, State; State shows amber "Pending",
> green "Approved", grey "Cancelled" pills. Top right of the main column, a
> blue "Apply for leave" button.

## S14 — Admin: entitlements matrix (spec §4.11)

> Sidebar titled "ADMIN" with items People, Entitlements, Tokens, Budgets,
> Channels, Audit log, Knowledge — Entitlements active. Main column: a filter
> bar with pill dropdowns for Team, Role and Status, a search field, and a
> blue "Add employee" button. Then a wide matrix table: a frozen left column
> of twelve employees, each cell showing a 24px circular avatar, a name, and
> a small grey role label reading admin, builder, member or guest. Across
> the top, two grouped header bands — "MODULES" spanning eight narrow
> columns labelled Research, Script, Video, Publish, Accounting, Finance,
> Legal, HR, and "FILE GROUPS" spanning four columns labelled Production,
> Campaign 2026-Q3, Finance, HR Confidential. Every cell contains a small
> checkbox: filled blue with a white tick when granted, empty grey when not.
> The HR column has only two ticks. One cell is mid-edit with a blue focus
> ring. A guest row is visually dimmed with a small amber pill in its name
> cell reading "Expires 30 Sep".

## S15 — Admin: token dashboard (spec §4.11)

> Sidebar as in S14, Tokens active. Main column: filter bar with pill
> dropdowns for Person, Team, Module and a date range reading "1 – 31 Aug
> 2026", plus a white "Export CSV" button. A wide multi-line chart of
> consumption over time, one `#2490EF` line and four neutral grey lines, a
> light horizontal grid, a legend naming eight modules, and a small grey
> caption underneath reading "Updated 4 minutes ago · aggregation lag under 5
> minutes". Below, two panels side by side. Left, wider: a by-employee table
> with columns Employee, Requests, Prompt tokens, Completion tokens, Cost,
> Trend — the Trend column holding tiny 48px sparklines, all numbers
> right-aligned and tabular, costs in HK$. Right, 360px: a by-model
> breakdown as a list of eight rows, each with a model name in monospace —
> gemini-2.5-pro, deepseek-v3, qwen-max, glm-4.6, kimi-k2 — a thin horizontal
> proportion bar, a percentage and a cost. One employee row shows a small red
> pill reading "94% of cap".

## S16 — Admin: knowledge and skills area (spec §4.11)

> Sidebar as in S14, Knowledge active. Main column split in two. Left 480px:
> a filter bar with pill dropdowns reading "Kind: All" and "Scope: All", a
> blue "Upload Markdown" button, and a table of knowledge files with columns
> File, Kind, Scope, Version, Active, Updated. Kind shows small pills reading
> Instruction, Style, Skill, Example in four distinct neutral tones; Scope
> reads "Tenant", "Module · Script", "Role · Editor"; Active is a small
> toggle switch, blue when on, grey when off, with one row toggled off and
> its text dimmed; Version reads "v6", "v2" with a small grey clock icon
> linking to history. Right side: a panel titled "Assembled system prompt ·
> Script module" showing a monospace preview on a very pale grey background
> with four labelled section dividers reading "— instructions —", "— style
> —", "— skills (retrieved) —", "— examples (retrieved) —", roughly twenty
> lines of realistic prompt text, and a footer strip reading "4,180 of 8,000
> token budget" with a thin blue fill bar. Above the preview, a small row of
> buttons reading Diff, Roll back and View audit entry.

---

## Coverage against the spec

| Spec section | Screen |
| --- | --- |
| §4.1 Shell | present in every screen |
| §4.2 Chat | S1 |
| §3 / §4.1 Database | S2 |
| §4.3 Market Research | S3, S4, S5 (Search & compare and Topic backlog not drawn) |
| §4.4 Script | S6 (Brief intake and Version history not drawn) |
| §4.5 Video Edit | S7, S8 (Audio panel and Export not drawn) |
| §4.6 Publish | S9 (Composer and Publish log not drawn) |
| §4.7 Accounting | S10 (Draft entries, Period summary, Export not drawn) |
| §4.8 Finance | S11 (Budget, Cash-flow, Reports not drawn) |
| §4.9 Legal | S12 (Drafting, Repository, Compliance not drawn) |
| §4.10 HR | S13 (Recruitment, Candidates, Employee records not drawn) |
| §4.11 Admin | S14, S15, S16 (Channels and Audit log not drawn) |

The undrawn screens reuse the patterns established above — list view, split
detail, approval table, form intake — and can be prompted by swapping the
domain content of the nearest sibling block.
