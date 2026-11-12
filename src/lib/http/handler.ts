import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { SESSION_COOKIE, actorFromApiToken, actorFromSession } from "../auth/actors";
import type { Actor } from "../auth/roles";
import { config } from "../config";
import { AppError, unauthorized } from "../errors";
import { touchOrg } from "../ratebook/seed";

/** The caller: a signed-in person (cookie) or an API/MCP client (Bearer personal token). */
export async function currentActor(): Promise<Actor | null> {
  const auth = (await headers()).get("authorization");
  if (auth?.startsWith("Bearer ")) return actorFromApiToken(auth.slice(7).trim());
  const actor = await actorFromSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (actor) await touchOrg(actor.orgId);
  return actor;
}

export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) throw unauthorized();
  return a;
}

/** The visitor's IP: from the proxy header only when the proxy proved itself with its secret. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  if (config.proxySecret && h.get("x-proxy-secret") === config.proxySecret) {
    return h.get("x-visitor-ip") ?? "unknown";
  }
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, ...e.detail } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json({ error: { code: "bad_request", message: z.prettifyError(e) } }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

/** Wrap a route handler: JSON in, JSON out, AppErrors become their status codes. */
export function route<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<unknown>) {
  return async (req: Request, ctx: Ctx) => {
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => ({}));
  return schema.parse(raw);
}

/** For server-rendered pages: the signed-in person, or a redirect to the sign-in page. */
export async function pageActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a || a.via !== "app") redirect("/");
  return a;
}
