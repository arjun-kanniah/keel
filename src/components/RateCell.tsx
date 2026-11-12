"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/format";

// Click a rate to edit it. The edit goes through the same changeset path as everything else
// (proposed and applied at once), so it's version-checked and shows on the Activity page.
export function RateCell({ itemId, cents, unit, canEdit }: { itemId: string; cents: number; unit: string; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(cents / 100));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const rate = Number(val);
    if (!Number.isFinite(rate) || rate <= 0) return setErr("Enter a positive amount");
    if (Math.round(rate * 100) === cents) return setEditing(false);
    setBusy(true);
    const r = await fetch(`/api/v1/items/${itemId}/rate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rate }) });
    setBusy(false);
    if (!r.ok) return setErr((await r.json().catch(() => null))?.error?.message ?? "Failed");
    setEditing(false);
    setErr("");
    router.refresh();
  }

  if (!canEdit) return <>{money(cents)}<span className="sub">{unit}</span></>;
  if (!editing) {
    return (
      <>
        <button className="rate-btn" onClick={() => setEditing(true)} title="Change rate">{money(cents)}</button>
        <span className="sub">{unit}</span>
      </>
    );
  }
  return (
    <>
      <input
        className="rate-input"
        autoFocus
        inputMode="decimal"
        aria-label="New rate in dollars"
        value={val}
        disabled={busy}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => !busy && !err && setEditing(false)}
      />
      {err && <span className="err">{err}</span>}
    </>
  );
}
