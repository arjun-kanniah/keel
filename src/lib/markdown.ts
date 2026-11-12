import { Marked } from "marked";

// Model output and help pages are rendered as Markdown with raw HTML escaped, images dropped,
// and links limited to this app or https. Model text is never trusted as HTML.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const md = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return esc(text);
    },
    image() {
      return "";
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const ok = /^(\/(?!\/)|#|https:\/\/)/.test(href);
      if (!ok) return label;
      const ext = href.startsWith("https://");
      return `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  return md.parse(text, { async: false }) as string;
}

/** Turn [1], [2] into links to the cited help sections. */
export function linkCitations(html: string, cites: { n: number; helpUrl: string; title: string }[]): string {
  if (!cites.length) return html;
  return html.replace(/\[(\d)\]/g, (m, n) => {
    const c = cites.find((x) => x.n === Number(n));
    return c ? `<sup><a href="${esc(c.helpUrl)}" title="${esc(c.title)}">[${n}]</a></sup>` : m;
  });
}
