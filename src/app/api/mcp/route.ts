import { NextResponse } from "next/server";
import { actorFromApiToken } from "@/lib/auth/actors";
import { handleMcp } from "@/lib/mcp/server";
import { hit } from "@/lib/ratelimit";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const actor = auth.startsWith("Bearer ") ? await actorFromApiToken(auth.slice(7).trim()) : null;
  if (!actor) {
    return NextResponse.json(
      { error: "Send a Ratebook personal access token as 'Authorization: Bearer kpat_...' (create one on the Connect page)" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="ratebook"' } },
    );
  }
  try {
    await hit(`mcp:${actor.userId}`, 300);
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return handleMcp(req, actor);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
