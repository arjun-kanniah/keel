import Link from "next/link";
import { notFound } from "next/navigation";
import { anchor, helpPage } from "@/lib/help";
import { renderMarkdown } from "@/lib/markdown";

export default async function HelpPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = helpPage((await params).slug);
  if (!page) notFound();
  // Give each section heading the id the assistant's citations point at
  const html = renderMarkdown(page.body).replace(/<h2>(.*?)<\/h2>/g, (_m, h: string) => `<h2 id="${anchor(h.replace(/<[^>]+>/g, ""))}">${h}</h2>`);
  return (
    <>
      <div><div className="crumb"><Link href="/help">Help center</Link> · version {page.version}</div><h2 id="overview">{page.title}</h2></div>
      <div className="help-body" dangerouslySetInnerHTML={{ __html: html }} />
      <p><Link href={page.link}>Show me in Ratebook →</Link></p>
    </>
  );
}
