import MarkdownIt from "markdown-it";

export type Alignment = "default" | "left" | "center" | "right";
export interface TableModel {
  cells: string[][]; // Row zero is the header; values are Markdown source, not rendered HTML.
  align: Alignment[];
  prefix: string;
  suffix: string;
}
const parser = new MarkdownIt({ html: false });
export const maxRows = 201,
  maxColumns = 50;

function rowCells(line: string) {
  const cells: string[] = [];
  let start = 0;
  // Match markdown-it's table delimiter rule: a pipe immediately after a backslash is escaped.
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") {
      cells.push(line.slice(start, i).trim());
      start = i + 1;
    }
  }
  cells.push(line.slice(start).trim());
  if (line.trimStart().startsWith("|")) cells.shift();
  if (line.trimEnd().endsWith("|") && line.trimEnd().at(-2) !== "\\")
    cells.pop();
  return cells;
}
export function parseTable(source: string): TableModel {
  if (source.length > 262144 || source.includes("\r"))
    throw new Error("table-range");
  const tokens = parser.parse(source, {});
  const first = tokens[0];
  if (
    first?.type !== "table_open" ||
    tokens.at(-1)?.type !== "table_close" ||
    !first.map
  )
    throw new Error("table-shape");
  if (tokens.filter((t) => t.type === "table_open").length !== 1)
    throw new Error("table-shape");
  const lines = source.split("\n");
  const [start, end] = first.map;
  const tableLines = lines.slice(start, end);
  if (tableLines.some((line) => /^(?: {4}|\t)/.test(line)))
    throw new Error("table-indent");
  const cells = [rowCells(tableLines[0]), ...tableLines.slice(2).map(rowCells)];
  const columns = cells[0].length;
  const separators = rowCells(tableLines[1]);
  if (
    columns < 1 ||
    columns > maxColumns ||
    cells.length > maxRows ||
    cells.length * columns > 10000 ||
    separators.length !== columns ||
    separators.some((s) => !/^:?-+:?$/.test(s)) ||
    cells.some(
      (row) => row.length !== columns || row.some((cell) => cell.length > 4096),
    )
  )
    throw new Error("table-shape");
  // Do not silently discard text outside the table, including reference definitions.
  const prefix = lines.slice(0, start).join("\n") + (start ? "\n" : "");
  const suffix = end < lines.length ? "\n" + lines.slice(end).join("\n") : "";
  if (prefix.trim() || suffix.trim()) throw new Error("table-outside");
  return {
    cells,
    prefix,
    suffix,
    align: separators.map((s) =>
      s.startsWith(":")
        ? s.endsWith(":")
          ? "center"
          : "left"
        : s.endsWith(":")
          ? "right"
          : "default",
    ),
  };
}
export function writeTable(model: TableModel) {
  const row = (cells: string[]) =>
    "| " +
    cells
      .map((cell) => {
        if (/[\r\n\0]/.test(cell) || cell.length > 4096)
          throw new Error("table-cell");
        return cell.replace(/(?<!\\)\|/g, "\\|");
      })
      .join(" | ") +
    " |";
  const align = {
    default: "---",
    left: ":---",
    center: ":---:",
    right: "---:",
  };
  const source =
    model.prefix +
    [
      row(model.cells[0]),
      row(model.align.map((a) => align[a])),
      ...model.cells.slice(1).map(row),
    ].join("\n") +
    model.suffix;
  parseTable(source);
  return source;
}
export function newTable(source: string) {
  const prefix = source
    ? source.endsWith("\n\n")
      ? ""
      : source.endsWith("\n")
        ? "\n"
        : "\n\n"
    : "";
  const addition = prefix + "|  |  |\n| --- | --- |\n|  |  |\n|  |  |\n";
  const tokens = parser.parse(source + addition, {});
  const table = [...tokens].reverse().find((t) => t.type === "table_open");
  const line = source.split("\n").length - 1 + prefix.split("\n").length - 1;
  if (
    !table?.map ||
    table.level !== 0 ||
    table.map[0] !== line ||
    tokens.at(-1)?.type !== "table_close"
  )
    throw new Error("table-insert");
  return addition;
}

// A table is a top-level block: use the whole containing list/quote/fence,
// or the caret's empty source line, without replacing selected text.
export function tableInsertionPosition(source: string, position: number) {
  if (!Number.isInteger(position) || position < 0 || position > source.length)
    throw new Error("table-position");
  const offsets = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") offsets.push(i + 1);
  const line = source.slice(0, position).split("\n").length - 1;
  const block = parser
    .parse(source, {})
    .find(
      (token) =>
        token.level === 0 &&
        token.map &&
        token.map[0] <= line &&
        line < token.map[1],
    );
  return block?.map ? (offsets[block.map[1]] ?? source.length) : offsets[line];
}
