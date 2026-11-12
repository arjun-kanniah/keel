import { type Actor, type Scope, ROLE_LABEL, hasScope } from "../auth/roles";
import type { Op, PolicyDecision } from "../ratebook/types";
import { money, pct } from "../format";

// The policy engine: plain code, run inside the API on every proposal and again on apply.
// Nothing here depends on what a model says, so a prompt can't talk its way past it.

export const LIMITS = {
  /** Records one changeset may touch. */
  maxRecords: 50,
  /** A rate change beyond this (either way) needs an Owner to approve. */
  ownerApprovalPct: 20,
  /** Rates outside this range are refused outright. */
  minRateCents: 100,
  maxRateCents: 1_000_000,
  /** Profile multipliers outside this range are refused. */
  minMultiplier: 0.5,
  maxMultiplier: 3,
  /** Proposals expire if nobody approves them. */
  proposalMinutes: 30,
  /** Applied changesets can be undone for this long. */
  undoHours: 24,
} as const;

/** Scopes each kind of operation needs, checked against the caller's scopes. */
export function scopesFor(op: Op): Scope[] {
  switch (op.kind) {
    case "set_rate":
    case "create_item":
    case "delete_item":
      return ["rates:write"];
    case "set_item_profile":
    case "create_profile":
    case "delete_profile":
      return ["profiles:write"];
    case "set_module":
      return op.requiredScope ? ["modules:write", op.requiredScope as Scope] : ["modules:write"];
  }
}

function touched(op: Op): string {
  switch (op.kind) {
    case "set_rate":
    case "set_item_profile":
    case "delete_item":
      return `item:${op.itemId}`;
    case "create_item":
      return `item:${op.item.id}`;
    case "create_profile":
    case "delete_profile":
      return `profile:${op.profileId}`;
    case "set_module":
      return `module:${op.key}`;
  }
}

export interface PolicyResult {
  decisions: PolicyDecision[];
  denied: boolean;
  needsOwner: boolean;
  records: number;
}

export function evaluate(actor: Actor, ops: Op[], opts: { undo?: boolean } = {}): PolicyResult {
  const d: PolicyDecision[] = [];
  const role = ROLE_LABEL[actor.role];

  if (ops.length === 0) {
    d.push({ rule: "non_empty", outcome: "deny", message: "Nothing would change." });
  }

  const missing = new Set<Scope>();
  for (const op of ops) for (const s of scopesFor(op)) if (!hasScope(actor, s)) missing.add(s);
  if (missing.size) {
    d.push({
      rule: "scopes",
      outcome: "deny",
      message: `${role} role lacks ${[...missing].join(", ")}.`,
    });
  } else if (ops.length) {
    d.push({ rule: "scopes", outcome: "allow", message: `${role} has the scopes this change needs.` });
  }

  const records = new Set(ops.map(touched)).size;
  if (records > LIMITS.maxRecords) {
    d.push({
      rule: "max_records",
      outcome: "deny",
      message: `Touches ${records} records; the limit for one change is ${LIMITS.maxRecords}.`,
    });
  } else if (ops.length) {
    d.push({ rule: "max_records", outcome: "allow", message: `${records} of max ${LIMITS.maxRecords} records.` });
  }

  // Undo restores values that were already accepted, so only scopes and size apply to it.
  if (!opts.undo) {
    let biggest = 0;
    for (const op of ops) {
      if (op.kind === "set_rate") {
        if (op.to < LIMITS.minRateCents || op.to > LIMITS.maxRateCents) {
          d.push({
            rule: "rate_bounds",
            outcome: "deny",
            message: `${op.itemName} would be ${money(op.to)}; rates must be between ${money(LIMITS.minRateCents)} and ${money(LIMITS.maxRateCents)}.`,
          });
        }
        if (op.from > 0) biggest = Math.max(biggest, Math.abs((op.to - op.from) / op.from) * 100);
      }
      if (op.kind === "create_item" && (op.item.rateCents < LIMITS.minRateCents || op.item.rateCents > LIMITS.maxRateCents)) {
        d.push({ rule: "rate_bounds", outcome: "deny", message: `${op.item.name}: rate must be between ${money(LIMITS.minRateCents)} and ${money(LIMITS.maxRateCents)}.` });
      }
      if (op.kind === "create_profile" && (op.multiplier < LIMITS.minMultiplier || op.multiplier > LIMITS.maxMultiplier)) {
        d.push({
          rule: "multiplier_bounds",
          outcome: "deny",
          message: `Profile multipliers must be between ${LIMITS.minMultiplier}× and ${LIMITS.maxMultiplier}×.`,
        });
      }
    }
    if (biggest > LIMITS.ownerApprovalPct + 1e-9) {
      d.push({
        rule: "owner_approval",
        outcome: "owner",
        message: `A ${pct(biggest).replace("+", "")} change is above the ${LIMITS.ownerApprovalPct}% limit, so an Owner must approve it.`,
      });
    }
  }

  return {
    decisions: d,
    denied: d.some((x) => x.outcome === "deny"),
    needsOwner: d.some((x) => x.outcome === "owner"),
    records,
  };
}
