import { z } from "zod";
import { createApiToken } from "@/lib/auth/actors";
import { q } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { body, requireActor, route } from "@/lib/http/handler";

// Personal access tokens for MCP clients. Only people (signed in with the cookie) manage them.
export const GET = route(async () => {
  const actor = await requireActor();
  if (actor.via !== "app") throw forbidden("Manage tokens in the app");
  const tokens = await q(
    `SELECT id, name, scopes, created_at AS "createdAt", last_used_at AS "lastUsedAt"
       FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [actor.userId],
  );
  return { tokens };
});

export const POST = route(async (req) => {
  const actor = await requireActor();
  if (actor.via !== "app") throw forbidden("Manage tokens in the app");
  const { name } = await body(req, z.object({ name: z.string().trim().max(60).default("Claude Desktop") }));
  const n = await q("SELECT 1 FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL", [actor.userId]);
  if (n.length >= 5) throw forbidden("Up to 5 tokens per person; revoke one first");
  return createApiToken(actor, name, actor.scopes);
});
