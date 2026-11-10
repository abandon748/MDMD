import assert from "node:assert/strict";
import { parseFlow, writeFlow } from "../src/flow-model.ts";
const text =
  '```mermaid\ngraph LR\n A[Alpha] -->|yes| B{Beta}\n B --> C("Gamma")\n```\n';
const flow = parseFlow(text);
assert.equal(flow.nodes.length, 3);
assert.equal(flow.edges.length, 2);
assert.deepEqual(parseFlow(writeFlow(flow)), flow);
for (const bad of [
  "subgraph X",
  "A --> B --> C",
  "A[<b>bad</b>]",
  "A --> B; C --> D",
  "%% comment",
  "style A fill:red",
  "A -- no --> B",
  'A["bad&entity"]',
])
  assert.throws(() => parseFlow("```mermaid\nflowchart LR\n" + bad + "\n```"));
assert.throws(() => parseFlow("```mermaid\nsequenceDiagram\nA->>B: Hi\n```"));
assert.throws(() => parseFlow("```mermaid\nflowchart LR\nA --> B\n``"));
assert.throws(() =>
  writeFlow({ ...flow, edges: [{ from: "missing", to: "A", label: "" }] }),
);
console.log(
  "PASS: flow shapes, edges, canonical roundtrip and rejection of unsupported/lossy syntax.",
);
