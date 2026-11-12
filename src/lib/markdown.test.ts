import { describe, expect, it } from "vitest";
import { linkCitations, renderMarkdown } from "./markdown";

describe("markdown", () => {
  it("escapes raw HTML and drops unsafe links and images", () => {
    const out = renderMarkdown('Hi <script>alert(1)</script> [x](javascript:alert(1)) ![i](https://e.com/a.png) [ok](/rates)');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
    expect(out).toContain('<a href="/rates">ok</a>');
  });
  it("links citations", () => {
    expect(linkCitations("<p>See [1].</p>", [{ n: 1, helpUrl: "/help/profiles#x", title: "P" }])).toContain('href="/help/profiles#x"');
  });
});
