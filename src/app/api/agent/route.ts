import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, actorFromSession } from "@/lib/auth/actors";
import { runAgent } from "@/lib/agent/run";
import { config } from "@/lib/config";
import { clientIp, errorResponse } from "@/lib/http/handler";
import { hit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  sessionId: z.string().max(40).optional(),
  page: z.object({
    path: z.string().max(200),
    label: z.string().max(80),
    folderId: z.string().max(40).optional(),
    folderName: z.string().max(80).optional(),
  }),
});

// The in-app assistant. Only a signed-in person (session cookie) can use it; external agents use
// /api/mcp with their own token. Streams the run as server-sent events.
export async function POST(req: Request) {
  try {
    const actor = await actorFromSession((await cookies()).get(SESSION_COOKIE)?.value);
    if (!actor) return NextResponse.json({ error: { message: "Sign in first" } }, { status: 401 });
    if (!config.anthropicConfigured) {
      return NextResponse.json({ error: { message: "The assistant isn't configured on this server (no ANTHROPIC_API_KEY)." } }, { status: 503 });
    }
    const input = Body.parse(await req.json());
    await hit(`agent:org:${actor.orgId}`, config.runsPerHour);
    await hit(`agent:ip:${await clientIp()}`, config.runsPerHour * 2);

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (e: object) => {
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            // the browser went away; the run still finishes and is traced
          }
        };
        runAgent({ user: actor, message: input.message, page: input.page, sessionId: input.sessionId, emit: send })
          .catch((e) => send({ type: "error", message: e instanceof Error ? e.message : "failed" }))
          .finally(() => {
            try {
              controller.close();
            } catch {}
          });
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
