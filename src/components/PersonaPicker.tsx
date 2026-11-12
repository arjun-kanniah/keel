"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PERSONAS = [
  { role: "admin", name: "Priya Shah", label: "Admin", blurb: "Office manager. Can change rates, profiles and modules; large changes go to an Owner." },
  { role: "owner", name: "Dana Ruiz", label: "Owner", blurb: "Owns the business. Can do everything, including billing, and approves large changes." },
  { role: "viewer", name: "Sam Okafor", label: "Viewer", blurb: "Technician. Can look things up and ask how-to questions, but can't change anything." },
] as const;

export function PersonaPicker({ fresh = false }: { fresh?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function signIn(role: string) {
    setBusy(role);
    setErr("");
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, fresh }) });
    if (!r.ok) {
      setErr((await r.json().catch(() => null))?.error?.message ?? "Couldn't sign in");
      setBusy(null);
      return;
    }
    router.push("/rates");
    router.refresh();
  }

  return (
    <div>
      <div className="personas">
        {PERSONAS.map((p) => (
          <button key={p.role} className="persona-card" onClick={() => signIn(p.role)} disabled={!!busy}>
            <span className="role">{p.label}</span>
            <b>{p.name}</b>
            <p>{p.blurb}</p>
            <span className="muted" style={{ fontSize: 12 }}>{busy === p.role ? "Signing in…" : "Sign in →"}</span>
          </button>
        ))}
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
