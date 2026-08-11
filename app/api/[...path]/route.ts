import { NextResponse, type NextRequest } from "next/server";
import { all, id, now, one, run } from "@/lib/server/db";
import { audit, auditFor, auditTrail } from "@/lib/server/audit";
import {
  COOKIE_NAME,
  HttpError,
  SEED_PASSWORD,
  ensureAuthColumns,
  getSession,
  makeToken,
  requireRole,
  requireSession,
  signIn,
  type Session,
} from "@/lib/server/auth";
import {
  advance,
  heldConditions,
  invalidatePackages,
  proveAll,
  proveRoute,
  runForward,
} from "@/lib/server/interlocking";
import { ask } from "@/lib/server/assistant";
import {
  analyse,
  factCheck,
  generatePackages,
  generateScript,
  personaReply,
  readPublished,
  runTopicAgent,
  buildClaimMap,
} from "@/lib/server/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function body(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function fail(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.statusCode },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  // An integration that breaks stays visible with a clear error rather than a 500 with nothing in it.
  return NextResponse.json({ error: "server_error", message }, { status: 500 });
}

/* ── Read helpers ────────────────────────────────────────────────────────── */

function taskDetail(s: Session, taskId: string) {
  const task = one<Record<string, unknown>>(
    "SELECT * FROM content_task WHERE id = ? AND workspace_id = ?",
    taskId,
    s.workspaceId,
  );
  if (!task)
    throw new HttpError(404, "no_task", "No such task in this workspace.");

  const versions = all(
    `SELECT v.*, u.name AS author_name FROM script_version v
       LEFT JOIN app_user u ON u.id = v.author_id
      WHERE v.task_id = ? ORDER BY v.created_at ASC, v.rowid ASC`,
    taskId,
  );
  const latest = versions[versions.length - 1] as { id: string } | undefined;
  const flags = latest
    ? all(
        `SELECT f.*, u.name AS resolver_name FROM risk_flag f
           LEFT JOIN app_user u ON u.id = f.resolved_by
          WHERE f.version_id = ? ORDER BY
            CASE f.level WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
        latest.id,
      )
    : [];
  const claims = latest
    ? all("SELECT * FROM claim_map WHERE version_id = ?", latest.id)
    : [];

  return {
    task,
    versions,
    flags,
    claims,
    sources: all(
      `SELECT s.* FROM task_source ts JOIN source s ON s.id = ts.source_id WHERE ts.task_id = ?`,
      taskId,
    ),
    media: all(
      "SELECT * FROM media_asset WHERE task_id = ? ORDER BY created_at DESC",
      taskId,
    ),
    packages: all(
      "SELECT * FROM publish_package WHERE task_id = ? ORDER BY platform",
      taskId,
    ),
    proof: proveRoute(s.workspaceId, taskId),
    line: proveAll(s.workspaceId, taskId),
    audit: auditFor(s.workspaceId, "content_task", taskId).slice(0, 40),
  };
}

/* ── GET ─────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { path } = await ctx.params;
    const [head, a, b] = path;

    if (head === "session") {
      ensureAuthColumns();
      const s = await getSession();
      return ok({
        session: s,
        accounts: all("SELECT id,name,email FROM app_user ORDER BY name"),
        seedPassword: SEED_PASSWORD,
      });
    }

    const s = await requireSession();

    switch (head) {
      case "workspace":
        return ok({
          workspace: one("SELECT * FROM workspace WHERE id = ?", s.workspaceId),
          members: all(
            `SELECT u.id,u.name,u.email, group_concat(m.role) AS roles
               FROM membership m JOIN app_user u ON u.id = m.user_id
              WHERE m.workspace_id = ? GROUP BY u.id ORDER BY u.name`,
            s.workspaceId,
          ),
        });

      case "topics":
        return ok({
          candidates: all(
            `SELECT c.*, u.name AS decided_by_name,
                    (SELECT count(*) FROM candidate_source cs WHERE cs.candidate_id = c.id) AS source_count
               FROM topic_candidate c LEFT JOIN app_user u ON u.id = c.decided_by
              WHERE c.workspace_id = ? ORDER BY c.decision IS NOT NULL, c.score DESC`,
            s.workspaceId,
          ),
          sources: all(
            "SELECT * FROM source WHERE workspace_id = ?",
            s.workspaceId,
          ),
          links: all(
            `SELECT cs.candidate_id, cs.source_id FROM candidate_source cs
               JOIN topic_candidate c ON c.id = cs.candidate_id WHERE c.workspace_id = ?`,
            s.workspaceId,
          ),
          risks: all(
            `SELECT r.* FROM candidate_risk r JOIN topic_candidate c ON c.id = r.candidate_id
              WHERE c.workspace_id = ?`,
            s.workspaceId,
          ),
          // The viral videos behind each candidate, and the links that say
          // which caused which. Kept separate from `sources` on purpose: one
          // is why a topic is worth covering, the other is what it can be
          // grounded in, and the reviewer needs to tell them apart.
          videos: all(
            "SELECT * FROM viral_video WHERE workspace_id = ? ORDER BY velocity DESC",
            s.workspaceId,
          ),
          videoLinks: all(
            `SELECT cv.candidate_id, cv.video_id FROM candidate_video cv
               JOIN topic_candidate c ON c.id = cv.candidate_id WHERE c.workspace_id = ?`,
            s.workspaceId,
          ),
        });

      case "tasks":
        if (a) return ok(taskDetail(s, a));
        return ok({
          tasks: all(
            `SELECT t.*, (SELECT count(*) FROM script_version v WHERE v.task_id = t.id) AS versions
               FROM content_task t WHERE t.workspace_id = ? ORDER BY t.updated_at DESC`,
            s.workspaceId,
          ),
        });

      case "sources":
        return ok({
          sources: all(
            `SELECT s.*,
                    (SELECT count(*) FROM task_source ts WHERE ts.source_id = s.id) AS cited_by
               FROM source s WHERE s.workspace_id = ?
              ORDER BY s.status, s.published_at DESC`,
            s.workspaceId,
          ),
          // What discovery is searching for. A subject with no source behind it
          // is the reason a trending topic gets reported instead of raised.
          keywords: JSON.parse(
            one<{ value: string }>(
              "SELECT value FROM config WHERE workspace_id = ? AND key = 'topic.keywords'",
              s.workspaceId,
            )?.value ?? "[]",
          ),
        });

      case "knowledge":
        return ok({
          documents: all(
            "SELECT * FROM knowledge_document WHERE workspace_id = ? ORDER BY updated_at DESC",
            s.workspaceId,
          ),
        });

      case "conversations":
        return ok({
          conversations: all(
            `SELECT c.*, u.name AS owner_name FROM conversation c LEFT JOIN app_user u ON u.id = c.owner_id
              WHERE c.workspace_id = ? ORDER BY c.created_at DESC LIMIT 60`,
            s.workspaceId,
          ),
        });

      case "leads":
        return ok({
          leads: all(
            `SELECT l.*, u.name AS owner_name, c.message AS source_message
               FROM lead l LEFT JOIN app_user u ON u.id = l.owner_id
               LEFT JOIN conversation c ON c.id = l.conversation_id
              WHERE l.workspace_id = ? ORDER BY l.score DESC`,
            s.workspaceId,
          ),
          followups: all(
            `SELECT f.* FROM lead_followup f JOIN lead l ON l.id = f.lead_id WHERE l.workspace_id = ?
              ORDER BY f.created_at DESC`,
            s.workspaceId,
          ),
        });

      case "analytics":
        return ok({
          snapshots: all(
            "SELECT * FROM metric_snapshot WHERE workspace_id = ? ORDER BY period_end DESC",
            s.workspaceId,
          ),
          recommendations: all(
            "SELECT * FROM recommendation WHERE workspace_id = ? ORDER BY created_at",
            s.workspaceId,
          ),
          report: (await analyse(s)).payload,
        });

      case "config":
        return ok({
          config: all(
            "SELECT * FROM config WHERE workspace_id = ? ORDER BY key",
            s.workspaceId,
          ),
        });

      case "audit":
        return ok({ events: auditTrail(s.workspaceId, Number(b) || 150) });

      case "runs":
        return ok({
          runs: all(
            "SELECT * FROM agent_run WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 60",
            s.workspaceId,
          ),
        });

      default:
        return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  } catch (err) {
    return fail(err);
  }
}

/* ── POST / PATCH ────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { path } = await ctx.params;
    const [head, a, action] = path;
    const input = await body(req);

    /* Auth is the only unauthenticated surface. */
    if (head === "auth") {
      if (a === "login") {
        const result = signIn(
          String(input.email ?? ""),
          String(input.password ?? ""),
        );
        if ("error" in result) {
          return NextResponse.json(
            {
              error: result.error,
              message:
                result.error === "no_account"
                  ? "No account with that address."
                  : result.error === "bad_password"
                    ? "That password does not match."
                    : "That account is not a member of any workspace.",
            },
            { status: 401 },
          );
        }
        const res = ok({ session: result });
        res.cookies.set(
          COOKIE_NAME,
          makeToken(result.userId, result.workspaceId),
          {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 7,
          },
        );
        audit(result, "sign_in", "app_user", result.userId, null, {
          roles: result.roles,
        });
        return res;
      }
      if (a === "logout") {
        const res = ok({ ok: true });
        res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
        return res;
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const s = await requireSession();

    switch (head) {
      /* ── Assistant ──────────────────────────────────────────────────── */
      case "assistant": {
        // No extra role gate here on purpose. The assistant only ever calls the
        // same functions the buttons call, and those check their own roles, so
        // a second gate here would either duplicate them or drift from them.
        const reply = await ask(
          s,
          String(input.message ?? ""),
          input.lang === "zh" ? "zh" : "en",
        );
        return ok(reply);
      }

      /* ── Topics ─────────────────────────────────────────────────────── */
      case "topics": {
        if (!a) {
          await requireRole("contributor", "admin");
          return ok(await runTopicAgent(s));
        }
        if (action === "decide") {
          await requireRole("reviewer", "admin");
          const decision = String(input.decision ?? "");
          const reason = String(input.reason ?? "").trim();
          if (!["accepted", "rejected", "more_research"].includes(decision)) {
            throw new HttpError(
              400,
              "bad_decision",
              "Decision must be accepted, rejected, or more_research.",
            );
          }
          if (!reason)
            throw new HttpError(
              400,
              "reason_required",
              "A decision needs a reason. It becomes ranking feedback.",
            );

          const cand = one<Record<string, string>>(
            "SELECT * FROM topic_candidate WHERE id = ? AND workspace_id = ?",
            a,
            s.workspaceId,
          );
          if (!cand)
            throw new HttpError(404, "no_candidate", "No such candidate.");

          run(
            `UPDATE topic_candidate SET decision=?,decision_reason=?,decided_by=?,decided_at=?,
                    status=?,updated_at=?,revision=revision+1 WHERE id = ?`,
            decision,
            reason,
            s.userId,
            now(),
            decision === "accepted" ? "selected" : "closed",
            now(),
            a,
          );
          audit(
            s,
            "review",
            "topic_candidate",
            a,
            { decision: cand.decision },
            { decision },
            reason,
          );

          let taskId: string | null = null;
          if (decision === "accepted") {
            taskId = id("task");
            const t = now();
            const platforms = JSON.parse(
              one<{ value: string }>(
                "SELECT value FROM config WHERE workspace_id=? AND key='platforms.enabled'",
                s.workspaceId,
              )?.value ?? '["channels"]',
            );
            run(
              `INSERT INTO content_task
               (id,workspace_id,candidate_id,title_en,title_zh,platforms,state,owner_id,created_at,updated_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              taskId,
              s.workspaceId,
              a,
              cand.title_en,
              cand.title_zh,
              JSON.stringify(platforms),
              "TOPIC_REVIEW",
              s.userId,
              t,
              t,
              s.userId,
            );
            for (const link of all<{ source_id: string }>(
              "SELECT source_id FROM candidate_source WHERE candidate_id = ?",
              a,
            )) {
              run(
                "INSERT INTO task_source (task_id,source_id) VALUES (?,?)",
                taskId,
                link.source_id,
              );
            }
            audit(s, "create", "content_task", taskId, null, {
              from_candidate: a,
              state: "TOPIC_REVIEW",
            });
            advance(s, taskId, "Topic accepted");
          }
          return ok({ ok: true, taskId });
        }
        break;
      }

      /* ── Tasks ──────────────────────────────────────────────────────── */
      case "tasks": {
        if (!a) throw new HttpError(400, "no_task", "A task id is required.");

        switch (action) {
          case "advance": {
            const to = advance(
              s,
              a,
              input.reason ? String(input.reason) : undefined,
            );
            return ok({ state: to, detail: taskDetail(s, a) });
          }

          case "script": {
            await requireRole("contributor", "admin");
            const result = await generateScript(
              s,
              a,
              input.note ? String(input.note) : undefined,
            );
            if (result.status !== "failed") runForward(s, a, "Draft generated");
            return ok({ result, detail: taskDetail(s, a) });
          }

          case "factcheck": {
            const latest = one<{ id: string }>(
              "SELECT id FROM script_version WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
              a,
            );
            if (!latest)
              throw new HttpError(
                409,
                "no_version",
                "There is no draft to check.",
              );
            const result = await factCheck(s, latest.id);
            // Claims extracted and flagged, so the draft can enter review. It
            // will then sit at danger until a reviewer resolves what was found.
            if (result.status !== "failed")
              runForward(s, a, "Claims extracted and flagged");
            return ok({ result, detail: taskDetail(s, a) });
          }

          case "lock": {
            await requireRole("reviewer", "admin");
            const proof = proveRoute(s.workspaceId, a);
            if (!proof || proof.to !== "SCRIPT_LOCKED") {
              throw new HttpError(
                409,
                "wrong_state",
                "This task is not waiting at fact review.",
              );
            }
            // Every condition except the one this endpoint is about to satisfy.
            const held = heldConditions(proof, "locked").map((c) => c.label_en);
            if (held.length) {
              throw new HttpError(
                409,
                "signal_at_danger",
                `Held at danger. Not proved: ${held.join("; ")}`,
              );
            }
            const latest = one<{ id: string; label: string }>(
              "SELECT id,label FROM script_version WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
              a,
            )!;
            const t = now();
            run(
              "UPDATE script_version SET status='locked',locked_by=?,locked_at=?,updated_at=?,revision=revision+1 WHERE id = ?",
              s.userId,
              t,
              t,
              latest.id,
            );
            run(
              "UPDATE script_version SET status='superseded' WHERE task_id = ? AND id != ? AND status != 'locked'",
              a,
              latest.id,
            );
            audit(
              s,
              "lock",
              "script_version",
              latest.id,
              { status: "in_review" },
              { status: "locked", by: s.userId, at: t },
            );
            runForward(s, a, `Locked ${latest.label}`);
            return ok({ locked: latest.label, detail: taskDetail(s, a) });
          }

          /* Changing a locked script does not edit it. It creates a child. */
          case "revise": {
            await requireRole("contributor", "reviewer", "admin");
            const reason = String(input.reason ?? "").trim();
            if (!reason)
              throw new HttpError(
                400,
                "reason_required",
                "Changing a locked script needs a reason.",
              );
            const locked = one<{
              id: string;
              label: string;
              body: string;
              chars: number;
              task_id: string;
            }>(
              "SELECT id,label,body,chars,task_id FROM script_version WHERE task_id = ? AND status='locked' ORDER BY locked_at DESC LIMIT 1",
              a,
            );
            if (!locked)
              throw new HttpError(
                409,
                "not_locked",
                "There is no locked version to branch from.",
              );

            const label = `v${Number(locked.label.replace("v", "")) + 1}`;
            const childId = id("sv");
            const t = now();
            const newBody = String(input.body ?? locked.body);
            run(
              `INSERT INTO script_version
               (id,workspace_id,task_id,parent_id,label,body,chars,author_id,author_label,note_en,note_zh,status,created_at,updated_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              childId,
              s.workspaceId,
              a,
              locked.id,
              label,
              newBody,
              (newBody.match(/[一-鿿]/g) ?? []).length || newBody.length,
              s.userId,
              s.name,
              reason,
              reason,
              "draft",
              t,
              t,
              s.userId,
            );
            // A changed body needs its own claim map. Carrying the parent's over
            // would claim evidence for sentences that are no longer in the text.
            buildClaimMap(childId, newBody);
            audit(
              s,
              "edit",
              "script_version",
              childId,
              { parent: locked.label },
              { label, status: "draft" },
              reason,
            );

            const n = invalidatePackages(
              s,
              a,
              `New script version ${label}: ${reason}`,
            );
            run(
              "UPDATE content_task SET state='SCRIPT_DRAFT',updated_at=?,revision=revision+1 WHERE id = ?",
              t,
              a,
            );
            audit(
              s,
              "transition",
              "content_task",
              a,
              { state: "SCRIPT_LOCKED" },
              { state: "SCRIPT_DRAFT" },
              reason,
            );
            return ok({
              child: label,
              packagesInvalidated: n,
              detail: taskDetail(s, a),
            });
          }

          case "media": {
            await requireRole("producer", "admin");
            const ref = String(input.ref ?? "").trim();
            if (!ref)
              throw new HttpError(
                400,
                "ref_required",
                "Give a file reference or a storage link.",
              );
            const locked = one<{ id: string; label: string }>(
              "SELECT id,label FROM script_version WHERE task_id = ? AND status='locked' ORDER BY locked_at DESC LIMIT 1",
              a,
            );
            if (!locked)
              throw new HttpError(
                409,
                "not_locked",
                "A final video must bind to a locked script version.",
              );

            const assetId = id("ma");
            const t = now();
            run(
              "UPDATE media_asset SET status='superseded',updated_at=? WHERE task_id=? AND kind='final_video'",
              t,
              a,
            );
            run(
              `INSERT INTO media_asset (id,workspace_id,task_id,script_version_id,kind,ref,label,uploader_id,created_at,updated_at,created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              assetId,
              s.workspaceId,
              a,
              locked.id,
              "final_video",
              ref,
              String(input.label ?? "Final cut"),
              s.userId,
              t,
              t,
              s.userId,
            );
            audit(s, "handoff", "media_asset", assetId, null, {
              ref,
              bound_to: locked.label,
            });
            const n = invalidatePackages(
              s,
              a,
              "A new final video replaced the previous one",
            );
            runForward(s, a, "Final video delivered");
            return ok({
              asset: assetId,
              packagesInvalidated: n,
              detail: taskDetail(s, a),
            });
          }

          case "packages": {
            await requireRole("publisher", "admin");
            const result = await generatePackages(s, a);
            if (result.status !== "failed")
              runForward(s, a, "Packages generated");
            return ok({ result, detail: taskDetail(s, a) });
          }

          case "assign": {
            await requireRole("reviewer", "admin");
            const producerId = String(input.producer_id ?? "");
            if (
              !one(
                "SELECT 1 FROM membership WHERE user_id=? AND workspace_id=? AND role='producer'",
                producerId,
                s.workspaceId,
              )
            ) {
              throw new HttpError(
                400,
                "not_a_producer",
                "That person does not hold the producer role here.",
              );
            }
            run(
              "UPDATE content_task SET producer_id=?,updated_at=?,revision=revision+1 WHERE id=? AND workspace_id=?",
              producerId,
              now(),
              a,
              s.workspaceId,
            );
            audit(s, "assign", "content_task", a, null, {
              producer_id: producerId,
            });
            return ok({ detail: taskDetail(s, a) });
          }
        }
        break;
      }

      /* ── Flags ──────────────────────────────────────────────────────── */
      case "flags": {
        await requireRole("reviewer", "admin");
        const resolution = String(input.resolution ?? "");
        const reason = String(input.reason ?? "").trim();
        if (
          !["approved", "dismissed", "revised", "sourced"].includes(resolution)
        ) {
          throw new HttpError(
            400,
            "bad_resolution",
            "Resolution must be approved, dismissed, revised, or sourced.",
          );
        }
        if (resolution === "dismissed" && !reason) {
          throw new HttpError(
            400,
            "reason_required",
            "Dismissing a flag needs a reason.",
          );
        }
        const flag = one<{
          id: string;
          version_id: string;
          level: string;
          resolution: string | null;
        }>(
          "SELECT id,version_id,level,resolution FROM risk_flag WHERE id = ? AND workspace_id = ?",
          a,
          s.workspaceId,
        );
        if (!flag) throw new HttpError(404, "no_flag", "No such risk flag.");

        const t = now();
        run(
          `UPDATE risk_flag SET resolution=?,resolution_reason=?,resolved_by=?,resolved_at=?,
                  status='resolved',updated_at=?,revision=revision+1 WHERE id = ?`,
          resolution,
          reason || null,
          s.userId,
          t,
          t,
          a,
        );
        audit(
          s,
          "review",
          "risk_flag",
          a,
          { resolution: flag.resolution },
          { resolution, level: flag.level },
          reason,
        );
        const task = one<{ task_id: string }>(
          "SELECT task_id FROM script_version WHERE id = ?",
          flag.version_id,
        )!;
        return ok({ detail: taskDetail(s, task.task_id) });
      }

      /* ── Publish record ─────────────────────────────────────────────── */
      case "packages": {
        await requireRole("publisher", "admin");
        /* Read the published video back: performance, and anyone asking
           something in the comments. */
        if (action === "readback") {
          const result = await readPublished(s, a);
          return ok({ result, detail: taskDetail(s, String(result.task_id)) });
        }
        if (action !== "record") break;
        const url = String(input.live_url ?? "").trim();
        const account = String(input.account ?? "").trim();
        if (!/^https:\/\/\S+\.\S+/.test(url)) {
          throw new HttpError(
            400,
            "bad_url",
            "Paste the full URL the platform gave you, starting with https://",
          );
        }
        if (!account)
          throw new HttpError(
            400,
            "account_required",
            "Record which account published it.",
          );

        const pkg = one<{
          id: string;
          task_id: string;
          status: string;
          platform: string;
        }>(
          "SELECT id,task_id,status,platform FROM publish_package WHERE id = ? AND workspace_id = ?",
          a,
          s.workspaceId,
        );
        if (!pkg) throw new HttpError(404, "no_package", "No such package.");
        if (pkg.status === "invalid") {
          throw new HttpError(
            409,
            "package_invalid",
            "This package is invalid. Regenerate it before recording a publication.",
          );
        }
        const t = now();
        run(
          `UPDATE publish_package SET live_url=?,account=?,published_at=?,recorded_by=?,status='published',
                  updated_at=?,revision=revision+1 WHERE id = ?`,
          url,
          account,
          String(input.published_at ?? t),
          s.userId,
          t,
          a,
        );
        audit(
          s,
          "publish_record",
          "publish_package",
          a,
          { status: pkg.status },
          {
            status: "published",
            account,
            live_url: url,
            platform: pkg.platform,
          },
        );
        runForward(s, pkg.task_id, "Publication recorded");
        return ok({ detail: taskDetail(s, pkg.task_id) });
      }

      /* ── Conversations ──────────────────────────────────────────────── */
      case "conversations": {
        if (!a) {
          const message = String(input.message ?? "").trim();
          const participant =
            String(input.participant ?? "").trim() || "Contact";
          if (!message)
            throw new HttpError(
              400,
              "message_required",
              "Type a message for the persona to answer.",
            );
          const result = await personaReply(
            s,
            message,
            participant,
            input.external_id ? String(input.external_id) : undefined,
          );
          return ok({ result });
        }
        if (action === "takeover") {
          await requireRole("support", "admin");
          const conv = one<{ takeover_state: string }>(
            "SELECT takeover_state FROM conversation WHERE id=? AND workspace_id=?",
            a,
            s.workspaceId,
          );
          if (!conv)
            throw new HttpError(
              404,
              "no_conversation",
              "No such conversation.",
            );
          run(
            "UPDATE conversation SET takeover_state='taken',owner_id=?,updated_at=?,revision=revision+1 WHERE id=?",
            s.userId,
            now(),
            a,
          );
          audit(
            s,
            "takeover",
            "conversation",
            a,
            { takeover_state: conv.takeover_state },
            { takeover_state: "taken", owner: s.userId },
          );
          return ok({ ok: true });
        }
        break;
      }

      /* ── Leads ──────────────────────────────────────────────────────── */
      case "leads": {
        await requireRole("support", "admin");
        const lead = one<{ id: string; status: string }>(
          "SELECT id,status FROM lead WHERE id=? AND workspace_id=?",
          a,
          s.workspaceId,
        );
        if (!lead) throw new HttpError(404, "no_lead", "No such lead.");

        if (action === "followup") {
          const note = String(input.note ?? "").trim();
          if (!note)
            throw new HttpError(400, "note_required", "Write what happened.");
          run(
            "INSERT INTO lead_followup (id,lead_id,note,actor_id,created_at) VALUES (?,?,?,?,?)",
            id("lf"),
            a,
            note,
            s.userId,
            now(),
          );
          run(
            "UPDATE lead SET status='following',updated_at=?,revision=revision+1 WHERE id=?",
            now(),
            a,
          );
          audit(
            s,
            "lead_status_change",
            "lead",
            a,
            { status: lead.status },
            { status: "following" },
            note,
          );
          return ok({ ok: true });
        }

        const status = String(input.status ?? "");
        if (!["accepted", "rejected", "following", "closed"].includes(status)) {
          throw new HttpError(
            400,
            "bad_status",
            "Status must be accepted, rejected, following, or closed.",
          );
        }
        if (status === "closed" && !String(input.outcome ?? "").trim()) {
          throw new HttpError(
            400,
            "outcome_required",
            "Closing a lead needs an outcome. It becomes scoring feedback.",
          );
        }
        run(
          "UPDATE lead SET status=?,owner_id=coalesce(?,owner_id),outcome=?,updated_at=?,revision=revision+1 WHERE id=?",
          status,
          input.owner_id ? String(input.owner_id) : s.userId,
          input.outcome ? String(input.outcome) : null,
          now(),
          a,
        );
        audit(
          s,
          "lead_status_change",
          "lead",
          a,
          { status: lead.status },
          { status, outcome: input.outcome ?? null },
        );
        return ok({ ok: true });
      }

      /* ── Analytics ──────────────────────────────────────────────────── */
      case "analytics": {
        if (a === "import") {
          await requireRole("reviewer", "admin");
          const platform = String(input.platform ?? "").trim();
          const method = String(input.collection_method ?? "manual");
          const metrics = (input.metrics ?? {}) as Record<string, number>;
          if (!platform)
            throw new HttpError(
              400,
              "platform_required",
              "Which platform is this from?",
            );
          if (!["api", "csv", "manual"].includes(method)) {
            throw new HttpError(
              400,
              "bad_method",
              "Collection method must be api, csv, or manual.",
            );
          }
          const importKey = `${platform}:${input.period_end ?? now().slice(0, 10)}:${method}`;
          if (
            one("SELECT 1 FROM metric_snapshot WHERE import_key = ?", importKey)
          ) {
            throw new HttpError(
              409,
              "duplicate_import",
              "That period has already been imported for this platform.",
            );
          }
          const t = now();
          const snapId = id("m");
          run(
            `INSERT INTO metric_snapshot
             (id,workspace_id,platform,account,collection_method,period_start,period_end,metrics,missing_fields,import_key,created_at,updated_at,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            snapId,
            s.workspaceId,
            platform,
            String(input.account ?? "unspecified"),
            method,
            String(input.period_start ?? t.slice(0, 10)),
            String(input.period_end ?? t.slice(0, 10)),
            JSON.stringify(metrics),
            JSON.stringify(input.missing_fields ?? []),
            importKey,
            t,
            t,
            s.userId,
          );
          audit(s, "import", "metric_snapshot", snapId, null, {
            platform,
            method,
            fields: Object.keys(metrics),
          });
          return ok({ snapshot: snapId });
        }
        break;
      }

      /* ── Recommendations ────────────────────────────────────────────── */
      case "recommendations": {
        await requireRole("reviewer", "admin");
        const decision = String(input.decision ?? "");
        if (!["approved", "rejected"].includes(decision)) {
          throw new HttpError(
            400,
            "bad_decision",
            "Decision must be approved or rejected.",
          );
        }
        const rec = one<{ decision: string | null }>(
          "SELECT decision FROM recommendation WHERE id=? AND workspace_id=?",
          a,
          s.workspaceId,
        );
        if (!rec)
          throw new HttpError(
            404,
            "no_recommendation",
            "No such recommendation.",
          );
        run(
          "UPDATE recommendation SET decision=?,decided_by=?,decided_at=?,status='closed',updated_at=?,revision=revision+1 WHERE id=?",
          decision,
          s.userId,
          now(),
          now(),
          a,
        );
        audit(
          s,
          "review",
          "recommendation",
          a,
          { decision: rec.decision },
          { decision },
        );
        // Deciding the last recommendation is what proves the route into
        // ANALYZED, so any task waiting on it runs forward now.
        for (const t of all<{ id: string }>(
          "SELECT id FROM content_task WHERE workspace_id = ? AND state = 'PUBLISHED_MANUALLY'",
          s.workspaceId,
        )) {
          runForward(s, t.id, "Recommendations reviewed");
        }
        return ok({ ok: true });
      }

      /* ── Sources ────────────────────────────────────────────────────── */
      /*
        The evidence base. Everything downstream leans on these: a candidate is
        only raised for a subject an approved source is tagged for, and a task's
        sources are what the script cites and the claim map checks against.

        So a source is edited rather than replaced, and retiring one leaves it in
        place with status='retired'. Deleting would orphan the claim maps and
        audit entries of every script that already cited it, and a published
        video's provenance would quietly become unverifiable.
      */
      case "sources": {
        await requireRole("reviewer", "admin");

        const parseKeywords = (v: unknown): string[] => {
          const list = Array.isArray(v)
            ? v.map(String)
            : String(v ?? "")
                .split(",")
                .map((x) => x.trim());
          return [...new Set(list.map((k) => k.toLowerCase()).filter(Boolean))];
        };
        const TRUST = ["high", "medium", "low"];

        if (!a) {
          const labelEn = String(input.label_en ?? "").trim();
          if (!labelEn) {
            throw new HttpError(
              400,
              "label_required",
              "Give the source a name.",
            );
          }
          const trust = String(input.trust ?? "medium");
          if (!TRUST.includes(trust)) {
            throw new HttpError(
              400,
              "bad_trust",
              "Trust must be high, medium, or low.",
            );
          }
          const keywords = parseKeywords(input.keywords);
          if (keywords.length === 0) {
            throw new HttpError(
              400,
              "keywords_required",
              "Tag it with at least one subject. That tag is what lets a trending topic find this source.",
            );
          }
          const url = String(input.url ?? "").trim();
          if (url && !/^https?:\/\/\S+\.\S+/.test(url)) {
            throw new HttpError(
              400,
              "bad_url",
              "A source link has to start with http:// or https://",
            );
          }

          const sid = id("s");
          const t = now();
          run(
            `INSERT INTO source
             (id,workspace_id,label_en,label_zh,url,publisher,published_at,trust,keywords,last_check,created_at,updated_at,created_by,status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            sid,
            s.workspaceId,
            labelEn,
            String(input.label_zh ?? labelEn),
            url || null,
            String(input.publisher ?? "").trim() || null,
            String(input.published_at ?? t.slice(0, 10)),
            trust,
            JSON.stringify(keywords),
            t,
            t,
            t,
            s.userId,
            "approved",
          );
          audit(s, "create", "source", sid, null, {
            label: labelEn,
            trust,
            keywords,
          });
          return ok({ source: sid });
        }

        const prior = one<{
          label_en: string;
          trust: string;
          keywords: string;
          status: string;
        }>(
          "SELECT label_en,trust,keywords,status FROM source WHERE id = ? AND workspace_id = ?",
          a,
          s.workspaceId,
        );
        if (!prior) throw new HttpError(404, "no_source", "No such source.");

        if (action === "retire") {
          run(
            "UPDATE source SET status='retired',updated_at=?,revision=revision+1 WHERE id=?",
            now(),
            a,
          );
          audit(
            s,
            "review",
            "source",
            a,
            { status: prior.status },
            { status: "retired" },
            String(input.reason ?? "").trim() || undefined,
          );
          return ok({ ok: true });
        }
        if (action === "restore") {
          run(
            "UPDATE source SET status='approved',updated_at=?,revision=revision+1 WHERE id=?",
            now(),
            a,
          );
          audit(
            s,
            "review",
            "source",
            a,
            { status: prior.status },
            { status: "approved" },
          );
          return ok({ ok: true });
        }

        const trust = String(input.trust ?? prior.trust);
        if (!TRUST.includes(trust)) {
          throw new HttpError(
            400,
            "bad_trust",
            "Trust must be high, medium, or low.",
          );
        }
        const keywords =
          input.keywords === undefined
            ? (JSON.parse(prior.keywords || "[]") as string[])
            : parseKeywords(input.keywords);
        if (keywords.length === 0) {
          throw new HttpError(
            400,
            "keywords_required",
            "A source needs at least one subject tag.",
          );
        }
        run(
          `UPDATE source SET label_en=?,label_zh=?,url=?,publisher=?,published_at=?,trust=?,keywords=?,
                  updated_at=?,revision=revision+1 WHERE id=? AND workspace_id=?`,
          String(input.label_en ?? prior.label_en),
          String(input.label_zh ?? input.label_en ?? prior.label_en),
          String(input.url ?? "").trim() || null,
          String(input.publisher ?? "").trim() || null,
          String(input.published_at ?? now().slice(0, 10)),
          trust,
          JSON.stringify(keywords),
          now(),
          a,
          s.workspaceId,
        );
        audit(
          s,
          "edit",
          "source",
          a,
          { trust: prior.trust, keywords: prior.keywords },
          { trust, keywords },
        );
        return ok({ ok: true });
      }

      /* ── Knowledge ──────────────────────────────────────────────────── */
      case "knowledge": {
        await requireRole("admin");
        if (!a) {
          const name = String(input.name ?? "").trim();
          if (!name)
            throw new HttpError(
              400,
              "name_required",
              "Give the document a name.",
            );
          const docId = id("d");
          const t = now();
          run(
            `INSERT INTO knowledge_document
             (id,workspace_id,name_en,name_zh,type_en,type_zh,doc_version,access_en,access_zh,ingest_stage,status,created_at,updated_at,created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            docId,
            s.workspaceId,
            name,
            String(input.name_zh ?? name),
            String(input.type ?? "Document"),
            String(input.type_zh ?? "文档"),
            String(input.version ?? "v1"),
            "All agents",
            "全部智能体",
            "uploaded",
            "review",
            t,
            t,
            s.userId,
          );
          const text = String(input.text ?? "").trim();
          if (text) {
            text.split(/\n{2,}/).forEach((chunk, i) => {
              run(
                "INSERT INTO knowledge_chunk (id,workspace_id,document_id,ordinal,text) VALUES (?,?,?,?,?)",
                id("k"),
                s.workspaceId,
                docId,
                i,
                chunk.trim(),
              );
            });
            run(
              "UPDATE knowledge_document SET ingest_stage='chunked',updated_at=? WHERE id=?",
              t,
              docId,
            );
          }
          audit(s, "create", "knowledge_document", docId, null, {
            name,
            status: "review",
          });
          return ok({ document: docId });
        }
        if (action === "status") {
          const status = String(input.status ?? "");
          if (
            !["review", "indexed", "restricted", "expired"].includes(status)
          ) {
            throw new HttpError(
              400,
              "bad_status",
              "Status must be review, indexed, restricted, or expired.",
            );
          }
          const doc = one<{ status: string }>(
            "SELECT status FROM knowledge_document WHERE id=? AND workspace_id=?",
            a,
            s.workspaceId,
          );
          if (!doc)
            throw new HttpError(404, "no_document", "No such document.");
          run(
            "UPDATE knowledge_document SET status=?,ingest_stage=?,updated_at=?,revision=revision+1 WHERE id=?",
            status,
            status === "indexed" ? "published" : "uploaded",
            now(),
            a,
          );
          audit(
            s,
            "review",
            "knowledge_document",
            a,
            { status: doc.status },
            { status },
          );
          return ok({ ok: true });
        }
        break;
      }

      /* ── Config ─────────────────────────────────────────────────────── */
      case "config": {
        await requireRole("admin");
        const key = String(input.key ?? "");
        const value = String(input.value ?? "");
        if (!key) throw new HttpError(400, "key_required", "Which setting?");
        const prior = one<{ value: string }>(
          "SELECT value FROM config WHERE workspace_id=? AND key=?",
          s.workspaceId,
          key,
        );
        run(
          `INSERT INTO config (workspace_id,key,value,updated_at,updated_by) VALUES (?,?,?,?,?)
           ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
          s.workspaceId,
          key,
          value,
          now(),
          s.userId,
        );
        audit(
          s,
          "edit",
          "config",
          key,
          { value: prior?.value ?? null },
          { value },
        );
        return ok({ ok: true });
      }
    }

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}

export const PATCH = POST;
