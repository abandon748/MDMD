export interface Flow {
  header: string;
  footer: string;
  direction: string;
  nodes: { id: string; label: string; shape: string }[];
  edges: { from: string; to: string; label: string }[];
}
const id = "[A-Za-z_][A-Za-z0-9_]*";
const nodePattern = new RegExp(
  `^(${id})(?:\\[([^\\]]*)\\]|\\(([^)]*)\\)|\\{([^}]*)\\})?`,
);
function label(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  if (/["<>|\[\]{}()\r\n&]/.test(value) || value.length > 200)
    throw Error("label");
  return value;
}
export function parseFlow(text: string): Flow {
  if (text.length > 32768) throw Error("limit");
  const lines = text.split("\n");
  const fence = /^(\s{0,3})(`{3,}|~{3,})mermaid\s*$/.exec(lines.shift() || "");
  if (!fence || fence[1]) throw Error("fence");
  const header = fence[0] + "\n";
  let tail = "";
  if (lines.at(-1) === "") {
    lines.pop();
    tail = "\n";
  }
  const close = lines.pop() || "";
  if (!new RegExp(`^${fence[2][0]}{${fence[2].length},}\\s*$`).test(close))
    throw Error("fence");
  const first = /^(flowchart|graph)\s+(LR|RL|TB|TD|BT)\s*$/.exec(
    (lines.shift() || "").trim(),
  );
  if (!first) throw Error("graph");
  const model: Flow = {
    header,
    footer: close + tail,
    direction: first[2],
    nodes: [],
    edges: [],
  };
  function node(raw: string) {
    const match = nodePattern.exec(raw.trim());
    if (
      !match ||
      ["end", "subgraph", "style", "class", "click"].includes(match[1])
    )
      throw Error("node");
    const explicit =
      match[2] !== undefined ||
      match[3] !== undefined ||
      match[4] !== undefined;
    const n = {
      id: match[1],
      label: label(match[2] ?? match[3] ?? match[4] ?? match[1]),
      shape:
        match[3] !== undefined
          ? "round"
          : match[4] !== undefined
            ? "diamond"
            : "box",
    };
    const existing = model.nodes.find((x) => x.id === n.id);
    if (!existing) model.nodes.push(n);
    else if (explicit) Object.assign(existing, n);
    return { id: n.id, rest: raw.trim().slice(match[0].length).trim() };
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    const a = node(line);
    if (!a.rest) continue;
    const arrow = /^-->(?:\|([^|]*)\|)?\s*/.exec(a.rest);
    if (!arrow) throw Error("edge");
    const b = node(a.rest.slice(arrow[0].length));
    if (b.rest) throw Error("trailing");
    model.edges.push({ from: a.id, to: b.id, label: label(arrow[1] || "") });
  }
  if (
    !model.nodes.length ||
    model.nodes.length > 100 ||
    model.edges.length > 200
  )
    throw Error("limit");
  return model;
}
export function writeFlow(model: Flow) {
  const nodes = model.nodes.map((n) => {
    const pair =
      n.shape === "diamond"
        ? ["{", "}"]
        : n.shape === "round"
          ? ["(", ")"]
          : ["[", "]"];
    return `  ${n.id}${pair[0]}"${label(n.label)}"${pair[1]}`;
  });
  const edges = model.edges.map((e) => {
    if (
      !model.nodes.some((n) => n.id === e.from) ||
      !model.nodes.some((n) => n.id === e.to)
    )
      throw Error("edge");
    return `  ${e.from} -->${e.label ? `|${label(e.label)}|` : ""} ${e.to}`;
  });
  const text =
    model.header +
    `flowchart ${model.direction}\n` +
    [...nodes, ...edges].join("\n") +
    "\n" +
    model.footer;
  parseFlow(text);
  return text;
}
