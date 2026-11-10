import MarkdownIt from "markdown-it";
export function installTasks(parser: InstanceType<typeof MarkdownIt>) {
  parser.core.ruler.push("mdmd-tasks", (state) => {
    const lines = state.src.split("\n"),
      offsets = [0];
    for (let i = 0; i < lines.length; i++)
      offsets.push(offsets[i] + lines[i].length + 1);
    state.tokens.forEach((token, i) => {
      if (token.type !== "list_item_open" || !token.map) return;
      const inline = state.tokens[i + 2];
      if (
        inline?.type !== "inline" ||
        !inline.children ||
        inline.children[0]?.type !== "text"
      )
        return;
      const content = /^\[([ xX])\] /.exec(inline.children[0].content);
      const marker =
        /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-+*]|\d+[.)]) +\[([ xX])\] /.exec(
          lines[token.map[0]],
        );
      if (!content || !marker) return;
      const offset = offsets[token.map[0]] + marker[0].lastIndexOf("[") + 1;
      const input = new state.Token("html_inline", "", 0);
      input.content = `<input type="checkbox" class="task-check" data-task-offset="${offset}" aria-label="${parser.utils.escapeHtml(inline.content)}" ${marker[1] !== " " ? "checked" : ""}> `;
      inline.children[0].content = inline.children[0].content.slice(4);
      const textOpen = new state.Token("html_inline", "", 0);
      textOpen.content = `<span class="task-text${marker[1] !== " " ? " task-done" : ""}">`;
      const textClose = new state.Token("html_inline", "", 0);
      textClose.content = "</span>";
      inline.children.unshift(textOpen);
      inline.children.push(textClose);
      inline.children.unshift(input);
    });
  });
  return parser;
}
export function taskChange(source: string, offset: number) {
  if (
    !Number.isInteger(offset) ||
    offset < 1 ||
    !/^\[[ xX]\]$/.test(source.slice(offset - 1, offset + 2))
  )
    throw Error("task-stale");
  return {
    from: offset,
    to: offset + 1,
    insert: source[offset] === " " ? "x" : " ",
  };
}
