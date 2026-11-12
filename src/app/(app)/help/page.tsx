import Link from "next/link";
import { helpPages } from "@/lib/help";

export default function HelpIndex() {
  return (
    <>
      <div><div className="crumb">Help</div><h2>Help center</h2></div>
      <p className="empty-hint">The assistant answers how-to questions from these pages only, and links the sections it used.</p>
      <ul>
        {helpPages().map((p) => (
          <li key={p.slug}><Link href={`/help/${p.slug}`}>{p.title}</Link> <span className="fine">· version {p.version}</span></li>
        ))}
      </ul>
    </>
  );
}
