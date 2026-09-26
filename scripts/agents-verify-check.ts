/**
 * Checks the reply verifier and the team tools against the real studio.
 * Read-only: SELECTs, and tools that only read. Nothing is posted or written.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx scripts/agents-verify-check.ts
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import { viewerById } from "../lib/auth/viewer-by-id";
import { idsIn, type Artifact } from "../lib/ai/tools/types";
import { runTool, toolsFor } from "../lib/ai/tools";
import { assemblePrompt } from "../lib/ai/prompt";
import { notesFor } from "../lib/ai/tools/chat";
import { parseAgentMentions } from "../lib/agents/catalog";
import { stepForTool } from "../lib/agents/steps";
import { readCardActions } from "../lib/agents/cards";
import { readWorkRefs } from "../lib/chat/handoff";
import {
  delegatedTo,
  existingIds,
  findClaims,
  findStartClaims,
  judgeReply,
  publicProblems,
  stripAgentMentions,
  verifyReply,
  type ReplyFacts,
} from "../lib/agents/mentions";

const TENANT = "tnt_aurafarmers";
const FAKE = "scr_01m37bqz5gx3tfhr7t1tnq703r";
const CHANNEL = "ch_01m37avx0gx3tfhr7t1tnq703r";
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};

async function main() {
  const { rows: incident } = await db.execute<{ body: string }>(sql`select body from chat_messages where id = 'msg_01m3bywpfmckty7ms6hvgz936e'`);
  const reply = incident[0]?.body ?? "";
  check("the planner's real reply was found", reply.includes(FAKE), reply.slice(0, 80));

  const { rows: realScripts } = await db.execute<{ id: string; title: string }>(
    sql`select id, title from scripts where tenant_id = ${TENANT} and deleted_at is null order by updated_at desc limit 1`,
  );
  const real = realScripts[0];
  check("a real script exists to cite", Boolean(real), real);

  /* 1. The claim regex over the real message. */
  const claims = findClaims(reply, "planning");
  console.log("      claims found:", JSON.stringify(claims));
  check("claims in the real reply are found, as the planner's own, about a script", claims.length >= 2 && claims.every((c) => c.mine) && claims.some((c) => c.kinds.includes("script")));

  /* 2. The real reply, with what that turn actually did: three reads, no
        receipts, having seen the channel's id and nothing else. */
  const seenThatTurn = new Set<string>([CHANNEL, ...idsIn("@策划 有什么新的策划案上传了")]);
  const factsIncident: ReplyFacts = { self: "planning", receipts: [], seen: seenThatTurn };
  const exists = await existingIds(TENANT, idsIn(reply));
  const verdict = judgeReply(reply, factsIncident, exists);
  console.log("      verdict:", JSON.stringify(verdict));
  check("the fabricated reply is rejected", !verdict.ok);
  check("… and the fake id is named as not existing", verdict.missing.includes(FAKE));
  check("… and as never returned by a tool", verdict.unseen.includes(FAKE));
  check("… and its claims have no receipt", verdict.unbacked.length >= 2);
  const viaDb = await verifyReply(reply, factsIncident, TENANT);
  check("verifyReply (with the database) agrees", !viaDb.ok && viaDb.missing.includes(FAKE));

  /* 3. A reply citing a real script a tool returned. */
  const cite = `脚本库里最新的是《${real.title}》（ID: ${real.id}），还在写。蒸馏那篇库里找不到，要不要让编剧来写？`;
  const factsCite: ReplyFacts = { self: "planning", receipts: [], seen: new Set([real.id]) };
  const v2 = await verifyReply(cite, factsCite, TENANT);
  check("a reply citing a real id a tool returned is accepted", v2.ok, v2);

  /* 3b. The same id, not returned this turn: rejected as unseen. */
  const v2b = await verifyReply(cite, { ...factsCite, seen: new Set() }, TENANT);
  check("the same real id, not seen this turn, is rejected as unseen", !v2b.ok && v2b.unseen.includes(real.id) && !v2b.missing.includes(real.id), v2b);

  /* 3c. A claim of writing, with the receipt that backs it. */
  const receipt: Artifact = { kind: "script", id: real.id, title: real.title, action: "created" };
  const written = `刚写好《${real.title}》的脚本，已存入脚本库（${real.id}）。下一步交 @剪辑师 做粗剪。`;
  const v3 = await verifyReply(written, { self: "script", receipts: [receipt], seen: new Set() }, TENANT);
  check("a claim with a matching receipt is accepted", v3.ok, v3);
  const v3b = await verifyReply(written, { self: "script", receipts: [{ kind: "topic", id: "top_x", action: "updated" }], seen: new Set([real.id]) }, TENANT);
  check("the same claim with only a receipt of another kind is rejected", !v3b.ok && v3b.unbacked.length > 0, v3b);

  /* 4. Mentions without receipts become plain names. */
  const stripped = stripAgentMentions(reply, null);
  check("@剪辑师 without receipts is written back as a plain name", !stripped.includes("@剪辑师") && stripped.includes("剪辑师") && parseAgentMentions(stripped).length === 0, stripped.slice(-30));
  const kept = stripAgentMentions("写好了。@剪辑师 请粗剪，@策划 知悉。", "video");
  check("with a hand-off, only its colleague keeps the @", kept === "写好了。@剪辑师 请粗剪，策划 知悉。", kept);

  /* 5. Claims that are not claims. */
  const notClaims = [
    "脚本还没写好，我这边查不到。",
    "写好后交给剪辑师。",
    "等编剧写好了再说。",
    "脚本写好了吗？",
    "研究员今早发布了晨报。",
    "我会写好的。",
    "请把脚本存入脚本库。",
  ];
  for (const t of notClaims) {
    const c = findClaims(t, "planning").filter((x) => x.mine);
    check(`not a claim of my own work: ${t}`, c.length === 0, c);
  }
  const theirs = findClaims("编剧已经写好了《测试》。", "planning");
  check("a colleague's finished work is read as theirs", theirs.length === 1 && !theirs[0].mine, theirs);
  const theirsUnbacked = judgeReply("编剧已经写好了《AI模型蒸馏》脚本。", { self: "planning", receipts: [], seen: new Set([CHANNEL]) }, new Set());
  check("… and without anything of that kind looked at this turn, it is not accepted", !theirsUnbacked.ok, theirsUnbacked);
  const theirsBacked = judgeReply("编剧已经写好了《测试》脚本。", { self: "planning", receipts: [], seen: new Set([real.id]) }, new Set());
  check("… and with the scripts looked up this turn, it is", theirsBacked.ok, theirsBacked);
  const mine = findClaims("刚完成《AI模型蒸馏》脚本初稿，已存入脚本库。", "planning");
  check("the incident's phrasing is caught even without an id", mine.length >= 2);
  const english = findClaims("I've just finished the script and saved it.", "script");
  check("English first-person claims are caught", english.length >= 1 && english[0].mine, english);

  /* 5b. Begun is not done; quoting is not claiming. */
  const started: Artifact = { kind: "video_project", id: "prj_x", action: "started" };
  const early = judgeReply("粗剪已完成，可以看了。", { self: "video", receipts: [started], seen: new Set() }, new Set());
  check("a make_video that only started does not back '粗剪已完成'", !early.ok, early);
  const honest = judgeReply("已经开始做了，几分钟后出粗剪。", { self: "video", receipts: [started], seen: new Set() }, new Set());
  check("… while saying it has started is fine", honest.ok, honest);
  const quoted = findClaims("你说的“已存入脚本库”其实没有发生。", "planning");
  check("a quoted claim is not a claim", quoted.length === 0, quoted);
  const handed = judgeReply("好的，已经交给编剧了，写好会在这里说。", { self: "planning", receipts: [{ kind: "assignment", id: "msg_x", action: "assigned" }], seen: new Set() }, new Set());
  check("'已经交给编剧' backed by an assignment receipt is accepted", handed.ok, handed);
  const handedNot = judgeReply("好的，已经交给编剧了。", { self: "planning", receipts: [], seen: new Set() }, new Set());
  check("… and without one it is not", !handedNot.ok, handedNot);

  const report = `《${real.title}》（${real.id}）已经写好了，状态是写作中。`;
  const vr = judgeReply(report, { self: "script", receipts: [], seen: new Set([real.id]) }, new Set([real.id]));
  check("a report on a real script looked up this turn is not a claim to have written it", vr.ok, vr);
  const boast = `刚完成《${real.title}》（${real.id}）。`;
  const vb = judgeReply(boast, { self: "planning", receipts: [], seen: new Set([real.id]) }, new Set([real.id]));
  check("… but '刚完成' about it, with no receipt, still is", !vb.ok, vb);
  const said = findClaims("我刚才说已存入脚本库，那是错的。", "planning");
  check("reported speech is not a claim", said.length === 0, said);

  /* 5c. What read_channel now says under the plan and under a checked hand-off. */
  const { rows: planRow } = await db.execute<{ meta: Record<string, unknown> }>(sql`select meta from chat_messages where id = 'msg_01m3a7aph69wsq01v5cbwt6scx'`);
  const planNotes = notesFor(planRow[0]?.meta ?? null);
  console.log(`      plan notes:\n${planNotes.map((n) => `        ↳ ${n}`).join("\n")}`);
  check("the plan is annotated as assignments, and the pressed button as a hand-over only", planNotes.length === 2 && /不是已经完成的工作/.test(planNotes[0]) && /不代表做完/.test(planNotes[1]));
  const handNotes = notesFor({ handoff: { from: "script", to: "video", verified: true, artifacts: [{ kind: "script", id: real.id, title: real.title }] } });
  check("a checked hand-off is annotated with what was handed over", handNotes.length === 1 && handNotes[0].includes(real.id) && handNotes[0].includes("编剧 → 剪辑师"), handNotes[0]);

  /* 6. The planner's tools. */
  const { rows: agents } = await db.execute<{ id: string; email: string }>(
    sql`select id, email from users where tenant_id = ${TENANT} and email in ('planning@agents.invalid', 'video@agents.invalid', 'script@agents.invalid')`,
  );
  const planner = await viewerById(agents.find((a) => a.email.startsWith("planning"))!.id);
  const editor = await viewerById(agents.find((a) => a.email.startsWith("video"))!.id);
  const writerAgent = await viewerById(agents.find((a) => a.email.startsWith("script"))!.id);
  if (!planner || !editor || !writerAgent) throw new Error("agents missing");
  const plannerTools = toolsFor(planner).map((t) => t.function.name);
  console.log("      planner offered:", plannerTools.join(", "));
  check(
    "the planner is not offered write_script, write_article, make_video, send_message or any cutting tool",
    !["write_script", "write_article", "make_video", "remove_range", "add_graphic", "first_cut", "send_message"].some((n) => plannerTools.includes(n)),
  );
  check("… and keeps its reads and the team tools", ["list_scripts", "read_script", "describe_timeline", "list_topics", "read_plan", "list_projects", "assign_task"].every((n) => plannerTools.includes(n)));
  const refused = await runTool(planner, "write_script", JSON.stringify({ subject: "AI模型蒸馏" }));
  check("the planner calling write_script is refused and pointed at assign_task", /assign_task/.test(refused.text) && !refused.artifacts, refused.text);
  const readOnlyTools = toolsFor(editor, { readOnly: true }).map((t) => t.function.name);
  check("a read-only turn offers no tool that writes", !["make_video", "remove_range", "write_script", "assign_task", "add_graphic"].some((n) => readOnlyTools.includes(n)) && readOnlyTools.includes("describe_timeline"), readOnlyTools.join(", "));

  const plan = await runTool(planner, "read_plan", "{}");
  console.log(`      read_plan:\n${plan.text.split("\n").map((l) => `        ${l}`).join("\n")}`);
  check("read_plan marks to-dos as assignments", /assignment/.test(plan.text) && /编剧/.test(plan.text));
  const projects = await runTool(planner, "list_projects", "{}");
  console.log(`      list_projects:\n${projects.text.split("\n").slice(0, 6).map((l) => `        ${l}`).join("\n")}`);
  check("list_projects lists projects with their ids", /wp_/.test(projects.text));
  const search = await runTool(planner, "list_scripts", JSON.stringify({ query: "蒸馏" }));
  console.log(`      list_scripts 蒸馏:\n${search.text.split("\n").map((l) => `        ${l}`).join("\n")}`);
  check("list_scripts with a query that matches nothing says what the library holds", /No script matches/.test(search.text) && /scr_/.test(search.text));
  const found = await runTool(planner, "list_scripts", JSON.stringify({ query: real.title.slice(0, 2) }));
  check("list_scripts with a query finds a script by title", found.text.includes(real.id), found.text.split("\n").slice(0, 3).join(" | "));

  /* 7. The planner's own prompt. */
  const { text: prompt } = await assemblePrompt(planner, "research");
  const head = prompt.slice(0, prompt.indexOf("Today is") + 60);
  console.log(`      prompt head:\n${head.split("\n").map((l) => `        ${l}`).join("\n")}`);
  check("the planner speaks as 策划, not as somebody's assistant", prompt.includes("「策划」") && !prompt.includes("You are assisting"));
  check("… and knows plan to-dos are assignments, and its own messages are its own", prompt.includes("不代表已经做完") && prompt.includes("（你）"));

  /* 8. What the channel is told when a reply is held back: the kind of
        problem, never the claim or the id it was held back for. */
  const told = publicProblems(verdict, true);
  console.log(`      told the channel: ${told.join("；")}`);
  check("the apology names no id and repeats no claim", told.length > 0 && !told.some((t) => /scr_|已存入|刚完成/.test(t)), told);
  check("no quoted claim cuts an id in half", claims.every((c) => !/\b[a-z]{2,4}_[0-9a-z]{1,19}(?![0-9a-z])/i.test(c.claim.replace(/\b[a-z]{2,4}_[0-9a-z]{26}\b/gi, ""))), claims.map((c) => c.claim));

  /* 9. "让编剧写" is a hand-off to ask for; a question is not. */
  check("'@策划 让编剧写个脚本' asks for 编剧", delegatedTo("@策划 让编剧写个《AI模型蒸馏》3分钟脚本", "planning") === "script");
  check("'@策划 安排剪辑师出粗剪' asks for 剪辑师", delegatedTo("@策划 安排剪辑师出一版粗剪", "planning") === "video");
  check("the incident's question asks for nobody", delegatedTo("@策划 有什么新的策划案上传了", "planning") === null);
  check("a colleague the person tagged themselves is not asked for twice", delegatedTo("@策划 @编剧 让编剧写个脚本", "planning") === null);
  check("a colleague named in passing is not asked for", delegatedTo("@策划 编剧昨天写的那个脚本在哪", "planning") === null);

  /* 10. Said after handing it on, "写好会在这里说" is a promise, not a claim. */
  const promise = judgeReply(
    "好的，已经交给编剧写《AI模型蒸馏》脚本了，写好会在频道里说。",
    { self: "planning", receipts: [{ kind: "assignment", id: "msg_x", action: "assigned" }], seen: new Set([CHANNEL]) },
    new Set(),
  );
  check("'写好会在频道里说' after an assignment is accepted", promise.ok, promise);

  /* 11. One prefix, two tables. */
  const { rows: track } = await db.execute<{ id: string }>(sql`select id from audio_tracks where tenant_id = ${TENANT} limit 1`);
  const { rows: account } = await db.execute<{ id: string }>(sql`select id from channels where tenant_id = ${TENANT} limit 1`);
  const both = [track[0]?.id, account[0]?.id].filter((v): v is string => Boolean(v));
  if (both.length) {
    const there = await existingIds(TENANT, both);
    check("a voiceover track (rnd_) and a connected account (chn_) are found", both.every((i) => there.has(i)), both);
  } else {
    console.log("      (no audio track or connected account in this studio to look up)");
  }

  /* 12. A project named by id has to be one the viewer can see: a deleted
         one is refused before anything is posted. */
  const { rows: gone } = await db.execute<{ id: string }>(sql`select id from work_projects where tenant_id = ${TENANT} and deleted_at is not null limit 1`);
  if (gone[0]) {
    const refusedProject = await runTool(planner, "assign_task", JSON.stringify({ to: "script", task: "测试", project_id: gone[0].id }), { channelId: CHANNEL });
    check("assign_task into a deleted project is refused, nothing posted", /no such project/i.test(refusedProject.text) && !refusedProject.artifacts, refusedProject.text);
  }

  /* 13. 剪辑师 in #研究日报, 2026-09-26: handedScript a loose script, no project,
         nothing in any bin, no tool called — "开始粗剪". */
  const { rows: cutting } = await db.execute<{ body: string }>(sql`select body from chat_messages where id = 'msg_01m3e8aces1eb36sjs8bzq9bja'`);
  const editorReply = cutting[0]?.body ?? "已读脚本《特斯拉Optimus产量暴增10倍：机器人取代快递员还远吗？》（scr_01m3e88cssrtyzvwyrj4cdyzwh）。\n开始粗剪，将严格按3分钟时长、反差钩子和“普通人机会点”结构执行。";
  check("the editor's real reply was found", editorReply.includes("开始粗剪"), editorReply.slice(0, 60));
  const handedScript = new Set(["scr_01m3e88cssrtyzvwyrj4cdyzwh"]);
  const startClaims = findStartClaims(editorReply, "video");
  check("'开始粗剪' is read as the editor's own start", startClaims.length === 1, startClaims);
  const heldEmpty = judgeReply(editorReply, { self: "video", receipts: [], seen: handedScript, clips: 0, cut: false }, handedScript);
  check("… held with an empty bin and no cut begun", !heldEmpty.ok && heldEmpty.unbacked.some((c) => c.claim.includes("开始粗剪")), heldEmpty);
  const heldNoCut = judgeReply(editorReply, { self: "video", receipts: [], seen: handedScript, clips: 4, cut: false }, handedScript);
  check("… held with clips in the bin but no first_cut / make_video this turn", !heldNoCut.ok, heldNoCut);
  const cutReceipt: Artifact = { kind: "video_project", id: "prj_01m3byhf3eyss1wved6fh538bp", action: "updated" };
  const backed = judgeReply("开始粗剪了，先按脚本分段剪出第一版。", { self: "video", receipts: [cutReceipt], seen: new Set(), clips: 4, cut: true }, new Set());
  check("… and accepted once first_cut really ran on a bin with clips", backed.ok, backed);
  for (const t of [
    "素材一到我就开始粗剪，先按脚本分段。",
    "等主持人上传素材后，我再开始粗剪。",
    "现在还不能开始粗剪：素材箱是空的。",
    "要不要先用素材库画面，我这边开始粗剪？",
    "剪辑师开始粗剪了。",
    "Once the clips land I will start the rough cut.",
    "I'll start the rough cut once the clips land.",
    "拿到素材我就开始粗剪。",
  ]) {
    const c = findStartClaims(t, t.startsWith("剪辑师") ? "planning" : "video");
    check(`not a start claim of my own: ${t}`, c.length === 0, c);
  }
  check("English 'I'm starting the rough cut' is a start claim", findStartClaims("I'm starting the rough cut now.", "video").length === 1);
  check("… also with a 'when' further on in the sentence", findStartClaims("I'm starting the rough cut now, and will post it when it is done.", "video").length === 1);
  const askedClips = judgeReply("《特斯拉Optimus产量暴增10倍》的脚本我收到了。素材箱里还没有素材，现在还不能开剪；素材一到我就按脚本分段出粗剪。", { self: "video", receipts: [], seen: handedScript, clips: 0, cut: false }, handedScript);
  check("asking for the clips with an empty bin passes the check", askedClips.ok, askedClips);

  /* 14. Steps, project refs and the run button, as the chat reads them. */
  check("tool steps follow the real tool names", stepForTool("write_script") === "writing_script" && stepForTool("first_cut") === "rough_cut" && stepForTool("find_footage") === "footage" && stepForTool("edit_caption") === "captions" && stepForTool("make_video") === "making" && stepForTool("read_channel") === "channel" && stepForTool("no_such_tool") === "working");
  const refs = readWorkRefs({ project: { id: "wp_01m3e8aces1eb36sjs8bzq9bja" }, handoff: { artifacts: [{ kind: "script", id: "scr_01m3e88cssrtyzvwyrj4cdyzwh" }, { kind: "video_project", id: "prj_01m3byhf3eyss1wved6fh538bp" }] }, receipts: [{ kind: "work_project", id: "wp_01m3e8aces1eb36sjs8bzq9bjb" }] });
  check("a message's project, script and video refs are read from meta", refs.projectIds.length === 2 && refs.scriptIds.length === 1 && refs.videoIds.length === 1, refs);
  const runs = readCardActions({ actions: [
    { id: "stock-cut", label: "先用素材库画面", labelEn: "Stock", kind: "run", op: "stock-cut", projectId: "wp_01m3e8aces1eb36sjs8bzq9bja" },
    { id: "bad", label: "x", labelEn: "x", kind: "run", op: "delete-everything", projectId: "wp_01m3e8aces1eb36sjs8bzq9bja" },
    { id: "bad2", label: "y", labelEn: "y", kind: "run", op: "stock-cut", projectId: "../../etc" },
  ] });
  check("a run button keeps only a known operation on a project id", runs.length === 1 && runs[0].op === "stock-cut", runs);

  /* 15. Review of the branch: advice is not a start claim, and a rewrite is
         not a second project. */
  const advice = judgeReply("这个题值得现在就做视频，建议马上做视频，先出一版粗剪。", { self: "planning", receipts: [], seen: new Set() }, new Set());
  check("策划 recommending 'mark this to make now' is not held as a start claim", advice.ok, advice);
  const editorAdvice = judgeReply("我马上开始粗剪。", { self: "video", receipts: [], seen: new Set() }, new Set());
  check("… while 剪辑师 saying it is starting, with no cut begun, still is", !editorAdvice.ok, editorAdvice);
  const writerDef = toolsFor(writerAgent).find((t) => t.function.name === "write_script");
  check("write_script takes a script_id for rewriting outside a project", Boolean((writerDef?.function.parameters as { properties?: Record<string, unknown> } | undefined)?.properties?.script_id));
  const noSuch = await runTool(writerAgent, "write_script", JSON.stringify({ subject: "AI模型蒸馏", script_id: FAKE }));
  check("… and a script_id that does not exist writes nothing and starts no project", /no script/i.test(noSuch.text) && !noSuch.artifacts, noSuch.text);

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
