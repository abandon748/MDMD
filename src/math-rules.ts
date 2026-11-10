import MarkdownIt from "markdown-it";

export function installMath(parser: InstanceType<typeof MarkdownIt>) {
  parser.inline.ruler.before("escape", "mdmd-math", (state, silent) => {
    const start = state.pos;
    if (
      state.src[start] !== "$" ||
      /[\s$]/.test(state.src[start + 1] || " ") ||
      state.src[start - 1] === "$"
    )
      return false;
    let end = start + 1;
    for (; end < state.posMax; end++) {
      if (state.src[end] === "\n") return false;
      if (state.src[end] !== "$") continue;
      let escapes = 0;
      for (let i = end - 1; state.src[i] === "\\"; i--) escapes++;
      if (escapes % 2 === 0) break;
    }
    if (
      end >= state.posMax ||
      /\s/.test(state.src[end - 1]) ||
      /[\d$]/.test(state.src[end + 1] || "")
    )
      return false;
    if (!silent) {
      const token = state.push("mdmd-math", "span", 0);
      token.content = state.src.slice(start + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  parser.block.ruler.before(
    "fence",
    "mdmd-math-block",
    (state, start, end, silent) => {
      const line = (n: number) =>
        state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
      if (
        state.sCount[start] - state.blkIndent >= 4 ||
        line(start).trim() !== "$$"
      )
        return false;
      let close = start + 1;
      while (close < end && line(close).trim() !== "$$") {
        if (state.sCount[close] < state.blkIndent && line(close).trim())
          return false;
        close++;
      }
      if (close === end) return false;
      if (silent) return true;
      const token = state.push("mdmd-math-block", "div", 0);
      token.block = true;
      token.map = [start, close + 1];
      token.content = state.getLines(start + 1, close, state.blkIndent, false);
      state.line = close + 1;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  for (const name of ["mdmd-math", "mdmd-math-block"]) {
    parser.renderer.rules[name] = (tokens, i, _options, _env, renderer) => {
      const token = tokens[i];
      return `<${token.tag} class="math-source" data-math="${token.block ? "block" : "inline"}"${renderer.renderAttrs(token)}>${parser.utils.escapeHtml(token.content)}</${token.tag}>${token.block ? "\n" : ""}`;
    };
  }
  return parser;
}
