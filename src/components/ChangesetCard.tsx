"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { money, mult, pct } from "@/lib/format";
import type { Changeset, Op } from "@/lib/ratebook/types";

export interface Viewer {
  role: string;
  scopes: string[];
}

function DiffRows({ ops }: { ops: Op[] }) {
  return (
    <>
      {ops.map((o, i) => {
        switch (o.kind) {
          case "set_rate":
            return (
              <tr key={i}>
                <td className="name">{o.itemName}</td>
                <td className="num"><span className="x">{money(o.from)}</span></td>
                <td className="num"><span className="new">{money(o.to)}</span></td>
                <td className="num muted">{pct(((o.to - o.from) / o.from) * 100)}</td>
              </tr>
            );
          case "set_item_profile":
            return (
              <tr key={i}>
                <td className="name">{o.itemName}</td>
                <td><span className="x">{o.fromProfileName}</span></td>
                <td><span className="new">{o.toProfileName}</span></td>
                <td className="num muted">{money(o.rateCents * o.toMultiplier)}</td>
              </tr>
            );
          case "create_profile":
            return (
              <tr key={i}>
                <td className="name">New profile <b>{o.name}</b></td>
                <td />
                <td><span className="new">{mult(o.multiplier)}</span></td>
                <td />
              </tr>
            );
          case "delete_profile":
            return (<tr key={i}><td className="name">Remove profile {o.name}</td><td /><td /><td /></tr>);
          case "set_module":
            return (
              <tr key={i}>
                <td className="name">{o.name}</td>
                <td><span className="x">{o.from ? "On" : "Off"}</span></td>
                <td><span className="new">{o.to ? "On" : "Off"}</span></td>
                <td>{o.requiredScope && <span className="tag">Owner only</span>}</td>
              </tr>
            );
          case "create_item":
            return (
              <tr key={i}>
                <td className="name">New: <b>{o.item.name}</b> <span className="sub">{o.item.folderName} · {o.item.type}</span></td>
                <td />
                <td className="num"><span className="new">{money(o.item.rateCents)}</span></td>
                <td className="muted">{o.item.unit}</td>
              </tr>
            );
          case "delete_item":
            return (<tr key={i}><td className="name">Remove {o.itemName}</td><td /><td /><td /></tr>);
        }
      })}
    </>
  );
}

function headers(ops: Op[]): [string, string, string, string] {
  const k = ops.find((o) => o.kind !== "create_profile")?.kind ?? ops[0]?.kind;
  if (k === "set_rate") return ["Item", "Now", "New", "Change"];
  if (k === "set_item_profile") return ["Item", "Profile now", "New profile", "Charged"];
  if (k === "set_module") return ["Module", "Now", "New", ""];
  return ["Change", "", "Value", ""];
}

const STATUS_TEXT: Record<Changeset["status"], [string, string]> = {
  proposed: ["muted", "Preview only. Nothing has changed yet."],
  awaiting_owner: ["warn", "Waiting for an Owner to approve."],
  applied: ["good", "Applied."],
  cancelled: ["muted", "Cancelled. Nothing changed."],
  conflict: ["bad", "Not applied."],
  undone: ["muted", "Undone. The old values are back."],
  expired: ["muted", "Expired. Nothing changed."],
};

export function ChangesetCard({
  changeset,
  viewer,
  onChange,
  compact = false,
}: {
  changeset: Changeset;
  viewer: Viewer;
  onChange?: (cs: Changeset) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [cs, setCs] = useState(changeset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per approval attempt: a retried click (or a network retry) can't apply twice
  const idem = useRef<string>(crypto.randomUUID());
  const isOwner = viewer.scopes.includes("changes:approve_large");

  // A card can outlive its changeset's status (restored in the assistant panel, or acted on
  // elsewhere, e.g. by an Owner on the Changes page), so an open card checks the current state.
  useEffect(() => {
    if (changeset.status !== "proposed" && changeset.status !== "awaiting_owner") return;
    let live = true;
    fetch(`/api/v1/changesets/${changeset.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j?.changeset && j.changeset.status !== changeset.status) {
          setCs(j.changeset);
          onChange?.(j.changeset);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [changeset.id, changeset.status]);
  const canWrite = viewer.role !== "viewer";

  async function act(action: "apply" | "undo" | "cancel" | "request-approval") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/changesets/${cs.id}/${action}`, {
        method: "POST",
        headers: action === "apply" ? { "idempotency-key": idem.current } : {},
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error?.message ?? "Failed");
        // Refetch: a conflict changes the status
        const fresh = await fetch(`/api/v1/changesets/${cs.id}`).then((x) => x.json()).catch(() => null);
        if (fresh?.changeset) {
          setCs(fresh.changeset);
          onChange?.(fresh.changeset);
        }
      } else {
        setCs(j.changeset);
        onChange?.(j.changeset);
        idem.current = crypto.randomUUID();
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const [kind, text] = STATUS_TEXT[cs.status];
  const h = headers(cs.ops);
  const ownerGate = cs.needsOwner && !isOwner;
  const open = cs.status === "proposed" || cs.status === "awaiting_owner";

  return (
    <div className="card">
      <div className="card-h">
        <span>{cs.summary}</span>
        <span className="mono">{cs.id}</span>
      </div>
      <div className="card-b">
        {!compact && (
          <p className="fine">
            {cs.via === "assistant" ? "Prepared by the assistant" : cs.via === "mcp" ? "Prepared by an MCP client" : "Made in the app"} for{" "}
            {cs.createdByName}
            {cs.runId && <> · <Link href={`/traces/${cs.runId}`}>trace</Link></>}
          </p>
        )}
        <div className="diff tblwrap">
          <table>
            <thead><tr>{h.map((x, i) => <th key={i} className={i && i !== 1 ? "num" : undefined}>{x}</th>)}</tr></thead>
            <tbody><DiffRows ops={cs.ops} /></tbody>
          </table>
        </div>
        <div className="chips">
          <span className="chip">{cs.ops.length} {cs.ops.length === 1 ? "change" : "changes"} · one transaction</span>
          {cs.policy.map((d) => (
            <span key={d.rule} className={`chip ${d.outcome === "allow" ? "good" : d.outcome === "owner" ? "warn" : "bad"}`} title={d.message}>
              {d.rule === "owner_approval" ? "Needs Owner (over 20%)" : d.rule === "scopes" ? "Role allowed" : d.rule === "max_records" ? "Within size limit" : d.rule.replace("_", " ")}
            </span>
          ))}
          {cs.status === "applied" && cs.canUndo && <span className="chip">Undo available 24 h</span>}
        </div>
        {open && canWrite && (
          <div className="actions">
            {cs.status === "proposed" && ownerGate ? (
              <button className="btn" disabled={busy} onClick={() => act("request-approval")}>Ask an Owner to approve</button>
            ) : (cs.status === "proposed" || isOwner) ? (
              <button className="btn" disabled={busy} onClick={() => act("apply")}>{busy ? "Applying…" : "Approve and apply"}</button>
            ) : null}
            <button className="btn ghost" disabled={busy} onClick={() => act("cancel")}>Cancel</button>
          </div>
        )}
      </div>
      <div className={`status ${error ? "bad" : kind}`}>
        <span>
          {error || text}
          {cs.status === "conflict" && cs.statusReason && !error && <> {cs.statusReason}. Ask again for a fresh preview.</>}
          {cs.status === "applied" && cs.approvedByName && <> Approved by {cs.approvedByName}.</>}
        </span>
        {cs.status === "applied" && cs.canUndo && canWrite && (
          <button className="btn ghost" disabled={busy} onClick={() => act("undo")}>Undo</button>
        )}
        {cs.status === "awaiting_owner" && !isOwner && <span className="fine">Switch to Dana Ruiz (Owner) to approve it.</span>}
      </div>
    </div>
  );
}
