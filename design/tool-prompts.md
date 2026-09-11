# Prompts for Figma, Framer and Claude Design

Three tools, three different inputs. The screens are the same; what each
tool wants from you is not.

| Tool | Feed it | Get back | Best for |
| --- | --- | --- | --- |
| Claude Design | a brief, in chat | editable artboards on a canvas | settling layout and density fast |
| Figma (First Draft / Make) | a screen brief + a design-system description | editable Figma layers | handing to a designer, component libraries |
| Framer (AI / Workshop) | a screen brief + a style description | a responsive published site | clickable demo, client walkthrough |

The canvas at `design/canvas/` is already built. What follows is for
the other two — plus the design-system block all three share.

---

## The design system (paste first, every time)

Every prompt below assumes this. Figma and Framer both do better when
the system is stated before the screen.

> **Product:** an internal work platform for a Hong Kong video media
> company. Desktop only, 1600×1000. Dense, professional, calm — closer
> to ERPNext or Linear's settings pages than to a marketing site.
>
> **Shell:** a 64px dark slate `#161B22` icon rail on the far left with
> 8 stacked icon+label items, one active on a white rounded square; then
> a 260px light `#F4F6F8` context sidebar with an uppercase 10.5px
> section header and 30px nav rows, the active row a white pill with a
> 2px accent left border; then the white content column; some screens
> add a 340–360px right detail panel on `#FBFCFD`. 1px `#E2E5E9`
> borders between zones.
>
> **Top bar:** 52px, white, 1px bottom border. Page title 15px/600 left,
> a 420px search field centred, and on the right a bell with a red dot,
> a 76px usage meter bar, and a 28px circular avatar.
>
> **Colour:** background `#FFFFFF`, sidebar `#F4F6F8`, panel `#FBFCFD`,
> table header `#F8F9FA`, border `#E2E5E9`, row divider `#EDF0F2`, text
> `#1F272E`, secondary `#6B7A8C`, tertiary `#8D99A6`. One accent,
> `#2490EF`. Semantic: green `#48BB74`, amber `#F5A623`, red `#E24C4C`.
>
> **Type:** IBM Plex Sans — 13px body, 12.5px table cells, 15px/600 page
> titles, 10.5px/600 uppercase 0.07em section labels. IBM Plex Mono for
> storage keys, model names and role slugs. Tabular numerals in every
> numeric column.
>
> **Components:** tables with a 36px sticky header, 42px rows, 1px row
> dividers, right-aligned numerics. Filter pills 28px tall, 6px radius,
> 1px `#D8DDE3` border, white, with a chevron. Status pills 20px tall,
> 10px radius, a 5px coloured dot plus a label. Buttons 30px tall, 6px
> radius — primary solid accent with white text, secondary white with a
> border. Cards white, 1px border, 8px radius, no shadow.
>
> **Rules:** no gradients, no glassmorphism, no dark mode, no large
> radii, no drop shadows, no emoji, no illustration. Icons are
> stroke-based line icons on a 24px grid at 1.6 stroke width.

---

## Figma

Figma's AI generates a first pass you then take apart. Two things matter:
give it the system before the screen, and ask explicitly for auto layout
and components, or you get a flat pile of rectangles.

### Setup prompt — run this once

> Create a design system page for a dense desktop enterprise web app.
> Build these as reusable components with variants and auto layout:
>
> 1. **Button** — variants primary / secondary / ghost, each 30px tall,
>    6px radius, 12px horizontal padding, 12.5px/500 label, optional
>    13px leading icon.
> 2. **Filter pill** — 28px tall, 6px radius, 1px `#D8DDE3` border,
>    white fill, 12px label, trailing chevron. Variants: default,
>    active (accent fill, white label), removable (trailing ✕).
> 3. **Status pill** — 20px tall, 10px radius, a 5px dot plus an 11px
>    label. Variants blue / green / amber / red / grey, using
>    `#2490EF` `#48BB74` `#F5A623` `#E24C4C` `#8D99A6` on 6%-tint fills.
> 4. **Table row** — 42px tall, horizontal auto layout, 12px cell
>    padding, 1px `#EDF0F2` bottom border. Variants default, hover,
>    selected (6% accent fill plus a 2px accent inset left edge).
> 5. **Table header row** — 36px, `#F8F9FA`, 10.5px/600 uppercase
>    0.06em `#6B7A8C` labels.
> 6. **Nav row** — 30px, 6px radius, 12.5px label, optional trailing
>    count badge. Variants default and active (white fill, 2px accent
>    left border, `#1F272E` 500 label).
> 7. **Rail item** — 48×48, 8px radius, a 19px line icon over an 8.5px
>    label. Variants default (`#8D99A6` on `#161B22`) and active (white
>    fill, `#1F272E` icon).
> 8. **Card** — white, 1px `#E2E5E9`, 8px radius, 15px padding, vertical
>    auto layout with a 11px gap.
> 9. **Avatar** — 24px and 28px circles, `#DBE2E8` fill, 9.5px/600
>    `#4A5763` initials.
> 10. **Stat tile** — bordered card with a 10.5px uppercase label, a
>     22px/600 tabular number, and a small green or red delta.
>
> Set up colour styles for the palette above and text styles for the
> type ramp above. Everything on auto layout.

### Screen prompts — one per screen

Prefix each with the design system block, then:

**Chat**

> A chat screen. Left rail active on Chat; sidebar titled CHAT with a
> full-width accent "New conversation" button and conversation rows
> grouped under TODAY and EARLIER, each row a title, a one-line grey
> preview and a right-aligned timestamp. Main column: a centred 760px
> thread — a right-aligned grey user bubble, then a bordered tool-call
> strip reading "Ran Market Research · read 3 files · 4.2 s" with a
> green check and a chevron, then an assistant response as plain text
> with a 28px dark square avatar, containing a paragraph, a bordered
> three-column comparison table, a second paragraph, and two accent
> citation chips. A composer at the bottom with a 9px radius border, a
> paperclip, a monospace model pill and a 30px accent send button. Right:
> a 340px Sources panel with four file cards, each showing a file icon,
> filename, folder path, a permission pill and a small note, and a
> closing line reading "Filtered to what you can read. Two files matched
> this query and were withheld."

**Database browser**

> A file browser. Sidebar is a folder tree with disclosure chevrons,
> 2026-Q3-campaign expanded to Footage, Scripts, Renders, Exports, with
> Renders active. Main column: a breadcrumb, a filter bar with four
> pills and an accent Upload button, then a table with columns Name,
> Kind, Size, Version, Owner, Modified, Access — a leading checkbox
> column, file-type line icons, grey kind pills, tabular numerals, and
> Access as blue Owner / green Editor / grey Viewer pills. The first row
> is selected. Right: a 360px detail panel with a 16:9 flat grey
> thumbnail carrying a duration chip, the filename, a metadata list
> (resolution, duration, MIME, bytes, checksum, storage key — the last
> three monospace), a "Shared with" list of three avatar rows with role
> labels and a Manage sharing button, and a three-entry version history.

**Trends dashboard**

> A research dashboard. Sidebar lists Trends dashboard (active), Search
> & compare, Content performance, Comment inbox with a red 27 badge, and
> Topic backlog; below it a "Connected sources" list with green and
> amber status dots. Main column: a filter bar with pills reading
> "Sources: GDELT, YouTube", "Region: HK / TW / SG" and "Last 14 days",
> a right-aligned refresh timestamp and a Refresh button. Then a
> three-column grid of six topic cards. Each card: a rank number, a
> large heat score, a bold headline, a thin accent progress bar beside a
> 60×22px sparkline, a grey summary line, two grey angle pills, two blue
> source links, and a footer of Adopt (accent solid), Reject (outline)
> and a bookmark icon button. The third card carries an amber inset
> banner reading "Sensitive · named public official" above its rank.

**Video project workspace**

> A three-pane video editing workspace. Sidebar lists Projects (active),
> Media bin, Render queue with a badge, Exports; then active projects;
> then a project cost card showing HK$412.80 against a cap with a
> progress bar. Main top bar: project name, a grey "Rough cut" status
> pill, a Compare cuts button and an accent Export all formats button.
> Left pane 300px: the locked script, a "v4" lock chip, and eight
> numbered beats in small grey text, one highlighted with an accent left
> border. Centre: a Shot list header with counts, then eight shot cards
> — an 80×45 flat grey thumbnail, a title, a source pill (green Existing
> footage / accent Generated clip / purple B-roll / grey Still or
> Unassigned), a duration, and a status dot. One card is mid-drag with a
> 2px dashed accent border on a tinted fill. Below: a preview strip with
> a 232×130 frame, a subtitle chip, a scrub bar with an accent fill and
> handle, and 16:9 / 9:16 / 1:1 aspect toggles with 16:9 active. Right
> 320px: a media bin with filter pills and nine file rows, each a 52×30
> thumbnail, filename and resolution/duration.

**Entitlements matrix**

> An admin permissions matrix. Sidebar lists People, Entitlements
> (active), Token dashboard, Budgets, Channels & credentials, Audit log,
> Knowledge & skills; below it platform roles as monospace labels with
> counts; at the bottom an amber note card reading "Every change here is
> written to the audit log with your name." Main column: a filter bar
> with Team, Role and Status pills, an employee filter field, an
> "Unsaved: 1 change" label, Discard and accent Add employee buttons.
> Then a matrix: a 236px frozen left column of twelve employees, each an
> avatar plus a name plus a monospace role slug; a grouped header band
> with MODULES spanning eight columns and FILE GROUPS spanning four;
> a column header row; and twelve 42px rows of centred 15px checkboxes,
> accent-filled with a white tick when granted, empty grey when not. The
> HR column has two ticks and an amber label. One row is tinted with a
> focused cell showing a 2px accent ring. The last row is a dimmed guest
> with an amber "Expires 30 Sep" chip. A 46px footer strip carries the
> counts and the last-change attribution.

### After Figma generates

Expect to fix three things every time: it flattens auto layout on
nested rows, it substitutes its own type scale, and it rounds your
spacing to 4px. Rebind text styles first, then re-apply auto layout on
the row components — everything downstream inherits from those.

---

## Framer

Framer wants a site, not a screen. It responds better to purpose and
behaviour than to pixel values, so lead with what the screen is for and
let the system block constrain the look.

### Style prompt — set this in the project first

> A dense desktop enterprise application UI. Light, neutral, calm. Ground
> `#FFFFFF` with `#F4F6F8` sidebars and `#F8F9FA` table headers. One
> accent, `#2490EF`. Text `#1F272E` primary, `#6B7A8C` secondary. IBM
> Plex Sans throughout, 13px body, IBM Plex Mono for identifiers. 6px
> radii, 1px `#E2E5E9` borders, no shadows, no gradients, no dark mode.
> Stroke line icons only. Desktop-first at 1600px — no mobile breakpoint.

### Screen prompts

Framer's generator works best one screen at a time with the behaviour
named. Prefix each with the style prompt.

**Chat**

> Build a three-column chat workspace for an internal AI work platform.
> Far left: a 64px dark `#161B22` icon rail with eight icon-and-label
> items, Chat active on a white square. Then a 260px `#F4F6F8` sidebar
> with a "New conversation" button and grouped conversation history.
> Centre: a message thread — a user message in a grey bubble, a
> collapsed tool-call row showing which module ran and how many files it
> read, and an assistant answer containing a paragraph, a comparison
> table and two clickable file citation chips. A composer pinned to the
> bottom. Right: a 340px sources panel listing the files the answer used,
> each with a permission label. Make the citation chips and the source
> cards hoverable, and make the sidebar conversations clickable to swap
> the thread.

**Database browser**

> Build a file manager screen for a media company's shared database. A
> collapsible folder tree sidebar, a breadcrumb, a row of filter
> dropdowns, an upload button, and a table of video and document files
> with columns for name, kind, size, version, owner, modified date and
> access level. Clicking a row opens a right-hand detail panel showing a
> thumbnail, technical metadata, who the file is shared with and a
> version history. Access levels render as coloured pills — Owner,
> Editor, Viewer. Make row selection and the detail panel work.

**Trends dashboard**

> Build a market research dashboard. A filter bar with source, region
> and timeframe dropdowns, then a responsive three-column grid of ranked
> topic cards. Each card shows a rank, a heat score out of 100, a
> headline, a progress bar, a small sparkline, a summary line, suggested
> angle tags, source links, and Adopt / Reject / Save actions. One card
> carries an amber "sensitive topic" banner. Make Adopt and Reject
> visibly remove or mark the card.

**Video project workspace**

> Build a three-pane video editing workspace. Left: a read-only locked
> script broken into numbered beats. Centre: a vertical list of shot
> cards, each with a thumbnail, a title, a source type tag, a duration
> and a status dot — these should be drag-reorderable. Below them a
> preview player with a scrub bar and 16:9 / 9:16 / 1:1 aspect toggles
> that actually change the preview frame's proportions. Right: a
> filterable media bin of clips. Dragging a clip from the bin onto a
> shot card should assign it.

**Entitlements matrix**

> Build an admin permissions screen: a wide matrix with employees down
> the left (avatar, name, role) and two grouped column bands across the
> top — eight modules and four file groups. Every cell is a checkbox.
> Ticking one should mark the screen dirty and reveal Discard and Save
> actions in the toolbar. Include filter dropdowns for team, role and
> status, a search field, and a footer showing counts and the last
> change. One row is a guest account, visually dimmed with an expiry
> chip.

### After Framer generates

It will add a hero section, centre things, and reach for a mobile
breakpoint you don't want. Say "no hero, no marketing copy, desktop
only, content fills the full viewport width" in the follow-up.

---

## Which to actually use

- **Deciding what goes on screen** — Claude Design. Fastest loop, and
  the artboards are already built.
- **Handing to a designer, or building a component library** — Figma.
  It's the only one of the three that produces layers someone else can
  work in.
- **Showing the client something that moves** — Framer. Publishes to a
  URL, and the interactions above are the ones worth demoing.

They don't need to agree. Use the canvas to settle the layout, then
feed the settled version into whichever of the other two the audience
needs.
