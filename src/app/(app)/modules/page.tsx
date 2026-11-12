import { pageActor } from "@/lib/http/handler";
import { listModules } from "@/lib/ratebook/queries";

export default async function Modules() {
  const mods = await listModules(await pageActor());
  return (
    <>
      <div><div className="crumb">Settings</div><h2>Modules</h2></div>
      <p className="empty-hint">Modules switch features on for the whole company. Ask the assistant to turn them on or off; QuickBooks sync is Owner-only.</p>
      <div className="mods">
        {mods.map((m) => (
          <div key={m.key} className="mod">
            <div><b>{m.name}</b> {m.requiredScope && <span className="tag">Owner only</span>}<p>{m.description}</p></div>
            <span className={`switch ${m.enabled ? "on" : ""}`} role="img" aria-label={m.enabled ? "On" : "Off"} />
          </div>
        ))}
      </div>
    </>
  );
}
