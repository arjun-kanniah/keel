import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, actorFromSession, sessionCookieValue, sessionMaxAge } from "@/lib/auth/actors";
import { body, clientIp, route } from "@/lib/http/handler";
import { hit } from "@/lib/ratelimit";
import { createSandbox, userForRole } from "@/lib/ratebook/seed";

export const dynamic = "force-dynamic";

// Sign in as a persona. The first sign-in creates a private copy of the demo company; switching
// persona keeps the same copy, so an Admin's request can be approved by the Owner.
export const POST = route(async (req) => {
  const { role, fresh } = await body(req, z.object({ role: z.enum(["owner", "admin", "viewer"]), fresh: z.boolean().optional() }));
  const jar = await cookies();
  const current = fresh ? null : await actorFromSession(jar.get(SESSION_COOKIE)?.value);
  let orgId = current?.orgId;
  let userId = orgId ? await userForRole(orgId, role) : undefined;
  if (!orgId || !userId) {
    await hit(`sandbox:${await clientIp()}`, 20);
    const sb = await createSandbox();
    orgId = sb.orgId;
    userId = sb.users[role];
  }
  jar.set(SESSION_COOKIE, sessionCookieValue(orgId, userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAge,
  });
  return { ok: true, orgId };
});

export const DELETE = route(async () => {
  (await cookies()).delete(SESSION_COOKIE);
  return { ok: true };
});
