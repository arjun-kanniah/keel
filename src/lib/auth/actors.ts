import { createHash, randomBytes } from "node:crypto";
import { one, q } from "../db";
import { newId } from "../ids";
import { unauthorized } from "../errors";
import { sign, verify } from "./signing";
import { type Actor, type Role, type Scope, ROLE_SCOPES, intersect, isScope } from "./roles";

// Three ways in, one kind of Actor out. Scopes always come from the user's *current* role,
// narrowed by whatever the credential allows, so a credential can never grant more than the
// person has.

interface UserRow {
  id: string;
  org_id: string;
  name: string;
  role: Role;
}

async function loadUser(orgId: string, userId: string): Promise<UserRow | undefined> {
  return one<UserRow>("SELECT id, org_id, name, role FROM users WHERE id = $1 AND org_id = $2", [userId, orgId]);
}

// --- Session cookie (people using the app) ---

export const SESSION_COOKIE = "keel_session";
const SESSION_HOURS = 24;

interface SessionClaims {
  o: string;
  u: string;
  exp: number;
}

export function sessionCookieValue(orgId: string, userId: string): string {
  return sign("session", { o: orgId, u: userId, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 });
}
export const sessionMaxAge = SESSION_HOURS * 3600;

export async function actorFromSession(cookie: string | undefined): Promise<Actor | null> {
  const c = verify<SessionClaims>("session", cookie);
  if (!c) return null;
  const u = await loadUser(c.o, c.u);
  if (!u) return null;
  return { orgId: u.org_id, userId: u.id, userName: u.name, role: u.role, scopes: ROLE_SCOPES[u.role], via: "app" };
}

// --- Scoped run tokens (the assistant, acting on behalf of the signed-in user) ---

interface RunTokenClaims {
  o: string;
  u: string;
  r: string; // run id
  s: string[]; // scopes
  exp: number;
}

/** A short-lived token for one tool call: the user's identity, narrowed to the tool's scopes. */
export function mintRunToken(actor: Actor, runId: string, scopes: readonly Scope[], ttlSeconds = 300): string {
  const narrowed = intersect(actor.scopes, scopes);
  return sign("run", {
    o: actor.orgId,
    u: actor.userId,
    r: runId,
    s: narrowed,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

export async function actorFromRunToken(token: string): Promise<Actor> {
  const c = verify<RunTokenClaims>("run", token);
  if (!c) throw unauthorized("The assistant's token is invalid or expired");
  const u = await loadUser(c.o, c.u);
  if (!u) throw unauthorized("The user no longer exists");
  return {
    orgId: u.org_id,
    userId: u.id,
    userName: u.name,
    role: u.role,
    scopes: intersect(ROLE_SCOPES[u.role], c.s),
    via: "assistant",
    runId: c.r,
  };
}

// --- Personal access tokens (external MCP clients such as Claude Desktop) ---

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createApiToken(actor: Actor, name: string, scopes: string[]) {
  const wanted = scopes.filter(isScope);
  const granted = intersect(actor.scopes, wanted.length ? wanted : actor.scopes);
  const token = `kpat_${randomBytes(24).toString("base64url")}`;
  const id = newId("tok");
  await q(
    "INSERT INTO api_tokens (id, org_id, user_id, name, token_hash, scopes) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, actor.orgId, actor.userId, name.slice(0, 60) || "MCP client", hash(token), granted],
  );
  return { id, token, scopes: granted };
}

export async function actorFromApiToken(token: string): Promise<Actor | null> {
  if (!token.startsWith("kpat_")) return null;
  const row = await one<UserRow & { tid: string; scopes: string[] }>(
    `UPDATE api_tokens t SET last_used_at = now()
       FROM users u
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND u.id = t.user_id
      RETURNING t.id AS tid, t.scopes, u.id, u.org_id, u.name, u.role`,
    [hash(token)],
  );
  if (!row) return null;
  return {
    orgId: row.org_id,
    userId: row.id,
    userName: row.name,
    role: row.role,
    scopes: intersect(ROLE_SCOPES[row.role], row.scopes),
    via: "mcp",
  };
}
