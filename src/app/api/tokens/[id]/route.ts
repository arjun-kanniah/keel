import { q } from "@/lib/db";
import { requireActor, route } from "@/lib/http/handler";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const actor = await requireActor();
  await q("UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [(await params).id, actor.userId]);
  return { ok: true };
});
