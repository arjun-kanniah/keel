import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The help center: Markdown pages split into sections, searched with BM25. Small enough that
// keyword search finds the right section reliably, with no embedding service to run.

export interface HelpSection {
  id: string; // slug#anchor
  slug: string;
  pageTitle: string;
  heading: string;
  text: string;
  link: string; // where "Show me" goes in the app
  version: string;
}
export interface HelpPage {
  slug: string;
  title: string;
  version: string;
  link: string;
  body: string;
}

const anchor = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let cache: { pages: HelpPage[]; sections: HelpSection[] } | null = null;

function load() {
  if (cache) return cache;
  const dir = path.join(process.cwd(), "help");
  const pages: HelpPage[] = [];
  const sections: HelpSection[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const raw = readFileSync(path.join(dir, file), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) continue;
    const meta = Object.fromEntries(m[1].split("\n").map((l) => [l.split(":")[0].trim(), l.slice(l.indexOf(":") + 1).trim()]));
    const slug = file.replace(/\.md$/, "");
    const page = { slug, title: meta.title, version: meta.version, link: meta.link, body: m[2].trim() };
    pages.push(page);
    const parts = page.body.split(/^## /m);
    sections.push({ id: `${slug}#overview`, slug, pageTitle: page.title, heading: page.title, text: parts[0].trim(), link: page.link, version: page.version });
    for (const p of parts.slice(1)) {
      const [heading, ...rest] = p.split("\n");
      sections.push({
        id: `${slug}#${anchor(heading)}`,
        slug,
        pageTitle: page.title,
        heading: heading.trim(),
        text: rest.join("\n").trim(),
        link: page.link,
        version: page.version,
      });
    }
  }
  cache = { pages, sections };
  return cache;
}

const STOP = new Set("a an and are as at be by can do does for from how i in is it my of on or the this to what when where which who why with you your me".split(" "));
const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").split(" ").filter((t) => t && !STOP.has(t)).map((t) => t.replace(/(ies|es|s)$/, (x) => (x === "ies" ? "y" : "")));

export function searchHelp(query: string, k = 3): (HelpSection & { score: number })[] {
  const { sections } = load();
  const docs = sections.map((s) => tokens(`${s.pageTitle} ${s.heading} ${s.heading} ${s.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const qt = [...new Set(tokens(query))];
  const df = new Map(qt.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  const k1 = 1.2;
  const b = 0.75;
  return sections
    .map((s, i) => {
      const d = docs[i];
      let score = 0;
      for (const t of qt) {
        const f = d.filter((x) => x === t).length;
        if (!f) continue;
        const idf = Math.log(1 + (sections.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
      }
      return { ...s, score };
    })
    .filter((s) => s.score > 0.5)
    .sort((a, z) => z.score - a.score)
    .slice(0, k);
}

export function helpPages(): HelpPage[] {
  return load().pages;
}

export function helpPage(slug: string): HelpPage | undefined {
  return load().pages.find((p) => p.slug === slug);
}

export { anchor };
