import type { Actor } from "../auth/roles";
import { badRequest, conflict } from "../errors";
import { money, mult, pct } from "../format";
import { newId } from "../ids";
import { findFolder, findProfile, getItem, listItems, listModules, listProfiles } from "./queries";
import type { Op, Plan } from "./types";

// Planners turn a request ("raise this folder by 10%") into the exact operations it implies,
// from the current data. They write nothing: the plan becomes a proposed changeset, and the
// person sees exactly these operations before anything is applied.

export async function planSetRate(actor: Actor, itemId: string, rateCents: number): Promise<Plan> {
  const it = await getItem(actor, itemId);
  const to = Math.round(rateCents);
  if (to === it.rateCents) throw badRequest(`${it.name} is already ${money(to)}`);
  return {
    summary: `Change ${it.name} from ${money(it.rateCents)} to ${money(to)}`,
    ops: [{ kind: "set_rate", itemId: it.id, itemName: it.name, from: it.rateCents, to, version: it.version }],
  };
}

export async function planBulkRate(
  actor: Actor,
  input: { folder: string; pct: number; itemType?: string },
): Promise<Plan> {
  const folder = await findFolder(actor, input.folder);
  const items = await listItems(actor, { folderId: folder.id, type: input.itemType });
  if (!items.length) {
    throw badRequest(`No ${input.itemType ? `${input.itemType} ` : ""}items in ${folder.name}`);
  }
  const ops: Op[] = items
    .map((it) => ({
      kind: "set_rate" as const,
      itemId: it.id,
      itemName: it.name,
      from: it.rateCents,
      to: Math.round(it.rateCents * (1 + input.pct / 100)),
      version: it.version,
    }))
    .filter((o) => o.to !== o.from);
  const what = input.itemType ? `${input.itemType} items in ${folder.name}` : `${folder.name} rates`;
  return { summary: `${input.pct >= 0 ? "Raise" : "Lower"} ${what} by ${Math.abs(input.pct)}% (${ops.length} items)`, ops };
}

export async function planApplyProfile(
  actor: Actor,
  input: {
    profile?: string;
    newProfile?: { name: string; multiplier: number };
    folder?: string;
    itemType?: string;
    itemIds?: string[];
  },
): Promise<Plan> {
  const ops: Op[] = [];
  let target: { id: string; name: string; multiplier: number };

  if (input.newProfile) {
    const name = input.newProfile.name.trim();
    if (!name) throw badRequest("The new profile needs a name");
    if (await findProfile(actor, name)) throw conflict(`A profile named ${name} already exists`);
    target = { id: newId("pf"), name, multiplier: Math.round(input.newProfile.multiplier * 100) / 100 };
    ops.push({ kind: "create_profile", profileId: target.id, name: target.name, multiplier: target.multiplier });
  } else if (input.profile) {
    const p = await findProfile(actor, input.profile);
    if (!p) throw badRequest(`No profile named ${input.profile}`);
    target = p;
  } else {
    throw badRequest("Name an existing profile or describe a new one");
  }

  const folder = input.folder ? await findFolder(actor, input.folder) : undefined;
  if (!folder && !input.itemType && !input.itemIds?.length) {
    throw badRequest("Say which items get the profile: a folder, an item type, or specific items");
  }
  const items = await listItems(actor, { folderId: folder?.id, type: input.itemType, itemIds: input.itemIds });
  const notes: string[] = [];
  for (const it of items) {
    if (it.profileId === target.id) continue;
    ops.push({
      kind: "set_item_profile",
      itemId: it.id,
      itemName: it.name,
      rateCents: it.rateCents,
      fromProfileId: it.profileId,
      fromProfileName: it.profileName,
      fromMultiplier: it.multiplier,
      toProfileId: target.id,
      toProfileName: target.name,
      toMultiplier: target.multiplier,
      version: it.version,
    });
  }
  if (!items.length) notes.push("No items matched, so only the profile would be created.");
  const scope = [input.itemType && `${input.itemType} items`, folder && `in ${folder.name}`].filter(Boolean).join(" ") || "the chosen items";
  const applied = ops.filter((o) => o.kind === "set_item_profile").length;
  const summary = input.newProfile
    ? `Create profile ${target.name} (${mult(target.multiplier)}) and apply it to ${applied} ${scope}`
    : `Apply profile ${target.name} (${mult(target.multiplier)}) to ${applied} ${scope}`;
  return { summary, ops, notes };
}

export async function planModules(actor: Actor, changes: { key: string; enabled: boolean }[]): Promise<Plan> {
  const mods = await listModules(actor);
  const ops: Op[] = [];
  const notes: string[] = [];
  for (const ch of changes) {
    const m = mods.find((x) => x.key === ch.key || x.name.toLowerCase() === ch.key.toLowerCase());
    if (!m) throw badRequest(`No module called ${ch.key}. Modules: ${mods.map((x) => x.key).join(", ")}`);
    if (m.enabled === ch.enabled) {
      notes.push(`${m.name} is already ${m.enabled ? "on" : "off"}.`);
      continue;
    }
    ops.push({ kind: "set_module", key: m.key, name: m.name, from: m.enabled, to: ch.enabled, version: m.version, requiredScope: m.requiredScope });
  }
  const on = ops.filter((o) => o.kind === "set_module" && o.to).map((o) => (o as { name: string }).name);
  const off = ops.filter((o) => o.kind === "set_module" && !o.to).map((o) => (o as { name: string }).name);
  const summary = [on.length && `Turn on ${on.join(", ")}`, off.length && `turn off ${off.join(", ")}`]
    .filter(Boolean)
    .join("; ") || "No module changes";
  return { summary: summary[0].toUpperCase() + summary.slice(1), ops, notes };
}

export async function planCreateItems(
  actor: Actor,
  input: { folder: string; items: { name: string; type: string; rateCents: number; unit: string; note?: string }[] },
): Promise<Plan> {
  const folder = await findFolder(actor, input.folder);
  const existing = await listItems(actor, { folderId: folder.id });
  const std = (await listProfiles(actor)).find((p) => p.isDefault);
  if (!std) throw conflict("No default profile");
  const ops: Op[] = [];
  for (const it of input.items) {
    const name = it.name.trim();
    if (!name) throw badRequest("Every item needs a name");
    if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      throw conflict(`${folder.name} already has an item called ${name}`);
    }
    ops.push({
      kind: "create_item",
      item: {
        id: newId("it"),
        folderId: folder.id,
        folderName: folder.name,
        name,
        type: it.type.trim() || "Maintenance",
        rateCents: Math.round(it.rateCents),
        unit: it.unit.trim() || "each",
        profileId: std.id,
        note: (it.note ?? "").slice(0, 300),
      },
    });
  }
  const names = input.items.map((i) => i.name.trim()).join(", ");
  return { summary: `Add ${names} to ${folder.name}`, ops };
}

/** One line per operation, for tool results and the audit log. */
export function describeOp(op: Op): string {
  switch (op.kind) {
    case "set_rate":
      return `${op.itemName}: ${money(op.from)} → ${money(op.to)} (${pct(((op.to - op.from) / op.from) * 100)})`;
    case "set_item_profile":
      return `${op.itemName}: profile ${op.fromProfileName} → ${op.toProfileName} (charged ${money(op.rateCents * op.fromMultiplier)} → ${money(op.rateCents * op.toMultiplier)})`;
    case "create_profile":
      return `New profile ${op.name} at ${mult(op.multiplier)}`;
    case "delete_profile":
      return `Remove profile ${op.name}`;
    case "set_module":
      return `${op.name}: ${op.from ? "on" : "off"} → ${op.to ? "on" : "off"}`;
    case "create_item":
      return `New item ${op.item.name} in ${op.item.folderName}: ${money(op.item.rateCents)} ${op.item.unit}`;
    case "delete_item":
      return `Remove item ${op.itemName}`;
  }
}
