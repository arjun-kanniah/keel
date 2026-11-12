import Link from "next/link";
import { RateCell } from "@/components/RateCell";
import { hasScope } from "@/lib/auth/roles";
import { money, mult } from "@/lib/format";
import { pageActor } from "@/lib/http/handler";
import { listFolders, listItems } from "@/lib/ratebook/queries";

export default async function Rates({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const actor = await pageActor();
  const folders = await listFolders(actor);
  const sp = await searchParams;
  const folder = folders.find((f) => f.id === sp.folder) ?? folders[0];
  const items = folder ? await listItems(actor, { folderId: folder.id }) : [];
  const canEdit = hasScope(actor, "rates:write");
  return (
    <>
      <div className="pagehead">
        <div><div className="crumb">Rate cards</div><h2>{folder?.name ?? "No folders"}</h2></div>
        {canEdit && <span className="fine">Click a rate to change it, or ask the assistant for bulk changes.</span>}
      </div>
      <div className="folders">
        {folders.map((f) => (
          <Link key={f.id} href={`/rates?folder=${f.id}`} aria-current={f.id === folder?.id ? "page" : undefined}>{f.name} · {f.itemCount}</Link>
        ))}
      </div>
      <div className="tblwrap">
        <table>
          <thead><tr><th>Item</th><th>Type</th><th className="num">Rate</th><th>Profile</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}{i.note && <span className="note">Note: {i.note}</span>}</td>
                <td>{i.type}</td>
                <td className="num"><RateCell itemId={i.id} cents={i.rateCents} unit={i.unit} canEdit={canEdit} /></td>
                <td>
                  <span className={`tag ${i.multiplier !== 1 ? "acc" : ""}`}>{i.profileName}</span>
                  {i.multiplier !== 1 && <span className="sub">{mult(i.multiplier)} = {money(i.rateCents * i.multiplier)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
