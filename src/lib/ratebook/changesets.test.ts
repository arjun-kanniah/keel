import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Actor, ROLE_SCOPES, type Role } from "../auth/roles";
import { actorFromRunToken, mintRunToken } from "../auth/actors";
import { pool, q } from "../db";
import { AppError } from "../errors";
import { createOrg } from "./seed";
import { apply, cancel, get, propose, requestApproval, undo, PolicyDenied } from "./changesets";
import { planApplyProfile, planBulkRate, planCreateItems, planModules, planSetRate } from "./plans";
import { findFolder, listItems, listModules, listProfiles } from "./queries";

let actors: Record<Role, Actor>;

async function newOrg() {
  const org = await createOrg();
  const names = { owner: "Dana Ruiz", admin: "Priya Shah", viewer: "Sam Okafor" };
  actors = Object.fromEntries(
    (["owner", "admin", "viewer"] as Role[]).map((r) => [
      r,
      { orgId: org.orgId, userId: org.users[r], userName: names[r], role: r, scopes: ROLE_SCOPES[r], via: "app" },
    ]),
  ) as Record<Role, Actor>;
}

async function rates(folder: string) {
  const f = await findFolder(actors.owner, folder);
  return Object.fromEntries((await listItems(actors.owner, { folderId: f.id })).map((i) => [i.name, i.rateCents]));
}

async function expectError(p: Promise<unknown>, status: number) {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).status).toBe(status);
  return e as AppError;
}

beforeEach(newOrg);
afterAll(() => pool().end());

describe("bulk rate change", () => {
  it("previews without writing, applies in one go, and undoes", async () => {
    const before = await rates("Commercial HVAC");
    const cs = await propose(actors.admin, await planBulkRate(actors.admin, { folder: "Commercial HVAC", pct: 10 }));
    expect(cs.status).toBe("proposed");
    expect(cs.ops).toHaveLength(8);
    expect(cs.needsOwner).toBe(false);
    expect(await rates("Commercial HVAC")).toEqual(before); // dry run wrote nothing

    const applied = await apply(actors.admin, cs.id, "k1");
    expect(applied.status).toBe("applied");
    expect(applied.canUndo).toBe(true);
    const after = await rates("Commercial HVAC");
    expect(after["Chiller inspection"]).toBe(57200);
    expect(after["VFD replacement"]).toBe(129800);

    const log = await q("SELECT action, actor_name FROM audit_events WHERE changeset_id = $1", [cs.id]);
    expect(log).toEqual([{ action: "changeset.applied", actor_name: "Priya Shah" }]);

    const undone = await undo(actors.admin, cs.id);
    expect(undone.status).toBe("undone");
    expect(await rates("Commercial HVAC")).toEqual(before);
  });

  it("refuses a Viewer before anything is stored", async () => {
    const plan = await planBulkRate(actors.viewer, { folder: "Plumbing", pct: 5 });
    const e = await expectError(propose(actors.viewer, plan), 403);
    expect(e).toBeInstanceOf(PolicyDenied);
    expect(e.message).toContain("rates:write");
    expect(await q("SELECT 1 FROM changesets WHERE org_id = $1", [actors.viewer.orgId])).toHaveLength(0);
  });

  it("needs an Owner above 20%", async () => {
    const cs = await propose(actors.admin, await planBulkRate(actors.admin, { folder: "Plumbing", pct: 30 }));
    expect(cs.needsOwner).toBe(true);
    expect(cs.policy.find((d) => d.rule === "owner_approval")?.outcome).toBe("owner");
    await expectError(apply(actors.admin, cs.id, "k"), 403);
    expect((await requestApproval(actors.admin, cs.id)).status).toBe("awaiting_owner");
    const done = await apply(actors.owner, cs.id, "k");
    expect(done.status).toBe("applied");
    expect(done.approvedByName).toBe("Dana Ruiz");
    expect((await rates("Plumbing"))["Plumber labor"]).toBe(14950);
  });

  it("rejects a stale preview and writes nothing at all", async () => {
    const before = await rates("Commercial HVAC");
    const cs = await propose(actors.admin, await planBulkRate(actors.admin, { folder: "Commercial HVAC", pct: 10 }));
    // Someone edits the last item in the changeset after the preview, so the earlier items
    // would already have been written if apply weren't all-or-nothing.
    const last = cs.ops[cs.ops.length - 1] as { itemId: string };
    const edit = await propose(actors.owner, await planSetRate(actors.owner, last.itemId, 30000));
    await apply(actors.owner, edit.id, "edit");
    const expected = { ...before, ...(await rates("Commercial HVAC")) };

    const e = await expectError(apply(actors.admin, cs.id, "k"), 409);
    expect(e.message).toContain("changed after the preview");
    expect(await rates("Commercial HVAC")).toEqual(expected);
    expect((await get(actors.admin, cs.id)).status).toBe("conflict");
    // And it can't be retried
    await expectError(apply(actors.admin, cs.id, "k2"), 409);
  });

  it("treats a retried apply with the same key as a no-op", async () => {
    const cs = await propose(actors.admin, await planBulkRate(actors.admin, { folder: "Plumbing", pct: 5 }));
    await apply(actors.admin, cs.id, "same");
    const once = await rates("Plumbing");
    await apply(actors.admin, cs.id, "same");
    expect(await rates("Plumbing")).toEqual(once);
    await expectError(apply(actors.admin, cs.id, "different"), 409);
    const log = await q("SELECT 1 FROM audit_events WHERE changeset_id = $1", [cs.id]);
    expect(log).toHaveLength(1);
  });

  it("can be cancelled and then never applied", async () => {
    const cs = await propose(actors.admin, await planBulkRate(actors.admin, { folder: "Plumbing", pct: 5 }));
    expect((await cancel(actors.admin, cs.id)).status).toBe("cancelled");
    await expectError(apply(actors.admin, cs.id, "k"), 409);
  });

  it("refuses rates below the floor", async () => {
    const plan = await planBulkRate(actors.owner, { folder: "Plumbing", pct: -50 });
    plan.ops = plan.ops.map((o) => (o.kind === "set_rate" ? { ...o, to: 50 } : o));
    await expectError(propose(actors.owner, plan), 403);
  });
});

describe("profiles", () => {
  it("creates a profile and applies it in one transaction, and undo removes both", async () => {
    const plan = await planApplyProfile(actors.admin, { newProfile: { name: "After-hours", multiplier: 1.5 }, itemType: "Call-out" });
    expect(plan.ops[0].kind).toBe("create_profile");
    expect(plan.ops.filter((o) => o.kind === "set_item_profile")).toHaveLength(4);
    const cs = await propose(actors.admin, plan);
    await apply(actors.admin, cs.id, "k");
    const ah = (await listProfiles(actors.admin)).find((p) => p.name === "After-hours");
    expect(ah?.itemCount).toBe(4);

    await undo(actors.admin, cs.id);
    expect((await listProfiles(actors.admin)).map((p) => p.name)).toEqual(["Standard"]);
  });

  it("can't undo once someone else has used the new profile", async () => {
    const cs = await propose(
      actors.admin,
      await planApplyProfile(actors.admin, { newProfile: { name: "Holiday", multiplier: 2 }, folder: "Plumbing", itemType: "Labor" }),
    );
    await apply(actors.admin, cs.id, "k");
    await apply(actors.owner, (await propose(actors.owner, await planApplyProfile(actors.owner, { profile: "Holiday", itemType: "Call-out" }))).id, "k2");
    await expectError(undo(actors.admin, cs.id), 409);
    expect((await listProfiles(actors.admin)).some((p) => p.name === "Holiday")).toBe(true);
  });
});

describe("modules", () => {
  it("lets an Admin turn on ordinary modules but not billing ones", async () => {
    await expectError(
      planModules(actors.admin, [{ key: "deposits", enabled: true }, { key: "qbo", enabled: true }]).then((p) => propose(actors.admin, p)),
      403,
    );
    const cs = await propose(actors.admin, await planModules(actors.admin, [{ key: "deposits", enabled: true }, { key: "sms", enabled: true }]));
    await apply(actors.admin, cs.id, "k");
    const mods = await listModules(actors.admin);
    expect(mods.filter((m) => m.enabled).map((m) => m.key)).toEqual(["booking", "portal", "deposits", "sms"]);

    const qbo = await propose(actors.owner, await planModules(actors.owner, [{ key: "qbo", enabled: true }]));
    await apply(actors.owner, qbo.id, "k");
    expect((await listModules(actors.owner)).find((m) => m.key === "qbo")?.enabled).toBe(true);
  });
});

describe("items", () => {
  it("adds an item and undo removes it", async () => {
    const cs = await propose(
      actors.admin,
      await planCreateItems(actors.admin, {
        folder: "Residential HVAC",
        items: [{ name: "Winter furnace plan", type: "Maintenance", rateCents: 24900, unit: "per year" }],
      }),
    );
    await apply(actors.admin, cs.id, "k");
    expect((await rates("Residential HVAC"))["Winter furnace plan"]).toBe(24900);
    await undo(actors.admin, cs.id);
    expect((await rates("Residential HVAC"))["Winter furnace plan"]).toBeUndefined();
  });
});

describe("credentials and isolation", () => {
  it("narrows the assistant's token to the tool's scopes", async () => {
    const token = mintRunToken({ ...actors.admin, via: "assistant" }, "run_x", ["rates:read"]);
    const narrowed = await actorFromRunToken(token);
    expect(narrowed.scopes).toEqual(["rates:read"]);
    expect(narrowed.via).toBe("assistant");
    const plan = await planBulkRate(narrowed, { folder: "Plumbing", pct: 5 });
    await expectError(propose(narrowed, plan), 403);
  });

  it("never grants more than the role, whatever the token asks for", async () => {
    const token = mintRunToken({ ...actors.viewer, via: "assistant" }, "run_x", ["rates:write", "rates:read"]);
    expect((await actorFromRunToken(token)).scopes).toEqual(["rates:read"]);
  });

  it("keeps orgs apart", async () => {
    const cs = await propose(actors.admin, await planBulkRate(actors.admin, { folder: "Plumbing", pct: 5 }));
    const mine = actors;
    await newOrg();
    await expectError(get(actors.owner, cs.id), 404);
    await expectError(apply(actors.owner, cs.id, "k"), 404);
    actors = mine;
  });

  it("keeps the audit log append-only", async () => {
    const cs = await propose(actors.admin, await planBulkRate(actors.admin, { folder: "Plumbing", pct: 5 }));
    await apply(actors.admin, cs.id, "k");
    await expect(q("UPDATE audit_events SET summary = 'x'")).rejects.toThrow(/append-only/);
    await expect(q("DELETE FROM audit_events")).rejects.toThrow(/append-only/);
  });
});
