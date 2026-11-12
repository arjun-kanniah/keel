import { type Actor, hasScope } from "../auth/roles";
import { type Db, one, pool, q } from "../db";
import { forbidden, notFound } from "../errors";

// Reads. Every one is scoped to the caller's org and needs rates:read.

function canRead(actor: Actor) {
  if (!hasScope(actor, "rates:read")) throw forbidden("Missing rates:read");
}

export interface Folder {
  id: string;
  name: string;
  itemCount: number;
}
export interface Item {
  id: string;
  folderId: string;
  folderName: string;
  name: string;
  type: string;
  rateCents: number;
  unit: string;
  profileId: string;
  profileName: string;
  multiplier: number;
  note: string;
  version: number;
}
export interface Profile {
  id: string;
  name: string;
  multiplier: number;
  isDefault: boolean;
  itemCount: number;
  version: number;
}
export interface Module {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  requiredScope: string | null;
  version: number;
}
export interface ActivityRow {
  id: number;
  at: string;
  actorName: string;
  via: string;
  runId: string | null;
  changesetId: string | null;
  action: string;
  summary: string;
}

export async function listFolders(actor: Actor, db: Db = pool()): Promise<Folder[]> {
  canRead(actor);
  return q<Folder>(
    `SELECT f.id, f.name, count(i.id)::int AS "itemCount"
       FROM folders f LEFT JOIN items i ON i.folder_id = f.id
      WHERE f.org_id = $1 GROUP BY f.id ORDER BY f.position, f.name`,
    [actor.orgId],
    db,
  );
}

/** Find a folder by id or by name (case-insensitive), so tools can take either. */
export async function findFolder(actor: Actor, idOrName: string, db: Db = pool()): Promise<Folder> {
  canRead(actor);
  const f = await one<Folder>(
    `SELECT f.id, f.name, (SELECT count(*)::int FROM items i WHERE i.folder_id = f.id) AS "itemCount"
       FROM folders f WHERE f.org_id = $1 AND (f.id = $2 OR lower(f.name) = lower($2))`,
    [actor.orgId, idOrName.trim()],
    db,
  );
  if (!f) throw notFound(`Folder "${idOrName}"`);
  return f;
}

const ITEM_SELECT = `
  SELECT i.id, i.folder_id AS "folderId", f.name AS "folderName", i.name, i.type, i.rate_cents AS "rateCents",
         i.unit, i.profile_id AS "profileId", p.name AS "profileName", p.multiplier, i.note, i.version
    FROM items i JOIN folders f ON f.id = i.folder_id JOIN profiles p ON p.id = i.profile_id`;

export async function listItems(
  actor: Actor,
  filter: { folderId?: string; type?: string; profileId?: string; itemIds?: string[] } = {},
  db: Db = pool(),
): Promise<Item[]> {
  canRead(actor);
  const where = ["i.org_id = $1"];
  const params: unknown[] = [actor.orgId];
  if (filter.folderId) where.push(`i.folder_id = $${params.push(filter.folderId)}`);
  if (filter.type) where.push(`lower(i.type) = lower($${params.push(filter.type)})`);
  if (filter.profileId) where.push(`i.profile_id = $${params.push(filter.profileId)}`);
  if (filter.itemIds) where.push(`i.id = ANY($${params.push(filter.itemIds)})`);
  return q<Item>(`${ITEM_SELECT} WHERE ${where.join(" AND ")} ORDER BY f.position, i.position, i.name`, params, db);
}

export async function getItem(actor: Actor, id: string, db: Db = pool()): Promise<Item> {
  canRead(actor);
  const it = await one<Item>(`${ITEM_SELECT} WHERE i.org_id = $1 AND i.id = $2`, [actor.orgId, id], db);
  if (!it) throw notFound(`Item ${id}`);
  return it;
}

export async function listItemTypes(actor: Actor): Promise<string[]> {
  canRead(actor);
  const rows = await q<{ type: string }>("SELECT DISTINCT type FROM items WHERE org_id = $1 ORDER BY type", [actor.orgId]);
  return rows.map((r) => r.type);
}

export async function listProfiles(actor: Actor, db: Db = pool()): Promise<Profile[]> {
  canRead(actor);
  return q<Profile>(
    `SELECT p.id, p.name, p.multiplier, p.is_default AS "isDefault", p.version,
            (SELECT count(*)::int FROM items i WHERE i.profile_id = p.id) AS "itemCount"
       FROM profiles p WHERE p.org_id = $1 ORDER BY p.is_default DESC, p.name`,
    [actor.orgId],
    db,
  );
}

export async function findProfile(actor: Actor, idOrName: string, db: Db = pool()): Promise<Profile | undefined> {
  canRead(actor);
  return one<Profile>(
    `SELECT p.id, p.name, p.multiplier, p.is_default AS "isDefault", p.version,
            (SELECT count(*)::int FROM items i WHERE i.profile_id = p.id) AS "itemCount"
       FROM profiles p WHERE p.org_id = $1 AND (p.id = $2 OR lower(p.name) = lower($2))`,
    [actor.orgId, idOrName.trim()],
    db,
  );
}

export async function listModules(actor: Actor, db: Db = pool()): Promise<Module[]> {
  canRead(actor);
  return q<Module>(
    `SELECT key, name, description, enabled, required_scope AS "requiredScope", version
       FROM modules WHERE org_id = $1 ORDER BY position`,
    [actor.orgId],
    db,
  );
}

export async function listActivity(actor: Actor, limit = 100): Promise<ActivityRow[]> {
  canRead(actor);
  return q<ActivityRow>(
    `SELECT id, at, actor_name AS "actorName", via, run_id AS "runId", changeset_id AS "changesetId", action, summary
       FROM audit_events WHERE org_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
    [actor.orgId, Math.min(limit, 500)],
  );
}
