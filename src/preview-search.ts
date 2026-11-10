import { t } from "./i18n";

// Highlight ranges leave the source map, selection and undo history untouched.
export function setupPreviewSearch(preview: HTMLElement) {
  const el = (id: string) => document.getElementById(id)!;
  const bar = el("preview-search"),
    input = el("preview-query") as HTMLInputElement;
  let ranges: Range[] = [],
    active = 0,
    timer = 0;
  function paint(scroll = false) {
    CSS.highlights.set("mdmd-search", new Highlight(...ranges));
    CSS.highlights.set(
      "mdmd-search-current",
      new Highlight(...(ranges[active] ? [ranges[active]] : [])),
    );
    el("preview-matches").textContent =
      `${ranges.length ? active + 1 : 0} / ${ranges.length}`;
    (el("preview-prev") as HTMLButtonElement).disabled = !ranges.length;
    (el("preview-next") as HTMLButtonElement).disabled = !ranges.length;
    if (scroll)
      ranges[active]?.startContainer.parentElement?.scrollIntoView({
        block: "center",
      });
  }
  function update(scroll = false) {
    if (bar.hidden) return;
    ranges = [];
    active = 0;
    let text = "",
      block: Element | null = null,
      limited = false;
    const pieces: { node: Text; start: number; end: number }[] = [];
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text,
        parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          "[hidden],[data-stat-ignore],button,input,script,style,iframe,.welcome,.katex-mathml",
        ) ||
        !parent.getClientRects().length
      )
        continue;
      const next = parent.closest(
        "p,li,pre,td,th,h1,h2,h3,h4,h5,h6,figcaption",
      );
      if (next !== block) text += "\n";
      block = next;
      const content = node.data.slice(
        0,
        Math.max(0, 1024 * 1024 - text.length),
      );
      if (content.length) {
        pieces.push({
          node,
          start: text.length,
          end: text.length + content.length,
        });
        text += content;
      }
      if (content.length < node.length) {
        limited = true;
        break;
      }
    }
    if (input.value) {
      const regex = new RegExp(
        input.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "giu",
      );
      let cursor = 0;
      for (const match of text.matchAll(regex)) {
        if (ranges.length === 10000) {
          limited = true;
          break;
        }
        const from = match.index!,
          to = from + match[0].length;
        while (cursor < pieces.length && pieces[cursor].end <= from) cursor++;
        let end = cursor;
        while (end < pieces.length && pieces[end].end < to) end++;
        if (
          !pieces[cursor] ||
          !pieces[end] ||
          from < pieces[cursor].start ||
          to > pieces[end].end
        )
          continue;
        const range = new Range();
        range.setStart(pieces[cursor].node, from - pieces[cursor].start);
        range.setEnd(pieces[end].node, to - pieces[end].start);
        ranges.push(range);
      }
    }
    el("preview-search-note").textContent = limited
      ? t("搜索达到上限：仅前 1 MiB 文本／10000 处匹配。")
      : "";
    paint(scroll);
  }
  function close() {
    clearTimeout(timer);
    bar.hidden = true;
    ranges = [];
    CSS.highlights.delete("mdmd-search");
    CSS.highlights.delete("mdmd-search-current");
  }
  function move(delta: number) {
    if (ranges.length)
      active = (active + delta + ranges.length) % ranges.length;
    paint(true);
  }
  input.addEventListener("input", () => update(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      move(e.shiftKey ? -1 : 1);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      el("preview-find").focus();
    }
  });
  el("preview-prev").onclick = () => move(-1);
  el("preview-next").onclick = () => move(1);
  el("preview-search-close").onclick = () => {
    close();
    el("preview-find").focus();
  };
  new MutationObserver(() => {
    clearTimeout(timer);
    if (!bar.hidden) timer = window.setTimeout(() => update(), 60);
  }).observe(preview, { childList: true, characterData: true, subtree: true });
  return {
    open() {
      bar.hidden = false;
      update();
      input.focus();
      input.select();
    },
    reset() {
      close();
      input.value = "";
    },
    close,
  };
}
