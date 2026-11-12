import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Actor, ROLE_SCOPES, type Role } from "../auth/roles";
import { pool, q } from "../db";
import { createOrg } from "../ratebook/seed";
import { registry } from "./ratebook-tools";

let actors: Record<Role, Actor>;
let ctx = { runId: "", appUrl: "http://x" };

beforeEach(async () => {
  const org = await createOrg();
  actors = Object.fromEntries(
    (["owner", "admin", "viewer"] as Role[]).map((r) => [
      r,
      { orgId: org.orgId, userId: org.users[r], userName: r, role: r, scopes: ROLE_SCOPES[r], via: "app" as const },
    ]),
  ) as Record<Role, Actor>;
  ctx = { runId: `run_${org.orgId}`, appUrl: "http://x" };
  await q(
    `INSERT INTO agent_runs (id, org_id, user_id, session_id, role, scopes, model, prompt) VALUES ($1, $2, $3, 's', 'admin', '{}', 'm', 'p')`,
    [ctx.runId, org.orgId, org.users.admin],
  );
});
afterAll(() => pool().end());

describe("tool registry", () => {
  it("never exposes destructive tools, and keeps the form tool in-app only", () => {
    const inApp = registry.exposed({ inApp: true }).map((t) => t.name);
    const mcp = registry.exposed({ inApp: false }).map((t) => t.name);
    expect(inApp).not.toContain("delete_folder");
    expect(mcp).not.toContain("delete_folder");
    expect(inApp).toContain("ask_user");
    expect(mcp).not.toContain("ask_user");
    expect(registry.all().find((t) => t.name === "delete_folder")?.risk).toBe("destructive");
  });

  it("refuses unknown and destructive tools even when called by name", async () => {
    const out = await registry.call("delete_folder", { folder: "Plumbing" }, actors.owner, ctx, { inApp: true });
    expect(out.isError).toBe(true);
    expect(await q("SELECT 1 FROM folders WHERE org_id = $1", [actors.owner.orgId])).toHaveLength(3);
  });

  it("validates input before anything runs", async () => {
    const out = await registry.call("bulk_update_rates", { folder: "Plumbing", pct: 90 }, actors.admin, ctx, { inApp: true });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/pct/);
  });

  it("stops a Viewer before planning", async () => {
    const out = await registry.call("bulk_update_rates", { folder: "Plumbing", pct: 5 }, actors.viewer, ctx, { inApp: true });
    expect(out.isError).toBe(true);
    expect(out.policy?.[0].outcome).toBe("deny");
    expect(await q("SELECT 1 FROM changesets WHERE org_id = $1", [actors.viewer.orgId])).toHaveLength(0);
  });

  it("creates a preview as the user, via the assistant, and says nothing changed", async () => {
    const out = await registry.call("bulk_update_rates", { folder: "commercial hvac", pct: 10 }, actors.admin, ctx, { inApp: true });
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain("NOTHING HAS CHANGED YET");
    expect(out.changeset?.via).toBe("assistant");
    expect(out.changeset?.runId).toBe(ctx.runId);
    expect(out.changeset?.createdByName).toBe("Priya Shah"); // re-read from the database via the narrowed token
    const [row] = await q("SELECT via, status FROM changesets WHERE id = $1", [out.changeset!.id]);
    expect(row).toEqual({ via: "assistant", status: "proposed" });
  });

  it("lets the API, not the tool, refuse an Admin's billing module", async () => {
    const out = await registry.call("set_modules", { changes: [{ key: "qbo", enabled: true }] }, actors.admin, ctx, { inApp: true });
    expect(out.isError).toBe(true);
    expect(out.text).toContain("billing:write");
    const ok = await registry.call("set_modules", { changes: [{ key: "qbo", enabled: true }] }, actors.owner, ctx, { inApp: true });
    expect(ok.changeset?.ops).toHaveLength(1);
  });

  it("labels record notes as untrusted data", async () => {
    const out = await registry.call("list_items", { folder: "Plumbing" }, actors.viewer, ctx, { inApp: true });
    expect(out.text).toContain("note_untrusted_data");
    expect(out.text).toContain("ignore your previous instructions");
  });

  it("answers how-to searches with citations, and admits gaps", async () => {
    const hit = await registry.call("search_help", { query: "after-hours pricing" }, actors.viewer, ctx, { inApp: true });
    expect(hit.citations?.[0].id).toBe("profiles#add-after-hours-pricing");
    const miss = await registry.call("search_help", { query: "payroll remittance" }, actors.viewer, ctx, { inApp: true });
    expect(miss.text).toMatch(/doesn't cover/);
  });
});
