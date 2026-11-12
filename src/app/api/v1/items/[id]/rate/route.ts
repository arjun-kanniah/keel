import { z } from "zod";
import { body, requireActor, route } from "@/lib/http/handler";
import { proposeAndApply } from "@/lib/ratebook/changesets";
import { planSetRate } from "@/lib/ratebook/plans";

// A direct edit from the rate table: the same changeset path, proposed and applied at once.
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const actor = await requireActor();
  const { rate } = await body(req, z.object({ rate: z.number().positive().max(100000) }));
  const plan = await planSetRate(actor, (await params).id, Math.round(rate * 100));
  return { changeset: await proposeAndApply(actor, plan) };
});
