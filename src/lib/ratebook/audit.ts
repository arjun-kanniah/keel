import type { Actor } from "../auth/roles";
import type { Db } from "../db";

const VIA_LABEL = { app: "", assistant: " via Assistant", mcp: " via MCP" } as const;

/** "Priya Shah via Assistant": who did it, and how. */
export function actorLabel(actor: Actor): string {
  return `${actor.userName}${VIA_LABEL[actor.via]}`;
}

export async function audit(
  db: Db,
  actor: Actor,
  e: { action: string; summary: string; changesetId?: string; runId?: string | null; detail?: object },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (org_id, actor_id, actor_name, via, run_id, changeset_id, action, summary, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor.orgId,
      actor.userId,
      actorLabel(actor),
      actor.via,
      e.runId ?? actor.runId ?? null,
      e.changesetId ?? null,
      e.action,
      e.summary,
      JSON.stringify(e.detail ?? {}),
    ],
  );
}
