import MarkdownIt from "markdown-it";

export const snippets = {
  heading: { label: "标题片段", body: "# {0}" },
  bullet: { label: "无序列表片段", body: "- {0}\n- {0}" },
  ordered: { label: "有序列表片段", body: "1. {0}\n2. {0}" },
  task: { label: "任务列表片段", body: "- [ ] {0}\n- [ ] {0}" },
  quote: { label: "引用片段", body: "> {0}" },
  code: { label: "代码块片段", body: "```text\n{0}\n```" },
  table: {
    label: "表格片段",
    body: "| {0} | {0} |\n| --- | --- |\n| {0} | {0} |",
  },
  rule: { label: "分隔线片段", body: "---" },
  link: { label: "链接片段", body: "[{0}](https://example.com)" },
};
export type Snippet = keyof typeof snippets;
const parser = new MarkdownIt({ html: false });

// Only bounded top-level empty lines; template editing/large-document insertion
// can be added when needed without guessing nested Markdown indentation.
export function snippetRange(source: string, pos: number) {
  if (
    !Number.isInteger(pos) ||
    pos < 0 ||
    pos > source.length ||
    source.length > 262144
  )
    return null;
  const from = pos === 0 ? 0 : source.lastIndexOf("\n", pos - 1) + 1;
  const end = source.indexOf("\n", pos);
  const to = end < 0 ? source.length : end;
  if (!/^(?:\/)?$/.test(source.slice(from, to))) return null;
  const line = source.slice(0, from).split("\n").length - 1;
  for (const token of parser.parse(source, {})) {
    if (
      token.map &&
      token.map[0] <= line &&
      line < token.map[1] &&
      [
        "fence",
        "code_block",
        "blockquote_open",
        "bullet_list_open",
        "ordered_list_open",
        "table_open",
      ].includes(token.type)
    )
      return null;
  }
  return { from, to };
}

export function snippetText(key: Snippet, placeholder: string) {
  if (!Object.hasOwn(snippets, key)) throw new Error("Unknown snippet");
  return snippets[key].body.replaceAll("{0}", placeholder);
}

export function snippetEdit(
  source: string,
  pos: number,
  key: Snippet,
  placeholder: string,
) {
  const range = snippetRange(source, pos);
  if (!range) throw new Error("Snippet requires a top-level empty line");
  const before = source.slice(0, range.from),
    after = source.slice(range.to);
  const prefix = before && !before.endsWith("\n\n") ? "\n" : "";
  const suffix = !after || !after.startsWith("\n\n") ? "\n" : "";
  const body = snippetText(key, placeholder);
  return {
    ...range,
    insert: prefix + body + suffix,
    cursor: range.from + prefix.length + body.length,
  };
}
