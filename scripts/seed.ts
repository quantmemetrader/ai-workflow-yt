/**
 * DEMO DATA. Not the studio's data — a fictional studio, five invented people
 * and a password printed in the README.
 *
 * It seeds a tenant, its people, their entitlements, a file tree with content
 * for the agent to retrieve, the chat channels from the approved design, and
 * tuning files. It exists to make a fresh checkout demonstrable; it is not a
 * migration and it is not a fixture for the live studio.
 *
 *   SEED_DEMO=yes npm run db:seed
 *
 * It refuses to run without `SEED_DEMO=yes`, and it refuses outright if the
 * database already holds anyone who is not one of its five invented people.
 * Both guards are there because it *writes to existing rows*: matched by
 * email, it resets a person's name, role, entitlements and password hash. Run
 * against the real studio it would hand five accounts a shared password out of
 * a public README and file demo documents among real ones.
 *
 * To create real people, use `npm run db:add-user`.
 */
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import {
  budgets,
  chatChannels,
  chatMembers,
  chatMessages,
  entitlements,
  fileVersions,
  files,
  folders,
  knowledge,
  relationTuples,
  teamMembers,
  teams,
  tenants,
  topics,
  users,
  type Module,
} from "../lib/db/schema";
import { hashPassword } from "../lib/auth/password";
import { newId } from "../lib/ids";

const TENANT = "tnt_aurafarmers";
const ALL: Module[] = [
  "chat", "files", "research", "script", "video", "publish",
  "accounting", "finance", "legal", "hr", "admin",
];

const PEOPLE = [
  {
    key: "chan",
    email: "chan@aurafarmers.hk",
    name: "Chan Ka-ming",
    nameLocal: "陈嘉明",
    title: "Studio lead",
    role: "owner" as const,
    avatar: "/avatars/chan.jpg",
    modules: ALL,
    team: "production",
  },
  {
    key: "amy",
    email: "amy@aurafarmers.hk",
    name: "Amy Wong",
    nameLocal: "黄爱美",
    title: "Producer",
    role: "member" as const,
    avatar: "/avatars/amy.jpg",
    modules: ["chat", "files", "research", "script", "publish"] as Module[],
    team: "production",
  },
  {
    key: "leung",
    email: "leung@aurafarmers.hk",
    name: "Leung Chi-hang",
    nameLocal: "梁志恒",
    title: "Editor",
    role: "member" as const,
    avatar: "/avatars/leung.jpg",
    modules: ["chat", "files", "script", "video"] as Module[],
    team: "production",
  },
  {
    key: "michelle",
    email: "michelle@aurafarmers.hk",
    name: "Michelle Yip",
    nameLocal: "叶美琪",
    title: "Head of business",
    role: "admin" as const,
    avatar: "/avatars/michelle.jpg",
    modules: ["chat", "files", "research", "publish", "accounting", "finance", "legal", "hr", "admin"] as Module[],
    team: "business",
  },
  {
    key: "vincent",
    email: "vincent@freelance.hk",
    name: "Vincent Chow",
    nameLocal: "周文森",
    title: "Freelance colourist",
    role: "guest" as const,
    avatar: null,
    // A guest with two modules must still get a complete product (brief).
    modules: ["chat", "files"] as Module[],
    team: null,
  },
];

const DOCS = [
  {
    folder: "brand",
    name: "House style — voice and tone.md",
    tags: ["style", "approved"],
    text: `# House style — voice and tone

Aura Farmers makes short explainers about technology in Asia for a Hong Kong audience.

## Voice
- Direct. One idea per sentence. No hype words: avoid "revolutionary", "game-changing", "unprecedented".
- We explain, we do not sell. If a claim needs a source, name the source on screen.
- Cantonese voice-over, Simplified and Traditional subtitles. English terms stay in English (ETF, HBM, 2nm) — do not translate product names.

## Structure of a short
1. Hook in the first 3 seconds: the surprising number or the concrete stake.
2. Context in 15 seconds: who is affected and why now.
3. The mechanism: how the thing actually works, one diagram or one screen recording.
4. What to watch next: a date, a filing, a launch.

## Things to avoid
- Price predictions of any kind.
- Anything that reads as investment advice.
- Footage we do not hold a licence for. When in doubt, use the studio library.`,
  },
  {
    folder: "research",
    name: "Topic note — HKMA stablecoin licences.md",
    tags: ["research", "chain"],
    text: `# Topic note — HKMA stablecoin licences

**Why now.** The Hong Kong Monetary Authority has begun naming the first licensed stablecoin issuers under the new regime. It is the first time a Chinese-adjacent jurisdiction has put names to licences.

**The angle we can take.** Not "crypto is back" — the interesting story is the compliance burden: reserve attestation monthly, redemption at par within one business day, and a named responsible officer. That is what separates a licence from a promise.

**Sources.** HKMA press releases; SCMP banking desk; Bloomberg Asia finance.

**Risk flag.** Sensitive: anything about specific tokens can read as investment advice. Keep to the rules, not the coins. Legal reviewed this framing on 2 September.`,
  },
  {
    folder: "scripts",
    name: "Script — 2nm and the Asian chip supply.md",
    tags: ["script", "locked"],
    text: `# 2nm and the Asian chip supply — locked v3

**Target:** YouTube 16:9, 4 min 30 s. Cantonese VO, bilingual subtitles.

## Beat 1 — Hook (0:00-0:08)
VO: 一片指甲咁大嘅晶片，决定咗你部手机下一年跑得几快。
On screen: macro shot of a wafer, the 2nm figure supered.

## Beat 2 — What changed (0:08-0:45)
VO: TSMC's 2nm line in Hsinchu started volume production this quarter. Two nanometres is not a measurement any more — it is a marketing name for a generation of transistor called gate-all-around.
B-roll: fab exterior, cleanroom stock, GAA diagram.

## Beat 3 — Who is squeezed (0:45-2:10)
The memory makers, not the logic makers. HBM supply is the bottleneck: every AI accelerator needs stacks of it, and there are three suppliers on earth.

## Beat 4 — What Hong Kong sees (2:10-3:40)
Assembly and test work moving to Penang and Kaohsiung; the logistics story is the local one.

## Beat 5 — What to watch (3:40-4:30)
Samsung's yield announcement in November, and whether Apple's A-series moves first.`,
  },
  {
    folder: "publish",
    name: "Channel rules — what we can and cannot post.md",
    tags: ["publish", "compliance"],
    text: `# Channel rules — what we can and cannot post

| Channel | How it publishes | Constraint today |
|---|---|---|
| YouTube | Official API | Ships as private/draft until the compliance audit passes. Nothing goes public automatically. |
| Instagram / Facebook | Meta Graph API | The studio owns the Page and Business account. |
| LinkedIn | Official API | Community Management access still pending approval. |
| X | Official API | Client-owned developer account. |
| TikTok | Official API | Upload-to-inbox only until audit. TikTok exposes no comment API at all. |
| WeChat Official Account | Official API | Comment sync supported. |
| Xiaohongshu | No publish API exists | Export an asset pack and post by hand. This is a normal path, not a failure. |
| WeChat Channels | No publish API exists | Asset pack, manual. |
| Bilibili | No publish API exists | Asset pack, manual. |
| Weibo | Out of scope | Confirmed dead end for a Hong Kong entity. |

Nothing transmits without a named approver on the record.`,
  },
];

const KNOWLEDGE = [
  {
    kind: "style" as const,
    scope: "module" as const,
    scopeValue: "script",
    title: "House style for scripts",
    body: `When drafting or reviewing a script:
- Cantonese VO lines stay in Cantonese as written; never "correct" them into Mandarin.
- One idea per sentence. Cut any sentence that could start with "In today's world".
- Every factual claim needs a source the studio can show on screen.
- No price predictions, no investment advice, ever.
- Structure: hook (3s), stakes (15s), mechanism, what to watch next.`,
  },
  {
    kind: "instructions" as const,
    scope: "tenant" as const,
    scopeValue: null,
    title: "Studio facts",
    body: `Aura Farmers is a video studio in Kwun Tong, Hong Kong, of nine people. It publishes technology explainers in Cantonese with bilingual subtitles to YouTube, Instagram, TikTok, LinkedIn, X and WeChat.
The financial year ends 31 March. Amounts are in Hong Kong dollars unless marked otherwise.
The studio cannot post to Xiaohongshu, WeChat Channels or Bilibili through an API — those need an exported asset pack and a person.`,
  },
];


/**
 * The studio's beats, as the approved Trends design lists them. These are
 * starting queries, not data: the worker fills in the numbers from GDELT and
 * Google News, and the studio edits the list as its coverage changes.
 */
const RESEARCH_TOPICS = [
  ["HKMA stablecoin licences", "金管局稳定币牌照", "HKMA stablecoin licence", "chain",
   "The first licensed issuers under Hong Kong's new regime. The story is the compliance burden, not the coins.",
   true, "Anything naming specific tokens can read as investment advice. Legal reviewed this framing on 2 September."],
  ["On-device AI in flagship phones", "新旗舰手机的端侧 AI", "on-device AI smartphone", "ai",
   "Phone makers moving inference off the cloud and onto the handset.", false, null],
  ["TSMC 2nm ramp", "台积电 2 纳米量产", "TSMC 2nm", "semi",
   "Volume production at 2nm and what it does to Asian supply.", false, null],
  ["Hong Kong spot bitcoin ETF flows", "香港现货比特币 ETF 资金流", "Hong Kong bitcoin ETF", "chain",
   "Money in and out of the HK-listed spot ETFs.", true,
   "Flow numbers invite a price prediction. Report the flows, never the implication."],
  ["Virtual banks turn a profit", "虚拟银行转亏为盈", "Hong Kong virtual bank profit", "fintech",
   "The first of the eight to report a full-year profit.", false, null],
  ["HBM memory shortage", "HBM 内存短缺", "HBM memory shortage", "semi",
   "Three suppliers on earth, and every accelerator needs stacks of it.", false, null],
  ["AI video start-ups raise in Asia", "亚洲 AI 视频初创公司融资", "AI video startup funding Asia", "startups",
   "Funding rounds in the studio's own corner of the market.", false, null],
  ["Foldables cut prices before 11.11", "折叠屏手机双十一前降价", "foldable phone price cut", "devices",
   "Discounting ahead of the Singles' Day window.", false, null],
  ["EV price war reaches Hong Kong", "电动车价格战蔓延至香港", "Hong Kong EV price", "ev",
   "Mainland price competition arriving in a right-hand-drive market.", false, null],
  ["Data centre power in Asia", "亚洲数据中心电力", "data centre power Asia", "ai",
   "Where the electricity for Asian AI build-outs is coming from.", false, null],
];

const CHANNELS = [
  { slug: "announcements", name: "announcements", topic: "Studio-wide notices" },
  { slug: "general", name: "general", topic: "Anything and everything" },
  { slug: "production", name: "production", topic: "Shoots, edits, deadlines" },
  { slug: "research", name: "research", topic: "Topics worth making" },
  { slug: "publish-approvals", name: "publish-approvals", topic: "Approvals before anything goes out", private: true },
  { slug: "random", name: "random", topic: "" },
];

/**
 * Two gates, because this script overwrites people it finds by email.
 *
 * The studio's real data was wiped and restored by hand. A stray `npm run
 * db:seed` afterwards must not put the demo studio back on top of it.
 */
async function refuseUnlessDemo() {
  if (process.env.SEED_DEMO !== "yes") {
    console.error(
      [
        "scripts/seed.ts writes DEMO data: a fictional studio, five invented",
        "people, and one shared password that is printed in the README.",
        "",
        "It matches people by email and overwrites their name, role, modules",
        "and password hash, so on a real database it is destructive.",
        "",
        "If that is genuinely what you want:  SEED_DEMO=yes npm run db:seed",
        "To add a real person instead:        npm run db:add-user",
      ].join("\n"),
    );
    process.exit(1);
  }

  const demoEmails = PEOPLE.map((p) => p.email);
  const strangers = await db
    .select({ email: users.email })
    .from(users)
    .where(notInArray(users.email, demoEmails));

  if (strangers.length) {
    console.error(
      [
        `Refusing: this database holds ${strangers.length} account(s) that are not part of the demo studio.`,
        ...strangers.slice(0, 10).map((s) => `  ${s.email}`),
        strangers.length > 10 ? `  …and ${strangers.length - 10} more` : "",
        "",
        "That makes it somebody's real workspace. Seeding would file demo",
        "documents among real ones and reset any matching account's password.",
        "Take a backup (npm run db:backup) and use a scratch database instead.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    process.exit(1);
  }
}

async function main() {
  await refuseUnlessDemo();

  const password = process.env.SEED_PASSWORD || "aurafarmers";
  const passwordHash = await hashPassword(password);

  console.log("Seeding DEMO data — a fictional studio, not anybody's real one.\n");

  await db
    .insert(tenants)
    .values({ id: TENANT, name: "Aura Farmers", nameLocal: "光环农夫", defaultLocale: "zh-CN" })
    .onConflictDoNothing();

  // Teams
  const teamIds: Record<string, string> = {};
  for (const [key, name, nameLocal] of [
    ["production", "Production", "制作"],
    ["business", "Business", "业务"],
  ] as const) {
    const existing = await db.select().from(teams).where(and(eq(teams.tenantId, TENANT), eq(teams.name, name))).limit(1);
    if (existing[0]) {
      teamIds[key] = existing[0].id;
    } else {
      const id = newId("team");
      await db.insert(teams).values({ id, tenantId: TENANT, name, nameLocal });
      teamIds[key] = id;
    }
  }

  // People
  const userIds: Record<string, string> = {};
  for (const p of PEOPLE) {
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, TENANT), eq(users.email, p.email)))
      .limit(1);

    const id = existing?.id ?? newId("usr");
    userIds[p.key] = id;

    const values = {
      id,
      tenantId: TENANT,
      email: p.email,
      name: p.name,
      nameLocal: p.nameLocal,
      title: p.title,
      role: p.role,
      status: "active" as const,
      avatarUrl: p.avatar,
      passwordHash,
      teamId: p.team ? teamIds[p.team] : null,
      locale: "zh-CN" as const,
    };

    if (existing) {
      await db.update(users).set(values).where(eq(users.id, id));
    } else {
      await db.insert(users).values(values);
    }

    await db.delete(entitlements).where(eq(entitlements.userId, id));
    await db.insert(entitlements).values(p.modules.map((m) => ({ userId: id, module: m })));

    if (p.team) {
      await db
        .insert(teamMembers)
        .values({ teamId: teamIds[p.team], userId: id, isLead: p.role === "owner" })
        .onConflictDoNothing();
    }

    // A cap per person so the meter in the shell is real from day one.
    await db
      .insert(budgets)
      .values({
        id: newId("bdg"),
        tenantId: TENANT,
        scope: "user",
        scopeId: id,
        capMicros: 20 * 1_000_000, // US$20 per period
        period: null,
      })
      .onConflictDoNothing();
  }

  // Folder tree. Everything under Studio is readable by the whole tenant;
  // finer grants happen per folder, exactly as the product intends.
  const folderIds: Record<string, string> = {};
  async function folder(key: string, name: string, parent: string | null, shareTenant: boolean) {
    const [existing] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.tenantId, TENANT), eq(folders.name, name)))
      .limit(1);

    if (existing) {
      folderIds[key] = existing.id;
      // Re-seeding after a tree change repositions the folder rather than
      // leaving a stale parent behind.
      const wantParent = parent ? folderIds[parent] : null;
      if (existing.parentId !== wantParent) {
        const [p] = wantParent
          ? await db.select().from(folders).where(eq(folders.id, wantParent)).limit(1)
          : [null];
        await db
          .update(folders)
          .set({ parentId: wantParent, path: [...(p?.path ?? []), existing.id] })
          .where(eq(folders.id, existing.id));
      }
    } else {
      const id = newId("fld");
      const parentPath = parent ? folderIds[parent] : null;
      const [p] = parentPath
        ? await db.select().from(folders).where(eq(folders.id, parentPath)).limit(1)
        : [null];
      await db.insert(folders).values({
        id,
        tenantId: TENANT,
        parentId: parent ? folderIds[parent] : null,
        name,
        path: [...(p?.path ?? []), id],
        ownerId: userIds.chan,
      });
      folderIds[key] = id;
      await db.insert(relationTuples).values({
        id: newId("tup"),
        objectType: "folder",
        objectId: id,
        relation: "owner",
        subjectType: "user",
        subjectId: userIds.chan,
      }).onConflictDoNothing();
    }

    if (shareTenant) {
      await db
        .insert(relationTuples)
        .values({
          id: newId("tup"),
          objectType: "folder",
          objectId: folderIds[key],
          relation: "editor",
          subjectType: "tenant",
          subjectId: TENANT,
          grantedBy: userIds.chan,
        })
        .onConflictDoNothing();
    }
  }

  await folder("studio", "Studio", null, true);
  await folder("brand", "Brand", "studio", true);
  await folder("research", "Research", "studio", true);
  await folder("scripts", "Scripts", "studio", true);
  await folder("footage", "Footage", "studio", true);
  await folder("publish", "Publish assets", "studio", true);
  // A sibling of Studio, not a child of it: anything under Studio inherits the
  // studio-wide grant, so a folder only the board may read has to sit outside
  // it. This is the shape the product needs — "you are seeing a filtered
  // subset" must be true for someone, or the permission story is theatre.
  await folder("board", "Board and finance", null, false);

  for (const doc of DOCS) {
    const [existing] = await db
      .select()
      .from(files)
      .where(and(eq(files.tenantId, TENANT), eq(files.name, doc.name)))
      .limit(1);
    if (existing) continue;

    const id = newId("fil");
    const [f] = await db.select().from(folders).where(eq(folders.id, folderIds[doc.folder])).limit(1);
    await db.insert(files).values({
      id,
      tenantId: TENANT,
      folderId: folderIds[doc.folder],
      folderPath: f?.path ?? [],
      name: doc.name,
      kind: "doc",
      mime: "text/markdown",
      sizeBytes: Buffer.byteLength(doc.text),
      text: doc.text,
      tags: doc.tags,
      ownerId: userIds.chan,
      updatedBy: userIds.chan,
    });
    await db.insert(fileVersions).values({
      id: newId("ver"),
      fileId: id,
      versionNo: 1,
      sizeBytes: Buffer.byteLength(doc.text),
      authorId: userIds.chan,
      note: "Seeded",
    });
    await db.insert(relationTuples).values({
      id: newId("tup"),
      objectType: "file",
      objectId: id,
      relation: "owner",
      subjectType: "user",
      subjectId: userIds.chan,
    }).onConflictDoNothing();
  }

  // One document only the board folder holds, to prove the filter works.
  const boardDoc = "Board pack — Q3 margin review.md";
  const [boardExists] = await db.select().from(files).where(eq(files.name, boardDoc)).limit(1);
  if (!boardExists) {
    const id = newId("fil");
    const [f] = await db.select().from(folders).where(eq(folders.id, folderIds.board)).limit(1);
    const text = `# Board pack — Q3 margin review\n\nGross margin 41.2% against a 38% plan. Two client retainers renewed at a higher rate; render costs down 18% after moving exports off the cloud renderer.\n\nNot for circulation outside the board.`;
    await db.insert(files).values({
      id, tenantId: TENANT, folderId: folderIds.board, folderPath: f?.path ?? [],
      name: boardDoc, kind: "doc", mime: "text/markdown",
      sizeBytes: Buffer.byteLength(text), text, tags: ["board", "confidential"],
      ownerId: userIds.michelle, updatedBy: userIds.michelle,
    });
    await db.insert(relationTuples).values({
      id: newId("tup"), objectType: "file", objectId: id, relation: "owner",
      subjectType: "user", subjectId: userIds.michelle,
    }).onConflictDoNothing();
  }

  // Chat
  for (const c of CHANNELS) {
    const [existing] = await db
      .select()
      .from(chatChannels)
      .where(and(eq(chatChannels.tenantId, TENANT), eq(chatChannels.slug, c.slug)))
      .limit(1);

    const id = existing?.id ?? newId("ch");
    if (!existing) {
      await db.insert(chatChannels).values({
        id,
        tenantId: TENANT,
        kind: "channel",
        slug: c.slug,
        name: c.name,
        topic: c.topic,
        isPrivate: Boolean((c as { private?: boolean }).private),
        createdBy: userIds.chan,
        lastMessageAt: new Date(),
      });
    }

    const members = (c as { private?: boolean }).private
      ? [userIds.chan, userIds.michelle]
      : Object.values(userIds);
    for (const userId of members) {
      await db.insert(chatMembers).values({ channelId: id, userId }).onConflictDoNothing();
    }

    const [msgCount] = await db.select().from(chatMessages).where(eq(chatMessages.channelId, id)).limit(1);
    if (!msgCount && c.slug === "production") {
      const now = Date.now();
      const seed = [
        [userIds.amy, "2nm script is locked at v3 — Leung, footage list is in Scripts.", 180],
        [userIds.leung, "收到。Rough cut by Thursday，字幕星期五。", 150],
        [userIds.chan, "Keep the HBM section under 40 seconds, it ran long last time.", 90],
      ] as const;
      for (const [authorId, body, minsAgo] of seed) {
        await db.insert(chatMessages).values({
          id: newId("msg"),
          channelId: id,
          authorId,
          body,
          createdAt: new Date(now - minsAgo * 60_000),
        });
      }
    }
  }

  // The client's tuning files
  for (const k of KNOWLEDGE) {
    const [existing] = await db
      .select()
      .from(knowledge)
      .where(and(eq(knowledge.tenantId, TENANT), eq(knowledge.title, k.title)))
      .limit(1);
    if (existing) continue;
    await db.insert(knowledge).values({
      id: newId("kn"),
      tenantId: TENANT,
      kind: k.kind,
      scope: k.scope,
      scopeValue: k.scopeValue,
      title: k.title,
      body: k.body,
      updatedBy: userIds.chan,
    });
  }


  // Research: the studio's beats. Numbers arrive from the worker, not from here.
  for (const [name, nameLocal, query, category, summary, flagged, flagReason] of RESEARCH_TOPICS) {
    await db
      .insert(topics)
      .values({
        id: newId("top"),
        tenantId: TENANT,
        query: query as string,
        name: name as string,
        nameLocal: nameLocal as string,
        category: category as string,
        region: "HK",
        summary: summary as string,
        flagged: Boolean(flagged),
        flagReason: (flagReason as string) ?? null,
      })
      .onConflictDoNothing();
  }

  // Files carry a denormalised copy of their folder's path; after any tree
  // change it is re-derived rather than trusted.
  await db.execute(
    sql`update files f set folder_path = fo.path from folders fo where f.folder_id = fo.id and f.folder_path is distinct from fo.path`,
  );

  console.log("Seeded DEMO tenant Aura Farmers");
  console.log(`Research topics: ${RESEARCH_TOPICS.length} (the worker fills in their numbers)`);
  console.log("People:");
  for (const p of PEOPLE) console.log(`  ${p.email.padEnd(26)} ${p.role.padEnd(6)} ${p.modules.length} modules`);
  console.log(`\nPassword for every seeded account: ${password}`);
  console.log("Set SEED_PASSWORD to choose your own, and change it in the app after first login.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
