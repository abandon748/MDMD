import type { GraphInfo } from "./diagrams";
export type GraphEdit =
  | { kind: "create" | "rename"; id: string; title: string }
  | { kind: "move"; id: string; parent: string }
  | {
      kind: "nodeStyle" | "edgeStyle";
      id: string;
      props: Record<string, string>;
    };
const idPattern = "[\\p{L}\\p{N}_]+(?:-[\\p{L}\\p{N}_]+)*";
const groupPattern = new RegExp(
  "^(\\s*subgraph\\s+)(" + idPattern + ")(?:\\s*\\[(.*?)\\])?\\s*;?\\s*$",
  "u",
);
const atom = new RegExp(
  "^(" +
    idPattern +
    ")" +
    /(?:\[(?:"[^"]*"|[^\[\]]*)\]|\((?:"[^"]*"|[^()]*)\)|\{(?:"[^"]*"|[^{}]*)\})?(?::::[\w-]+)*/
      .source,
  "u",
);
const arrow = /^\s*(?:-->|==>|-\.->|---|===|-\.-)(?:\s*\|[^|\n]*\|)?\s*/;
function operands(line: string) {
  const tokens: { id: string; raw: string; at: number }[] = [];
  let at = line.search(/\S/);
  while (at >= 0) {
    const m = atom.exec(line.slice(at));
    if (!m) return;
    tokens.push({ id: m[1], raw: m[0], at });
    at += m[0].length;
    if (/^\s*;?\s*$/.test(line.slice(at))) return tokens;
    const edge = arrow.exec(line.slice(at));
    if (!edge) return;
    at += edge[0].length;
  }
}
export function graphBody(src: string) {
  return src.slice(src.indexOf("\n") + 1, src.trimEnd().lastIndexOf("\n"));
}
function moveNode(
  lines: string[],
  graph: GraphInfo,
  id: string,
  parent: string,
) {
  const stack: string[] = [],
    ends = new Map<string, number>();
  const rows: {
    i: number;
    scope: string;
    tokens: NonNullable<ReturnType<typeof operands>>;
  }[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i],
      s = line.trim();
    if (
      !s ||
      s.startsWith("%%") ||
      /^(?:flowchart|graph|direction|style|classDef|class|linkStyle)\s/.test(s)
    )
      continue;
    const g = groupPattern.exec(line);
    if (g) {
      stack.push(g[2]);
      continue;
    }
    if (/^end\s*;?$/.test(s)) {
      const key = stack.pop();
      if (!key) throw Error();
      ends.set(key, i);
      continue;
    }
    const tokens = operands(line);
    if (!tokens) throw Error();
    rows.push({ i, scope: stack.at(-1) || "", tokens });
  }
  if (stack.length || (parent && !ends.has(parent))) throw Error();
  const defs = rows.flatMap((r) =>
    r.tokens.filter((n) => n.id === id && n.raw !== id).map((n) => n.raw),
  );
  if (new Set(defs).size > 1) throw Error();
  // An edge inside a subgraph also declares its endpoints as members.
  // Lift edges together only when required, keeping linkStyle indices stable.
  const hoist = rows.some(
    (r) =>
      r.scope &&
      r.scope !== parent &&
      r.tokens.length > 1 &&
      r.tokens.some((n) => n.id === id),
  );
  const edges: string[] = [];
  for (const { i, scope, tokens } of rows) {
    const line = lines[i],
      indent = line.match(/^\s*/)![0];
    if (tokens.length === 1) {
      if (tokens[0].id === id) lines[i] = "";
      continue;
    }
    let edge = line;
    for (const n of [...tokens].reverse())
      if (hoist || n.id === id)
        edge = edge.slice(0, n.at) + n.id + edge.slice(n.at + n.raw.length);
    if (!hoist) {
      lines[i] = edge;
      continue;
    }
    edges.push(edge.trimStart());
    lines[i] = tokens
      .filter(
        (n) =>
          n.id !== id &&
          (n.raw !== n.id ||
            (scope &&
              graph.nodes.some((v) => v.id === n.id && v.parent === scope))),
      )
      .map((n) => indent + n.raw)
      .join("\n");
  }
  const at = parent ? ends.get(parent)! : lines.length - 1;
  lines.splice(
    at,
    0,
    (parent ? lines[at].match(/^\s*/)![0] : "") + "  " + (defs[0] || id),
  );
  if (hoist) {
    const styles = lines.filter((line) => /^\s*linkStyle\s/.test(line));
    for (let i = lines.length - 2; i > 0; i--)
      if (/^\s*linkStyle\s/.test(lines[i])) lines.splice(i, 1);
    lines.splice(lines.length - 1, 0, ...edges, ...styles);
  }
}
function setStyle(
  lines: string[],
  target: string,
  edge: boolean,
  props: Record<string, string>,
) {
  const prefix = edge ? "linkStyle" : "style",
    matcher = new RegExp("^(\\s*" + prefix + "\\s+)(\\S+)\\s+(.+?)(;?\\s*)$");
  let at = -1,
    base = "",
    direct = false;
  for (let i = 1; i < lines.length - 1; i++) {
    const m = matcher.exec(lines[i]);
    if (m && m[2].split(",").includes(target)) {
      at = i;
      base = m[3];
      direct = m[2] === target;
    }
  }
  const attrs = base ? base.split(/(?<!\\),/) : [];
  for (const [key, value] of Object.entries(props)) {
    const allowed =
      key === "stroke" || (!edge && key === "fill")
        ? /^#[0-9a-f]{6}$/i
        : key === "stroke-width"
          ? /^[1-6]px$/
          : key === "stroke-dasharray"
            ? /^(none|5 3|2 3)$/
            : null;
    if (!allowed?.test(value)) throw Error();
    for (let i = attrs.length - 1; i >= 0; i--)
      if (attrs[i].split(":")[0].trim() === key) attrs.splice(i, 1);
    attrs.push(key + ":" + value);
  }
  if (at >= 0 && direct) {
    const m = matcher.exec(lines[at])!;
    lines[at] = m[1] + target + " " + attrs.join(",") + m[4];
  } else
    lines.splice(
      lines.length - 1,
      0,
      "  " + prefix + " " + target + " " + attrs.join(","),
    );
}
export function editGraph(source: string, graph: GraphInfo, edit: GraphEdit) {
  const tail = source.endsWith("\n") ? "\n" : "",
    lines = (tail ? source.slice(0, -1) : source).split("\n");
  const node = graph.nodes.find((n) => n.id === edit.id);
  if (edit.kind === "create" || edit.kind === "rename") {
    if (
      !edit.title.trim() ||
      edit.title.length > 200 ||
      /["<>&;\x60[\]{}\r\n]/.test(edit.title)
    )
      throw Error();
    if (edit.kind === "create") {
      if (node || !/^MDGroup\d+$/.test(edit.id)) throw Error();
      lines.splice(
        lines.length - 1,
        0,
        "  subgraph " + edit.id + '["' + edit.title + '"]',
        "  end",
      );
    } else {
      const at = lines.findIndex((s) => groupPattern.exec(s)?.[2] === edit.id);
      if (!node?.group || at < 0) throw Error();
      lines[at] =
        groupPattern.exec(lines[at])![1] + edit.id + '["' + edit.title + '"]';
    }
  } else if (edit.kind === "move") {
    if (
      !node ||
      node.group ||
      (edit.parent && !graph.nodes.some((n) => n.group && n.id === edit.parent))
    )
      throw Error();
    if (edit.parent === node.parent) return source;
    moveNode(lines, graph, edit.id, edit.parent);
  } else if (edit.kind === "edgeStyle") {
    const i = graph.edges.findIndex((e) => e.id === edit.id);
    if (i < 0) throw Error();
    setStyle(lines, String(i), true, edit.props);
  } else if (edit.kind === "nodeStyle") {
    if (
      !node ||
      node.group ||
      !new RegExp("^" + idPattern + "$", "u").test(node.id)
    )
      throw Error();
    setStyle(lines, node.id, false, edit.props);
  }
  const result = lines.join("\n") + tail;
  if (result.length > 32768) throw Error();
  return result;
}
export function matchesEdit(
  before: GraphInfo,
  after: GraphInfo,
  edit: GraphEdit,
) {
  const expected = before.nodes.map((n) => ({ ...n }));
  if (edit.kind === "create")
    expected.push({ id: edit.id, parent: "", group: true, label: edit.title });
  if (edit.kind === "rename")
    expected.find((n) => n.id === edit.id)!.label = edit.title;
  if (edit.kind === "move")
    expected.find((n) => n.id === edit.id)!.parent = edit.parent;
  return (
    expected.length === after.nodes.length &&
    expected.every((n) =>
      after.nodes.some(
        (a) =>
          a.id === n.id &&
          a.parent === n.parent &&
          a.group === n.group &&
          a.label === n.label,
      ),
    ) &&
    before.edges.length === after.edges.length &&
    before.edges.every(
      (e, i) =>
        e.id === after.edges[i].id &&
        e.from === after.edges[i].from &&
        e.to === after.edges[i].to,
    )
  );
}
