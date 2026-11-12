// Roles and scopes. This table is the only place that decides who may do what; the API checks
// it on every call, whoever the caller is (the app, the assistant or an MCP client).

export const SCOPES = [
  "rates:read",
  "rates:write",
  "profiles:write",
  "modules:write",
  "billing:write",
  "changes:approve_large",
] as const;
export type Scope = (typeof SCOPES)[number];

export type Role = "owner" | "admin" | "viewer";

export const ROLE_SCOPES: Record<Role, Scope[]> = {
  owner: ["rates:read", "rates:write", "profiles:write", "modules:write", "billing:write", "changes:approve_large"],
  admin: ["rates:read", "rates:write", "profiles:write", "modules:write"],
  viewer: ["rates:read"],
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", viewer: "Viewer" };

export type Via = "app" | "assistant" | "mcp";

/** Who is calling, on whose behalf, with which scopes. */
export interface Actor {
  orgId: string;
  userId: string;
  userName: string;
  role: Role;
  scopes: Scope[];
  via: Via;
  runId?: string;
}

export function hasScope(actor: Pick<Actor, "scopes">, scope: Scope): boolean {
  return actor.scopes.includes(scope);
}

export function intersect(a: readonly Scope[], b: readonly string[]): Scope[] {
  return a.filter((s) => b.includes(s));
}

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
