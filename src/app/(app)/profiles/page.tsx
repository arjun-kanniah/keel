import { mult } from "@/lib/format";
import { pageActor } from "@/lib/http/handler";
import { listProfiles } from "@/lib/ratebook/queries";

export default async function Profiles() {
  const profiles = await listProfiles(await pageActor());
  return (
    <>
      <div><div className="crumb">Pricing</div><h2>Profiles</h2></div>
      <p className="empty-hint">A profile multiplies the rate of every item it's applied to, for example after-hours or holiday pricing. Ask the assistant to create one and apply it.</p>
      <div className="profiles">
        {profiles.map((p) => (
          <div key={p.id} className="prof">
            <b>{p.name}{p.isDefault && <span className="tag" style={{ marginLeft: 6 }}>Default</span>}</b>
            <span className="big">{mult(p.multiplier)}</span>
            <span className="sub">{p.itemCount} {p.itemCount === 1 ? "item" : "items"}</span>
          </div>
        ))}
      </div>
    </>
  );
}
