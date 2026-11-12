// The operations a changeset can hold. Each records the value it expects to replace and the
// record version it was previewed against, so apply can tell when the preview has gone stale.

export interface NewItem {
  id: string;
  folderId: string;
  folderName: string;
  name: string;
  type: string;
  rateCents: number;
  unit: string;
  profileId: string;
  note: string;
}

export type Op =
  | { kind: "set_rate"; itemId: string; itemName: string; from: number; to: number; version: number }
  | {
      kind: "set_item_profile";
      itemId: string;
      itemName: string;
      rateCents: number;
      fromProfileId: string;
      fromProfileName: string;
      fromMultiplier: number;
      toProfileId: string;
      toProfileName: string;
      toMultiplier: number;
      version: number;
    }
  | { kind: "create_profile"; profileId: string; name: string; multiplier: number }
  // delete_profile and delete_item only appear in undo (inverse) changesets
  | { kind: "delete_profile"; profileId: string; name: string; multiplier: number; version: number }
  | { kind: "set_module"; key: string; name: string; from: boolean; to: boolean; version: number; requiredScope: string | null }
  | { kind: "create_item"; item: NewItem }
  | { kind: "delete_item"; itemId: string; itemName: string; version: number; item: NewItem };

export type ChangesetStatus = "proposed" | "awaiting_owner" | "applied" | "cancelled" | "conflict" | "undone" | "expired";

export interface PolicyDecision {
  rule: string;
  outcome: "allow" | "deny" | "owner";
  message: string;
}

export interface Changeset {
  id: string;
  orgId: string;
  createdBy: string;
  createdByName: string;
  via: "app" | "assistant" | "mcp";
  runId: string | null;
  tool: string | null;
  summary: string;
  status: ChangesetStatus;
  ops: Op[];
  risk: "write" | "bulk";
  needsOwner: boolean;
  policy: PolicyDecision[];
  approvedByName: string | null;
  statusReason: string | null;
  createdAt: string;
  expiresAt: string;
  appliedAt: string | null;
  undoneAt: string | null;
  canUndo: boolean;
}

export interface Plan {
  summary: string;
  ops: Op[];
  /** Extra notes for the preview, e.g. items skipped and why. */
  notes?: string[];
}
