import { loadRun } from "@/lib/agent/trace";
import { notFound } from "@/lib/errors";
import { requireActor, route } from "@/lib/http/handler";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const actor = await requireActor();
  const r = await loadRun(actor.orgId, (await params).id);
  if (!r) throw notFound("Run");
  return r;
});
