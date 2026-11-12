"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent/run";
import { linkCitations, renderMarkdown } from "@/lib/markdown";
import type { Changeset, PolicyDecision } from "@/lib/ratebook/types";
import type { Citation, FormSpec } from "@/lib/tools/registry";
import { ChangesetCard } from "./ChangesetCard";

interface Step {
  kind: string;
  name: string;
  detail: string;
  ms: number;
}
interface Turn {
  id: number;
  user: string;
  text: string;
  steps: Step[];
  previews: Changeset[];
  form?: FormSpec;
  formDone?: boolean;
  citations: Citation[];
  policy?: { decisions: PolicyDecision[]; message: string };
  runId?: string;
  status?: string;
  error?: string;
  done: boolean;
}

const SUGGEST = [
  "How do I add after-hours pricing?",
  "Raise Commercial HVAC rates by 10%",
  "Create an 'After-hours' profile at 1.5x and apply it to all call-out items",
  "Turn on deposits, SMS reminders and QuickBooks sync",
  "Set up a winter maintenance plan",
  "Summarize the notes on Plumbing items",
  "Raise Plumbing rates by 30%",
];

const PAGE_LABELS: [string, string][] = [
  ["/rates", "Rate cards"],
  ["/profiles", "Profiles"],
  ["/modules", "Modules"],
  ["/activity", "Activity"],
  ["/changes", "Changes"],
  ["/traces", "Assistant traces"],
  ["/connect", "Connect"],
  ["/help", "Help center"],
];

function StepList({ steps, runId, live }: { steps: Step[]; runId?: string; live: boolean }) {
  if (!steps.length) return null;
  return (
    <details className="steps-wrap" open={live}>
      <summary>
        {steps.length} {steps.length === 1 ? "step" : "steps"}
        {runId && !live && <> · <Link href={`/traces/${runId}`}>full trace</Link></>}
      </summary>
      <div className="steps">
        {steps.map((s, i) => (
          <div className="step" key={i}>
            <span className={`kind ${s.kind}`}>{s.kind}</span>
            <span className="d"><code>{s.name}</code> {s.detail}</span>
            <span className="ms">{s.ms ? `${s.ms} ms` : ""}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function AskForm({ form, disabled, onSubmit }: { form: FormSpec; disabled: boolean; onSubmit: (values: Record<string, string>) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(form.fields.map((f) => [f.name, f.default !== undefined ? String(f.default) : f.options?.[0] ?? ""])),
  );
  return (
    <div className="card">
      <div className="card-h"><span>{form.title}</span></div>
      <div className="card-b">
        {form.intro && <p className="fine">{form.intro}</p>}
        <form
          className="mini"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(vals);
          }}
        >
          {form.fields.map((f, i) => (
            <label key={f.name} className={form.fields.length % 2 && i === 0 ? "wide" : undefined}>
              {f.label}
              {f.kind === "select" ? (
                <select disabled={disabled} value={vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}>
                  {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  disabled={disabled}
                  required
                  type={f.kind === "number" ? "number" : "text"}
                  step={f.kind === "number" ? "any" : undefined}
                  value={vals[f.name]}
                  onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
                />
              )}
            </label>
          ))}
          <div className="actions"><button className="btn" type="submit" disabled={disabled}>{form.submitLabel ?? "Continue"}</button></div>
        </form>
      </div>
    </div>
  );
}

export function AssistantPanel({
  user,
  folders,
  enabled,
  model,
}: {
  user: { id: string; name: string; role: string; roleLabel: string; scopes: string[] };
  folders: { id: string; name: string }[];
  enabled: boolean;
  model: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const storeKey = `keel:chat:${user.id}`;

  // A conversation belongs to one person: switching persona starts a fresh one
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storeKey) ?? "null");
      setTurns(saved?.turns ?? []);
      setSessionId(saved?.sessionId);
    } catch {
      setTurns([]);
      setSessionId(undefined);
    }
  }, [storeKey]);
  useEffect(() => {
    try {
      if (!busy) sessionStorage.setItem(storeKey, JSON.stringify({ turns: turns.slice(-20), sessionId }));
    } catch {}
  }, [turns, sessionId, busy, storeKey]);
  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [turns]);

  const page = useMemo(() => {
    const label = PAGE_LABELS.find(([p]) => path.startsWith(p))?.[1] ?? "Ratebook";
    if (path.startsWith("/rates")) {
      const f = folders.find((x) => x.id === params.get("folder")) ?? folders[0];
      return { path, label, folderId: f?.id, folderName: f?.name };
    }
    return { path, label };
  }, [path, params, folders]);

  function update(id: number, fn: (t: Turn) => Turn) {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }

  async function ask(message: string, display?: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    const id = Date.now();
    setTurns((ts) => [...ts, { id, user: display ?? message, text: "", steps: [], previews: [], citations: [], done: false }]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, page, sessionId }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        update(id, (t) => ({ ...t, error: j?.error?.message ?? `Request failed (${res.status})`, done: true }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/^data: /, "");
          buf = buf.slice(idx + 2);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AgentEvent;
          handle(id, e);
        }
      }
    } catch {
      update(id, (t) => ({ ...t, error: "Lost the connection to the assistant.", done: true }));
    } finally {
      update(id, (t) => ({ ...t, done: true }));
      setBusy(false);
      router.refresh();
    }
  }

  function handle(id: number, e: AgentEvent) {
    switch (e.type) {
      case "run":
        setSessionId(e.sessionId);
        update(id, (t) => ({ ...t, runId: e.runId }));
        break;
      case "text":
        update(id, (t) => ({ ...t, text: t.text + e.delta }));
        break;
      case "step":
        update(id, (t) => ({ ...t, steps: [...t.steps, { kind: e.kind, name: e.name, detail: e.detail, ms: e.ms }] }));
        break;
      case "preview":
        update(id, (t) => ({ ...t, previews: [...t.previews, e.changeset] }));
        break;
      case "form":
        update(id, (t) => ({ ...t, form: e.form }));
        break;
      case "citations":
        update(id, (t) => ({ ...t, citations: [...t.citations.filter((c) => !e.citations.some((x) => x.id === c.id)), ...e.citations] }));
        break;
      case "policy":
        update(id, (t) => ({ ...t, policy: { decisions: e.decisions, message: e.message } }));
        break;
      case "error":
        update(id, (t) => ({ ...t, error: e.message }));
        break;
      case "done":
        update(id, (t) => ({ ...t, status: e.status, done: true }));
        break;
    }
  }

  function submitForm(id: number, form: FormSpec, values: Record<string, string>) {
    update(id, (t) => ({ ...t, formDone: true }));
    const lines = form.fields.map((f) => `${f.label}: ${values[f.name]}`).join("; ");
    ask(`Form "${form.title}" answers (JSON): ${JSON.stringify(values)}`, lines);
  }

  function startOver() {
    setTurns([]);
    setSessionId(undefined);
  }

  return (
    <>
      <button className="btn agent-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="assistant">
        {open ? "Close assistant" : "Assistant"}
      </button>
      <aside className={`agent ${open ? "open" : ""}`} id="assistant" aria-label="Assistant" data-busy={busy}>
        <div className="agent-head">
          <div>
            <b>Assistant</b> <span>· acts as {user.name} ({user.roleLabel})</span>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Context: {page.label}{page.folderName ? ` › ${page.folderName}` : ""} · {model}
            </div>
          </div>
          <button className="linkbtn" onClick={startOver} disabled={busy}>New chat</button>
        </div>
        <div className="msgs" ref={msgsRef} aria-live="polite">
          {!turns.length && (
            <div className="empty-agent">
              <p><b>Ask how to do something, or ask me to do it.</b></p>
              <p>I can look up your rate cards and prepare changes. Every change is a preview you approve, and you can undo it. I can only do what your role allows.</p>
              {!enabled && <p className="banner">The assistant isn't configured on this server (no API key), so it can't answer. Everything else works.</p>}
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} style={{ display: "contents" }}>
              <div className="msg user">{t.user}</div>
              <div className="msg bot">
                <StepList steps={t.steps} runId={t.runId} live={!t.done} />
                {t.policy && (
                  <div className="callout bad" style={{ marginBottom: 8 }}>
                    <b>Refused by policy.</b> {t.policy.decisions.filter((d) => d.outcome === "deny").map((d) => d.message).join(" ")}{" "}
                    The API checks this on every call, so nothing was prepared.
                  </div>
                )}
                {(t.text || !t.done) && (
                  <div
                    className={`text ${!t.done ? "cursor" : ""}`}
                    dangerouslySetInnerHTML={{ __html: linkCitations(renderMarkdown(t.text), t.citations) }}
                  />
                )}
                {t.citations.length > 0 && t.done && (
                  <div className="cites" style={{ marginTop: 6 }}>
                    Sources:{" "}
                    {t.citations.map((c) => (
                      <a key={c.id} className="cite" href={c.helpUrl}>[{c.n}] {c.title}</a>
                    ))}
                    {t.citations[0] && <> · <Link href={t.citations[0].link}>Show me</Link></>}
                  </div>
                )}
                {t.previews.map((p) => (
                  <div key={p.id} style={{ marginTop: 8 }}>
                    <ChangesetCard changeset={p} viewer={{ role: user.role, scopes: user.scopes }} compact />
                  </div>
                ))}
                {t.form && (
                  <div style={{ marginTop: 8 }}>
                    <AskForm form={t.form} disabled={!!t.formDone || busy} onSubmit={(v) => submitForm(t.id, t.form!, v)} />
                  </div>
                )}
                {t.error && <div className="callout warn" style={{ marginTop: 8 }}>{t.error}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="suggest">
          {SUGGEST.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} disabled={busy || !enabled}>{s}</button>
          ))}
        </div>
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            const v = input;
            setInput("");
            ask(v);
          }}
        >
          <input
            aria-label="Ask the assistant"
            placeholder={enabled ? "Ask, or tell me what to change…" : "Assistant not configured"}
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            disabled={!enabled}
          />
          <button className="btn" type="submit" disabled={busy || !enabled || !input.trim()}>Send</button>
        </form>
      </aside>
    </>
  );
}
