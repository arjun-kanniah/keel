"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogoMark } from "./Logo";

const LINKS: [string, string, string?][] = [
  ["/rates", "Rate cards", "Pricing"],
  ["/profiles", "Profiles"],
  ["/modules", "Modules", "Settings"],
  ["/connect", "Connect (MCP)"],
  ["/activity", "Activity", "Audit"],
  ["/changes", "Changes"],
  ["/traces", "Assistant traces"],
  ["/help", "Help center", "Help"],
];

export function Nav({ user, waiting }: { user: { name: string; role: string }; waiting: number }) {
  const path = usePathname();
  const router = useRouter();

  async function switchTo(role: string) {
    await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
    router.refresh();
  }
  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="nav" aria-label="Ratebook">
      <div className="logo">
        <Link href="/rates"><LogoMark /><span>Ratebook<small>Northwind Mechanical</small></span></Link>
      </div>
      <div className="navlist">
        {LINKS.map(([href, label, group]) => (
          <div key={href} style={{ display: "contents" }}>
            {group && <div className="group">{group}</div>}
            <Link href={href} aria-current={path.startsWith(href) ? "page" : undefined}>
              {label}
              {href === "/changes" && waiting > 0 && <span className="tag acc" title="Waiting for an Owner">{waiting}</span>}
            </Link>
          </div>
        ))}
      </div>
      <div className="persona">
        <span>Signed in as</span>
        <span className="who">{user.name} · {user.role}</span>
        <label className="row" style={{ gap: 6 }}>
          <span className="sr-only" style={{ position: "absolute", left: -9999 }}>Switch person</span>
          <select aria-label="Switch person" value="" onChange={(e) => e.target.value && switchTo(e.target.value)}>
            <option value="">Switch person…</option>
            <option value="admin">Priya Shah · Admin</option>
            <option value="owner">Dana Ruiz · Owner</option>
            <option value="viewer">Sam Okafor · Viewer</option>
          </select>
        </label>
        <button onClick={signOut}>Sign out</button>
      </div>
    </nav>
  );
}
