import { z } from "zod";
import { body, requireActor, route } from "@/lib/http/handler";
import { list, propose } from "@/lib/ratebook/changesets";
import { planApplyProfile, planBulkRate, planCreateItems, planModules, planSetRate } from "@/lib/ratebook/plans";
import type { ChangesetStatus } from "@/lib/ratebook/types";

// POST is the dry run: it returns a proposed changeset and writes no business data.
// Apply it with POST /api/v1/changesets/:id/apply and an Idempotency-Key header.
const Plan = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_rate"), item_id: z.string(), rate: z.number().positive() }),
  z.object({ kind: z.literal("bulk_rate"), folder: z.string(), pct: z.number().min(-50).max(50), item_type: z.string().optional() }),
  z.object({
    kind: z.literal("apply_profile"),
    profile: z.string().optional(),
    new_profile: z.object({ name: z.string(), multiplier: z.number() }).optional(),
    folder: z.string().optional(),
    item_type: z.string().optional(),
    item_ids: z.array(z.string()).max(50).optional(),
  }),
  z.object({ kind: z.literal("set_modules"), changes: z.array(z.object({ key: z.string(), enabled: z.boolean() })).min(1) }),
  z.object({
    kind: z.literal("create_items"),
    folder: z.string(),
    items: z.array(z.object({ name: z.string(), type: z.string(), rate: z.number().positive(), unit: z.string(), note: z.string().optional() })).min(1).max(10),
  }),
]);

export const POST = route(async (req) => {
  const actor = await requireActor();
  const p = await body(req, Plan);
  const plan =
    p.kind === "set_rate"
      ? await planSetRate(actor, p.item_id, Math.round(p.rate * 100))
      : p.kind === "bulk_rate"
        ? await planBulkRate(actor, { folder: p.folder, pct: p.pct, itemType: p.item_type })
        : p.kind === "apply_profile"
          ? await planApplyProfile(actor, { profile: p.profile, newProfile: p.new_profile, folder: p.folder, itemType: p.item_type, itemIds: p.item_ids })
          : p.kind === "set_modules"
            ? await planModules(actor, p.changes)
            : await planCreateItems(actor, { folder: p.folder, items: p.items.map((i) => ({ ...i, rateCents: Math.round(i.rate * 100) })) });
  return { changeset: await propose(actor, plan, { tool: `api:${p.kind}` }), notes: plan.notes ?? [] };
});

export const GET = route(async (req) => {
  const actor = await requireActor();
  const status = new URL(req.url).searchParams.get("status");
  return { changesets: await list(actor, { status: status ? (status.split(",") as ChangesetStatus[]) : undefined }) };
});
