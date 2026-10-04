import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { Html } from "foldkit";
import type { Concept, Graph } from "../../core/src/contracts.ts";
import { resolveLinkTarget } from "../../core/src/links.ts";

export const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
export function resolveLink(
  href: string,
  bundle: string,
  sourcePath: string,
):
  | { kind: "external"; href: string }
  | { kind: "internal"; bundle: string; path: string; fragment: string }
  | { kind: "blocked" } {
  const resolved = resolveLinkTarget(sourcePath, href);
  if (resolved.unsafe) return { kind: "blocked" };
  if (resolved.external)
    return /^(https?:|mailto:)/i.test(href) ? { kind: "external", href } : { kind: "blocked" };
  try {
    return {
      kind: "internal",
      bundle,
      path: resolved.target,
      fragment: decodeURIComponent(resolved.fragment ?? ""),
    };
  } catch {
    return { kind: "blocked" };
  }
}

export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
export function boundedGraph(graph: Graph, limit: number): Graph {
  const nodes = graph.nodes.slice(0, Math.max(1, Math.min(250, limit)));
  const ids = new Set(nodes.map((node) => `${node.bundle}:${node.path}`));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter(
      (edge) => ids.has(edge.from) && (ids.has(edge.to) || edge.broken || edge.external),
    ),
    truncated: graph.truncated || nodes.length < graph.nodes.length,
  };
}
export function lineChanges(before: string, after: string) {
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB), line: start + 1 };
}

export function renderMarkdown<M>(
  raw: string,
  concept: Pick<Concept, "bundle" | "path">,
  h: Html.HtmlBuilder<M>,
  open: (bundle: string, path: string, fragment: string) => M,
): Html.Html {
  const tokens = markdown.parse(raw, {});
  const builders: Record<
    string,
    (attrs: Html.Attribute<M>[], children: Array<Html.Html | string>) => Html.Html
  > = {
    p: h.p,
    h1: h.h1,
    h2: h.h2,
    h3: h.h3,
    h4: h.h4,
    h5: h.h5,
    h6: h.h6,
    ul: h.ul,
    ol: h.ol,
    li: h.li,
    blockquote: h.blockquote,
    strong: h.strong,
    em: h.em,
    s: h.s,
    table: h.table,
    thead: h.thead,
    tbody: h.tbody,
    tr: h.tr,
    th: h.th,
    td: h.td,
  };
  function render(list: Token[]): Array<Html.Html | string> {
    const children: Array<Html.Html | string> = [];
    for (let i = 0; i < list.length; i++) {
      const token = list[i]!;
      if (token.type === "inline") {
        children.push(...render(token.children ?? []));
        continue;
      }
      if (token.nesting === 1) {
        let end = i + 1,
          depth = 1;
        while (end < list.length) {
          depth += list[end]!.nesting;
          if (depth === 0) break;
          end++;
        }
        const inside = render(list.slice(i + 1, end));
        if (token.type === "link_open") {
          const href = token.attrGet("href") ?? "";
          const link = resolveLink(href, concept.bundle, concept.path);
          if (link.kind === "external")
            children.push(
              h.a([h.Href(link.href), h.Target("_blank"), h.Rel("noopener noreferrer")], inside),
            );
          else if (link.kind === "internal")
            children.push(
              h.a(
                [
                  h.Href(
                    `/wiki?bundle=${encodeURIComponent(link.bundle)}&path=${encodeURIComponent(link.path)}${link.fragment ? `#${encodeURIComponent(link.fragment)}` : ""}`,
                  ),
                  h.OnClick(open(link.bundle, link.path, link.fragment), {
                    defaultAction: "Prevent",
                  }),
                ],
                inside,
              ),
            );
          else children.push(h.span([], inside));
        } else {
          const attrs: Html.Attribute<M>[] =
            token.tag.startsWith("h") && /^h\d$/.test(token.tag)
              ? [h.Id(headingId(list[i + 1]?.content ?? ""))]
              : [];
          if (token.tag === "ol" && token.attrGet("start"))
            attrs.push(h.Attribute("start", token.attrGet("start")!));
          children.push((builders[token.tag] ?? h.div)(attrs, inside));
        }
        i = end;
        continue;
      }
      if (token.type === "code_inline") children.push(h.code([], [token.content]));
      else if (token.type === "fence" || token.type === "code_block")
        children.push(h.pre([], [h.code([], [token.content])]));
      else if (token.type === "image")
        children.push(
          h.span(
            [h.Class("image-placeholder")],
            [`Image: ${token.content || "untitled"}. Images are not loaded.`],
          ),
        );
      else if (token.type === "hr") children.push(h.hr([]));
      else if (token.type === "hardbreak") children.push(h.br([]));
      else if (token.type === "softbreak") children.push("\n");
      else if (token.nesting === 0) children.push(token.content);
    }
    return children;
  }
  return h.div([h.Class("markdown")], render(tokens));
}
