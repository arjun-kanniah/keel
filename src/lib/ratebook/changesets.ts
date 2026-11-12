import type pg from "pg";
import { type Actor, ROLE_LABEL, hasScope } from "../auth/roles";
import { one, q, tx } from "../db";
import { AppError, conflict, forbidden, notFound } from "../errors";
import { newId } from "../ids";
import { LIMITS, evaluate } from "../policy/policy";
import { audit } from "./audit";
import { describeOp } from "./plans";
import type { Changeset, ChangesetStatus, Op, Plan, PolicyDecision } from "./types";

// Changesets: the one write path. Propose (dry run) → approve → apply → undo.
//
// - propose runs the policy engine and stores the exact operations; it changes no business data.
// - apply locks every row it touches, checks each is still at the version the preview saw, and
//   writes everything in one transaction. A stale preview fails cleanly (409) instead of
//   overwriting someone's newer change. The idempotency key makes a retried apply harmless.
// - apply stores the inverse operations, so undo is the same mechanism run backwards, with the
//   same version checks.

interface Row {
  id: string;
  org_id: string;
  created_by: string;
  created_by_name: string;
  via: Changeset["via"];
  run_id: string | null;
  tool: string | null;
  summary: string;
  status: ChangesetStatus;
  ops: Op[];
  inverse: Op[] | null;
  risk: Changeset["risk"];
  needs_owner: boolean;
  policy: PolicyDecision[];
  idempotency_key: string | null;
  approved_by_name: string | null;
  status_reason: string | null;
  created_at: Date;
  expires_at: Date;
  applied_at: Date | null;
  undone_at: Date | null;
}

const SELECT = `
  SELECT c.*, u.name AS created_by_name, a.name AS approved_by_name
    FROM changesets c JOIN users u ON u.id = c.created_by LEFT JOIN users a ON a.id = c.approved_by`;

function view(r: Row): Changeset {
  const undoUntil = r.applied_at ? r.applied_at.getTime() + LIMITS.undoHours * 3600_000 : 0;
  return {
    id: r.id,
    orgId: r.org_id,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    via: r.via,
    runId: r.run_id,
    tool: r.tool,
    summary: r.summary,
    status: r.status,
    ops: r.ops,
    risk: r.risk,
    needsOwner: r.needs_owner,
    policy: r.policy,
    approvedByName: r.approved_by_name,
    statusReason: r.status_reason,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    appliedAt: r.applied_at?.toISOString() ?? null,
    undoneAt: r.undone_at?.toISOString() ?? null,
    canUndo: r.status === "applied" && Date.now() < undoUntil && !!r.inverse?.length,
  };
}

export class PolicyDenied extends AppError {
  constructor(public decisions: PolicyDecision[]) {
    super(403, "policy_denied", decisions.filter((d) => d.outcome === "deny").map((d) => d.message).join(" "), {
      policy: decisions,
    });
  }
}

/** Store a plan as a proposed changeset after the policy check. Writes no business data. */
export async function propose(
  actor: Actor,
  plan: Plan,
  meta: { tool?: string; runId?: string | null } = {},
): Promise<Changeset> {
  const result = evaluate(actor, plan.ops);
  if (result.denied) throw new PolicyDenied(result.decisions);
  const id = newId("cs");
  const risk = result.records > 1 ? "bulk" : "write";
  return tx(async (c) => {
    await c.query(
      `INSERT INTO changesets (id, org_id, created_by, via, run_id, tool, summary, status, ops, risk, needs_owner, policy, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'proposed', $8, $9, $10, $11, now() + make_interval(mins => $12))`,
      [
        id,
        actor.orgId,
        actor.userId,
        actor.via,
        meta.runId ?? actor.runId ?? null,
        meta.tool ?? null,
        plan.summary,
        JSON.stringify(plan.ops),
        risk,
        result.needsOwner,
        JSON.stringify(result.decisions),
        LIMITS.proposalMinutes,
      ],
    );
    if (actor.via !== "app") {
      await audit(c, actor, { action: "changeset.proposed", summary: `Proposed: ${plan.summary}`, changesetId: id });
    }
    return get(actor, id, c);
  });
}

export async function get(actor: Actor, id: string, db?: pg.PoolClient): Promise<Changeset> {
  const r = await one<Row>(`${SELECT} WHERE c.id = $1 AND c.org_id = $2`, [id, actor.orgId], db);
  if (!r) throw notFound(`Change ${id}`);
  return view(r);
}

export async function list(actor: Actor, opts: { status?: ChangesetStatus[]; limit?: number } = {}): Promise<Changeset[]> {
  await expireStale(actor.orgId);
  const params: unknown[] = [actor.orgId];
  let where = "c.org_id = $1";
  if (opts.status?.length) where += ` AND c.status = ANY($${params.push(opts.status)})`;
  params.push(Math.min(opts.limit ?? 50, 200));
  const rows = await q<Row>(`${SELECT} WHERE ${where} ORDER BY c.created_at DESC LIMIT $${params.length}`, params);
  return rows.map(view);
}

async function expireStale(orgId: string) {
  await q(
    `UPDATE changesets SET status = 'expired', status_reason = 'Nobody approved it in time'
      WHERE org_id = $1 AND status IN ('proposed', 'awaiting_owner') AND expires_at < now()`,
    [orgId],
  );
}

async function lockRow(c: pg.PoolClient, actor: Actor, id: string): Promise<Row> {
  const r = await one<Row>(
    `SELECT c.*, u.name AS created_by_name, NULL AS approved_by_name
       FROM changesets c JOIN users u ON u.id = c.created_by
      WHERE c.id = $1 AND c.org_id = $2 FOR UPDATE OF c`,
    [id, actor.orgId],
    c,
  );
  if (!r) throw notFound(`Change ${id}`);
  return r;
}

type ApplyResult = { ok: true; inverse: Op[] } | { ok: false; reason: string };

/** Apply operations in order. Each row is locked and version-checked before it is written. */
async function applyOps(c: pg.PoolClient, orgId: string, ops: Op[]): Promise<ApplyResult> {
  const inverse: Op[] = [];
  const fail = (reason: string): ApplyResult => ({ ok: false, reason });

  for (const op of ops) {
    switch (op.kind) {
      case "set_rate":
      case "set_item_profile":
      case "delete_item": {
        const cur = await one<{ version: number }>(
          "SELECT version FROM items WHERE id = $1 AND org_id = $2 FOR UPDATE",
          [op.itemId, orgId],
          c,
        );
        if (!cur) return fail(`${op.itemName} no longer exists`);
        if (cur.version !== op.version) return fail(`${op.itemName} changed after the preview`);
        if (op.kind === "set_rate") {
          const r = await one<{ version: number }>(
            "UPDATE items SET rate_cents = $1, version = version + 1 WHERE id = $2 RETURNING version",
            [op.to, op.itemId],
            c,
          );
          inverse.unshift({ ...op, from: op.to, to: op.from, version: r!.version });
        } else if (op.kind === "set_item_profile") {
          const p = await one("SELECT 1 FROM profiles WHERE id = $1 AND org_id = $2", [op.toProfileId, orgId], c);
          if (!p) return fail(`Profile ${op.toProfileName} no longer exists`);
          const r = await one<{ version: number }>(
            "UPDATE items SET profile_id = $1, version = version + 1 WHERE id = $2 RETURNING version",
            [op.toProfileId, op.itemId],
            c,
          );
          inverse.unshift({
            ...op,
            fromProfileId: op.toProfileId,
            fromProfileName: op.toProfileName,
            fromMultiplier: op.toMultiplier,
            toProfileId: op.fromProfileId,
            toProfileName: op.fromProfileName,
            toMultiplier: op.fromMultiplier,
            version: r!.version,
          });
        } else {
          await c.query("DELETE FROM items WHERE id = $1", [op.itemId]);
          inverse.unshift({ kind: "create_item", item: op.item });
        }
        break;
      }
      case "create_profile": {
        const r = await one(
          `INSERT INTO profiles (id, org_id, name, multiplier) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING RETURNING id`,
          [op.profileId, orgId, op.name, op.multiplier],
          c,
        );
        if (!r) return fail(`A profile named ${op.name} already exists`);
        inverse.unshift({ kind: "delete_profile", profileId: op.profileId, name: op.name, multiplier: op.multiplier, version: 1 });
        break;
      }
      case "delete_profile": {
        const cur = await one<{ version: number; used: number }>(
          `SELECT version, (SELECT count(*)::int FROM items WHERE profile_id = p.id) AS used
             FROM profiles p WHERE id = $1 AND org_id = $2 FOR UPDATE`,
          [op.profileId, orgId],
          c,
        );
        if (!cur) return fail(`Profile ${op.name} no longer exists`);
        if (cur.version !== op.version) return fail(`Profile ${op.name} changed after the preview`);
        if (cur.used > 0) return fail(`Profile ${op.name} is now used by other items`);
        await c.query("DELETE FROM profiles WHERE id = $1", [op.profileId]);
        inverse.unshift({ kind: "create_profile", profileId: op.profileId, name: op.name, multiplier: op.multiplier });
        break;
      }
      case "set_module": {
        const cur = await one<{ version: number }>(
          "SELECT version FROM modules WHERE org_id = $1 AND key = $2 FOR UPDATE",
          [orgId, op.key],
          c,
        );
        if (!cur) return fail(`Module ${op.name} no longer exists`);
        if (cur.version !== op.version) return fail(`${op.name} changed after the preview`);
        const r = await one<{ version: number }>(
          "UPDATE modules SET enabled = $1, version = version + 1 WHERE org_id = $2 AND key = $3 RETURNING version",
          [op.to, orgId, op.key],
          c,
        );
        inverse.unshift({ ...op, from: op.to, to: op.from, version: r!.version });
        break;
      }
      case "create_item": {
        const it = op.item;
        const f = await one("SELECT 1 FROM folders WHERE id = $1 AND org_id = $2", [it.folderId, orgId], c);
        if (!f) return fail(`Folder ${it.folderName} no longer exists`);
        const dup = await one(
          "SELECT 1 FROM items WHERE folder_id = $1 AND lower(name) = lower($2)",
          [it.folderId, it.name],
          c,
        );
        if (dup) return fail(`${it.folderName} already has an item called ${it.name}`);
        await c.query(
          `INSERT INTO items (id, org_id, folder_id, name, type, rate_cents, unit, profile_id, note, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                   (SELECT coalesce(max(position), 0) + 1 FROM items WHERE folder_id = $3))`,
          [it.id, orgId, it.folderId, it.name, it.type, it.rateCents, it.unit, it.profileId, it.note],
        );
        inverse.unshift({ kind: "delete_item", itemId: it.id, itemName: it.name, version: 1, item: it });
        break;
      }
    }
  }
  return { ok: true, inverse };
}

/** Thrown inside a transaction when a row is stale, so everything in it rolls back. */
class Stale extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/**
 * Approve and apply. The approver's own scopes are checked again here (the proposer's don't
 * count), plus Owner approval when the proposal needs it.
 */
export async function apply(actor: Actor, id: string, idempotencyKey: string): Promise<Changeset> {
  let expired = false;
  try {
    await tx(async (c) => {
      const r = await lockRow(c, actor, id);
      if (r.status === "applied") {
        if (r.idempotency_key === idempotencyKey) return; // a retry of the same apply: no-op
        throw conflict("This change was already applied");
      }
      if (r.status !== "proposed" && r.status !== "awaiting_owner") {
        throw conflict(`This change is ${r.status.replace("_", " ")}; ask again for a fresh preview`);
      }
      if (r.expires_at.getTime() < Date.now()) {
        await c.query("UPDATE changesets SET status = 'expired', status_reason = 'The preview expired' WHERE id = $1", [id]);
        expired = true;
        return;
      }
      const policy = evaluate(actor, r.ops);
      if (policy.denied) throw new PolicyDenied(policy.decisions);
      if (r.needs_owner && !hasScope(actor, "changes:approve_large")) {
        throw forbidden(`This change needs an Owner to approve it; ${ROLE_LABEL[actor.role]}s can ask for approval.`);
      }

      const res = await applyOps(c, actor.orgId, r.ops);
      if (!res.ok) throw new Stale(res.reason);
      await c.query(
        `UPDATE changesets SET status = 'applied', inverse = $2, approved_by = $3, applied_at = now(), idempotency_key = $4
          WHERE id = $1`,
        [id, JSON.stringify(res.inverse), actor.userId, idempotencyKey],
      );
      await audit(c, actor, {
        action: "changeset.applied",
        summary: r.summary,
        changesetId: id,
        runId: r.run_id,
        detail: { ops: r.ops.map(describeOp), proposedVia: r.via },
      });
    });
  } catch (e) {
    if (e instanceof Stale) throw await recordConflict(actor, id, e.reason);
    throw e;
  }
  if (expired) throw conflict("The preview expired; ask again for a fresh one");
  return get(actor, id);
}

/** The apply rolled back; mark the changeset so the stale preview can't be retried. */
async function recordConflict(actor: Actor, id: string, reason: string): Promise<AppError> {
  await tx(async (c) => {
    await c.query(
      "UPDATE changesets SET status = 'conflict', status_reason = $2 WHERE id = $1 AND status IN ('proposed', 'awaiting_owner')",
      [id, reason],
    );
    await audit(c, actor, { action: "changeset.conflict", summary: `Not applied: ${reason}`, changesetId: id });
  });
  return conflict(`Not applied: ${reason}. Nothing changed.`, { reason });
}

export async function undo(actor: Actor, id: string): Promise<Changeset> {
  try {
    await tx(async (c) => {
      const r = await lockRow(c, actor, id);
      if (r.status !== "applied" || !r.inverse) throw conflict(`Only applied changes can be undone (this one is ${r.status})`);
      if (r.applied_at && Date.now() - r.applied_at.getTime() > LIMITS.undoHours * 3600_000) {
        throw conflict(`Changes can be undone for ${LIMITS.undoHours} hours`);
      }
      const policy = evaluate(actor, r.inverse, { undo: true });
      if (policy.denied) throw new PolicyDenied(policy.decisions);
      const res = await applyOps(c, actor.orgId, r.inverse);
      if (!res.ok) throw new Stale(res.reason);
      await c.query("UPDATE changesets SET status = 'undone', undone_at = now() WHERE id = $1", [id]);
      await audit(c, actor, { action: "changeset.undone", summary: `Undid: ${r.summary}`, changesetId: id, runId: r.run_id });
    });
  } catch (e) {
    if (e instanceof Stale) throw conflict(`Can't undo: ${e.reason}. Nothing changed.`, { reason: e.reason });
    throw e;
  }
  return get(actor, id);
}

export async function cancel(actor: Actor, id: string): Promise<Changeset> {
  await tx(async (c) => {
    const r = await lockRow(c, actor, id);
    if (r.status !== "proposed" && r.status !== "awaiting_owner") throw conflict(`This change is ${r.status}`);
    const mine = r.created_by === actor.userId;
    if (!mine && evaluate(actor, r.ops).denied) throw forbidden("Only the person who asked, or someone who could apply it, can cancel it");
    await c.query("UPDATE changesets SET status = 'cancelled', status_reason = $2 WHERE id = $1", [id, `Cancelled by ${actor.userName}`]);
    if (r.via !== "app" || r.status === "awaiting_owner") {
      await audit(c, actor, { action: "changeset.cancelled", summary: `Cancelled: ${r.summary}`, changesetId: id, runId: r.run_id });
    }
  });
  return get(actor, id);
}

/** Route a proposal that needs an Owner to the Owners' approval queue. */
export async function requestApproval(actor: Actor, id: string): Promise<Changeset> {
  await tx(async (c) => {
    const r = await lockRow(c, actor, id);
    if (r.status !== "proposed") throw conflict(`This change is ${r.status}`);
    if (!r.needs_owner) throw conflict("This change doesn't need an Owner; apply it directly");
    await c.query(
      "UPDATE changesets SET status = 'awaiting_owner', expires_at = now() + interval '24 hours' WHERE id = $1",
      [id],
    );
    await audit(c, actor, { action: "changeset.approval_requested", summary: `Asked an Owner to approve: ${r.summary}`, changesetId: id, runId: r.run_id });
  });
  return get(actor, id);
}

/** For edits made directly in the app: the same path, proposed and applied in one go. */
export async function proposeAndApply(actor: Actor, plan: Plan): Promise<Changeset> {
  const cs = await propose(actor, plan);
  try {
    return await apply(actor, cs.id, newId("idem"));
  } catch (e) {
    await q("UPDATE changesets SET status = 'cancelled', status_reason = 'Direct edit failed' WHERE id = $1 AND status = 'proposed'", [cs.id]);
    throw e;
  }
}
