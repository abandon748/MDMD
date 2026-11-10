import MarkdownIt from "markdown-it";

export const formatActions = {
  bold: "加粗",
  italic: "斜体",
  strike: "删除线",
  quote: "引用",
  code: "代码",
  link: "插入链接",
  listCycle: "列表循环",
  highlight: "高亮",
  clear: "清除格式",
};
export type FormatAction = keyof typeof formatActions;

// A small Markdown extension for the format action; code spans/fences stay literal.
export function installHighlight(parser: InstanceType<typeof MarkdownIt>) {
  parser.inline.ruler.before("emphasis", "mdmd-mark", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== "==") return false;
    let end = state.src.indexOf("==", start + 2);
    while (end !== -1) {
      let slashes = 0;
      for (let i = end - 1; state.src[i] === "\\"; i--) slashes++;
      if (slashes % 2 === 0) break;
      end = state.src.indexOf("==", end + 2);
    }
    const inner = state.src.slice(start + 2, end);
    if (end === -1 || !inner || /\n/.test(inner) || /^\s|\s$/.test(inner))
      return false;
    if (!silent) {
      const token = state.push("mdmd-mark", "mark", 0);
      token.children = [];
      state.md.inline.parse(inner, state.md, state.env, token.children);
    }
    state.pos = end + 2;
    return true;
  });
  parser.renderer.rules["mdmd-mark"] = (
    tokens,
    index,
    options,
    env,
    renderer,
  ) =>
    "<mark>" +
    renderer.renderInline(tokens[index].children!, options, env) +
    "</mark>";
  return parser;
}
const plainParser = installHighlight(new MarkdownIt({ html: false }));
const longestTicks = (text: string) =>
  (text.match(/`+/g) || []).reduce(
    (size, run) => Math.max(size, run.length),
    0,
  );
function plainText(source: string) {
  const inlineText = (
    tokens: ReturnType<InstanceType<typeof MarkdownIt>["parse"]>,
  ): string =>
    tokens
      .map((token) =>
        token.type === "image"
          ? token.content
          : token.children
            ? inlineText(token.children)
            : ["text", "code_inline"].includes(token.type)
              ? token.content
              : ["softbreak", "hardbreak"].includes(token.type)
                ? "\n"
                : "",
      )
      .join("");
  const parts = plainParser
    .parse(source, {})
    .flatMap((token) =>
      token.type === "inline"
        ? [inlineText(token.children || [])]
        : ["fence", "code_block"].includes(token.type)
          ? [token.content.replace(/\n$/, "")]
          : [],
    );
  return parts.join("\n") + (source.endsWith("\n") && parts.length ? "\n" : "");
}
function lineRange(source: string, from: number, to: number) {
  const start = from ? source.lastIndexOf("\n", from - 1) + 1 : 0;
  const last = to > from && source[to - 1] === "\n" ? to - 1 : to;
  const end = source.indexOf("\n", last);
  return { from: start, to: end === -1 ? source.length : end };
}
export function formatEdit(
  source: string,
  from: number,
  to: number,
  action: FormatAction,
  placeholder: string,
) {
  if (!Object.hasOwn(formatActions, action)) throw new Error("format-action");
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length ||
    to - from > 262144
  )
    throw new Error("format-range");
  const replacement = (insert: string, a = 0, b = insert.length) => ({
    from,
    to,
    insert,
    anchor: from + a,
    head: from + b,
  });
  let text = source.slice(from, to);
  if (
    action === "quote" ||
    action === "listCycle" ||
    (action === "clear" && from === to) ||
    (action === "code" && text.includes("\n"))
  ) {
    ({ from, to } = lineRange(source, from, to));
    text = source.slice(from, to);
  }
  if (to - from > 262144) throw new Error("format-range");
  if (action === "clear") return replacement(plainText(text));
  if (action === "quote") {
    const lines = text.split("\n"),
      remove = lines.every((line) => /^> ?/.test(line));
    return replacement(
      lines
        .map((line) => (remove ? line.replace(/^> ?/, "") : "> " + line))
        .join("\n"),
    );
  }
  if (action === "listCycle") {
    const lines = text.split("\n");
    const kind = (line: string) =>
      /^\s*[-+*] \[[ xX]\] /.test(line)
        ? 3
        : /^\s*\d+[.)] /.test(line)
          ? 2
          : /^\s*[-+*] /.test(line)
            ? 1
            : 0;
    const level = lines.every((line) => kind(line) === kind(lines[0]))
      ? kind(lines[0])
      : 0;
    return replacement(
      lines
        .map((line, i) => {
          const indent = line.match(/^[ \t]*/)![0];
          const body = line
            .slice(indent.length)
            .replace(/^(?:[-+*] \[[ xX]\] |\d+[.)] |[-+*] )/, "");
          return indent + ["- ", `${i + 1}. `, "- [ ] ", ""][level] + body;
        })
        .join("\n"),
    );
  }
  if (action === "link") {
    const label = (text || placeholder).replace(/(?<!\\)[\[\]]/g, "\\$&");
    const prefix = `[${label}](`,
      url = "https://example.com";
    return replacement(
      prefix + url + ")",
      prefix.length,
      prefix.length + url.length,
    );
  }
  if (action === "code" && text.includes("\n")) {
    const block = text.match(/^(`{3,})[^\n]*\n([\s\S]*?)\n\1$/);
    if (block) return replacement(block[2]);
    const fence = "`".repeat(Math.max(3, longestTicks(text) + 1));
    return replacement(
      fence + "\n" + text + "\n" + fence,
      fence.length + 1,
      fence.length + 1 + text.length,
    );
  }
  let delimiter =
    action === "bold"
      ? "**"
      : action === "italic"
        ? "*"
        : action === "strike"
          ? "~~"
          : action === "highlight"
            ? "=="
            : "`";
  if (action === "code") {
    const code = text.match(/^(`+)([\s\S]*?)\1$/);
    if (code && !/^`|`$/.test(code[2])) {
      const body = code[2];
      return replacement(
        /^ .* $/.test(body) && body.trim() ? body.slice(1, -1) : body,
      );
    }
    delimiter = "`".repeat(longestTicks(text) + 1);
    if (
      source.slice(0, from).endsWith(delimiter + " ") &&
      source.slice(to).startsWith(" " + delimiter)
    ) {
      from -= delimiter.length + 1;
      to += delimiter.length + 1;
      return replacement(text);
    }
  }
  if (
    text.startsWith(delimiter) &&
    text.endsWith(delimiter) &&
    text.length > delimiter.length * 2
  )
    return replacement(text.slice(delimiter.length, -delimiter.length));
  if (
    source.slice(0, from).endsWith(delimiter) &&
    source.slice(to).startsWith(delimiter)
  ) {
    from -= delimiter.length;
    to += delimiter.length;
    return replacement(text);
  }
  text ||= placeholder;
  const leading = action === "code" ? "" : text.match(/^\s*/)![0];
  const trailing =
    action === "code" ? "" : text.slice(leading.length).match(/\s*$/)![0];
  const body =
    text.slice(
      leading.length,
      trailing.length ? -trailing.length : undefined,
    ) || placeholder;
  const pad =
    action === "code" &&
    (/^`|`$/.test(body) || (/^ .* $/.test(body) && body.trim()))
      ? " "
      : "";
  const prefix = leading + delimiter + pad;
  return replacement(
    prefix + body + pad + delimiter + trailing,
    prefix.length,
    prefix.length + body.length,
  );
}
