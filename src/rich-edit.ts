import { EditorView } from "@codemirror/view";
import {
  undo,
  redo,
  invertedEffects,
  isolateHistory,
} from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { t } from "./i18n";

const tags = new Set(
  "P H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE STRONG B EM I S DEL STRIKE MARK A CODE BR DIV SPAN".split(
    " ",
  ),
);
export function canEditRich(node: HTMLElement) {
  return (
    /^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(node.tagName) &&
    !node.matches(".markdown-alert") &&
    !node.querySelector(
      "[data-math], .math-inline, .math-display, .embedded-body, .footnote-ref",
    ) &&
    [...node.querySelectorAll("*")].every((n) => tags.has(n.tagName))
  );
}

// The DOM is only a block draft. Serialize an allowlist, never save its HTML.
export function richMarkdown(root: HTMLElement) {
  const escape = (s: string) =>
    s.replace(/([\\`*_{}\[\]<>#+.!|~=$^\-])/g, "\\$1").replace(/\u00a0/g, " ");
  const children = (node: Node): string =>
    [...node.childNodes].map(walk).join("");
  const marked = (body: string, marker: string) => {
    if (!body.trim()) return body;
    const [, before, text, after] = body.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    return before + marker + text + marker + after;
  };
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (
        !node.textContent?.trim() &&
        node.parentElement &&
        /^(UL|OL|BLOCKQUOTE)$/.test(node.parentElement.tagName)
      )
        return "";
      return escape(node.textContent || "");
    }
    if (!(node instanceof HTMLElement)) return "";
    if (!tags.has(node.tagName))
      throw new Error(
        t("此内容无法安全转换为 Markdown，请撤销本次修改或切换源码编辑。"),
      );
    const body = children(node);
    switch (node.tagName) {
      case "BR":
        return "  \n";
      case "P":
      case "DIV":
        return (
          (node.childNodes.length === 1 &&
          node.firstChild instanceof HTMLBRElement
            ? ""
            : body) + "\n\n"
        );
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return "#".repeat(Number(node.tagName[1])) + " " + body + "\n\n";
      case "STRONG":
      case "B":
        return marked(body, "**");
      case "EM":
      case "I":
        return marked(body, "*");
      case "S":
      case "DEL":
      case "STRIKE":
        return marked(body, "~~");
      case "MARK":
        return marked(body, "==");
      case "CODE": {
        const text = node.textContent || "";
        const fence = "`".repeat(
          Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1,
        );
        const pad =
          text.startsWith("`") ||
          text.endsWith("`") ||
          (text.startsWith(" ") && text.endsWith(" ") && !!text.trim())
            ? " "
            : "";
        return fence + pad + text + pad + fence;
      }
      case "A": {
        const href = node.getAttribute("href") || "";
        if (/^(?:javascript|data|vbscript):/i.test(href.trim()))
          throw new Error(t("链接地址不安全，修改未应用。"));
        const url = href
          .replace(/\\/g, "%5C")
          .replace(/</g, "%3C")
          .replace(/>/g, "%3E")
          .replace(/\n/g, "%0A");
        const title = node.getAttribute("title");
        return `[${body}](<${url}>${title ? ' "' + title.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' : ""})`;
      }
      case "BLOCKQUOTE":
        return (
          body
            .trimEnd()
            .split("\n")
            .map((line) => "> " + line)
            .join("\n") + "\n\n"
        );
      case "UL":
      case "OL": {
        const start = Number(node.getAttribute("start") || 1);
        return (
          [...node.children]
            .map((li, i) => {
              if (li.tagName !== "LI")
                throw new Error(t("列表结构无效，请撤销本次修改。"));
              const marker =
                node.tagName === "OL"
                  ? `${Number.isFinite(start) ? start + i : i + 1}. `
                  : "- ";
              const lines = [...li.childNodes]
                .map((child) =>
                  child instanceof HTMLElement &&
                  /^(UL|OL)$/.test(child.tagName)
                    ? "\n" + walk(child)
                    : walk(child),
                )
                .join("")
                .trimEnd()
                .split("\n");
              return (
                marker +
                lines
                  .map((line, j) => (j ? " ".repeat(marker.length) : "") + line)
                  .join("\n")
              );
            })
            .join("\n") + "\n\n"
        );
      }
      default:
        return body;
    }
  };
  return [...root.childNodes].map(walk).join("").replace(/\n\n$/, "");
}

export function richCaretOffset(
  root: HTMLElement,
  edge: "anchor" | "focus" = "focus",
) {
  const selection = window.getSelection();
  const node = edge === "anchor" ? selection?.anchorNode : selection?.focusNode;
  const offset =
    edge === "anchor" ? selection?.anchorOffset : selection?.focusOffset;
  if (!selection?.rangeCount || !node || !root.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset!);
  return range.toString().length;
}
function placeCaret(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (offset <= (node.textContent?.length || 0)) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return;
    }
    offset -= node.textContent?.length || 0;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

export function setupRichEditor(
  host: HTMLElement,
  target: HTMLElement,
  view: EditorView,
  onError: (message: string) => void,
  initialOffset = 0,
  initialAnchor = initialOffset,
) {
  const offset = initialOffset;
  const area = document.createElement("div");
  area.id = "inline-rich";
  area.className = "rich-editor";
  area.contentEditable = "true";
  area.setAttribute("role", "textbox");
  area.setAttribute("aria-multiline", "true");
  area.setAttribute("aria-label", t("就地排版编辑"));
  const copy = target.cloneNode(true) as HTMLElement;
  copy.hidden = false;
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    node.removeAttribute("id");
    node.removeAttribute("data-line");
    node.removeAttribute("data-end-line");
  }
  area.append(copy);
  host.append(area);
  const sourceMount = host.querySelector<HTMLElement>("#inline-source")!;
  sourceMount.hidden = true;
  let composing = false,
    writing = false,
    valid = true;
  let savedRange: Range | null = null;
  let savedBackward = false;
  let lastHtml = area.innerHTML;
  type Point = { path: number[]; offset: number };
  type Snapshot = { html: string; anchor: Point | null; focus: Point | null };
  const point = (node: Node | null, offset: number): Point | null => {
    if (!node || !area.contains(node)) return null;
    const path: number[] = [];
    while (node !== area) {
      const parent: Node | null = node.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
      node = parent;
    }
    return { path, offset };
  };
  const capture = (): Snapshot => {
    const s = window.getSelection();
    return {
      html: area.innerHTML,
      anchor: point(s?.anchorNode || null, s?.anchorOffset || 0),
      focus: point(s?.focusNode || null, s?.focusOffset || 0),
    };
  };
  const restore = (snapshot: Snapshot) => {
    area.innerHTML = snapshot.html;
    const locate = (p: Point | null): [Node, number] | null => {
      if (!p) return null;
      let node: Node = area;
      for (const index of p.path) {
        if (!node.childNodes[index]) return null;
        node = node.childNodes[index];
      }
      return [
        node,
        Math.min(
          p.offset,
          node.nodeType === Node.TEXT_NODE
            ? node.textContent!.length
            : node.childNodes.length,
        ),
      ];
    };
    area.focus();
    const anchor = locate(snapshot.anchor),
      focus = locate(snapshot.focus);
    if (anchor && focus)
      window.getSelection()?.setBaseAndExtent(...anchor, ...focus);
    else placeCaret(area, 0);
  };
  area.focus();
  placeCaret(area, initialAnchor);
  const initialSelection = window.getSelection();
  const anchorNode = initialSelection?.anchorNode;
  const anchorOffset = initialSelection?.anchorOffset;
  placeCaret(area, offset);
  if (anchorNode && initialSelection?.focusNode)
    initialSelection.setBaseAndExtent(
      anchorNode,
      anchorOffset!,
      initialSelection.focusNode,
      initialSelection.focusOffset,
    );
  let lastSnapshot = capture();
  let beforeInput: Snapshot | null = null;
  // Keep empty paragraphs and directed selections in the same CM6 undo history.
  // Markdown alone cannot distinguish these native editing states.
  const change = StateEffect.define<{ before: Snapshot; after: Snapshot }>();
  const draftState = StateField.define<Snapshot>({
    create: () => lastSnapshot,
    update(value, transaction) {
      for (const effect of transaction.effects)
        if (effect.is(change)) value = effect.value.after;
      return value;
    },
  });
  view.dispatch({
    effects: StateEffect.appendConfig.of([
      draftState,
      invertedEffects.of((transaction) =>
        transaction.effects
          .filter((e) => e.is(change))
          .map((e) =>
            change.of({ before: e.value.after, after: e.value.before }),
          )
          .reverse(),
      ),
    ]),
  });
  const remember = () => {
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      area.contains(selection.anchorNode) &&
      area.contains(selection.focusNode)
    ) {
      savedRange = selection.getRangeAt(0).cloneRange();
      savedBackward =
        !selection.isCollapsed &&
        selection.anchorNode === savedRange.endContainer &&
        selection.anchorOffset === savedRange.endOffset;
    }
  };
  const focus = () => {
    area.focus();
    if (!savedRange || !area.contains(savedRange.commonAncestorContainer))
      return;
    const { startContainer, startOffset, endContainer, endOffset } = savedRange;
    if (savedBackward)
      window
        .getSelection()
        ?.setBaseAndExtent(
          endContainer,
          endOffset,
          startContainer,
          startOffset,
        );
    else
      window
        .getSelection()
        ?.setBaseAndExtent(
          startContainer,
          startOffset,
          endContainer,
          endOffset,
        );
  };
  area.addEventListener("keyup", remember);
  area.addEventListener("mouseup", remember);
  const sync = () => {
    if (composing) return valid;
    if (lastHtml === area.innerHTML) {
      beforeInput = null;
      return valid;
    }
    try {
      const text = richMarkdown(area);
      const previous = view.state.doc.toString();
      const next = text + (previous.endsWith("\n") && text ? "\n" : "");
      let from = 0,
        oldEnd = previous.length,
        newEnd = next.length;
      while (from < oldEnd && from < newEnd && previous[from] === next[from])
        from++;
      while (
        oldEnd > from &&
        newEnd > from &&
        previous[oldEnd - 1] === next[newEnd - 1]
      ) {
        oldEnd--;
        newEnd--;
      }
      writing = true;
      const after = capture();
      view.dispatch({
        changes: { from, to: oldEnd, insert: next.slice(from, newEnd) },
        effects: change.of({ before: beforeInput || lastSnapshot, after }),
        annotations: isolateHistory.of("full"),
      });
      lastSnapshot = after;
      beforeInput = null;
      lastHtml = area.innerHTML;
      valid = true;
      remember();
    } catch (error) {
      valid = false;
      onError(String(error));
    } finally {
      writing = false;
    }
    return valid;
  };
  const refresh = () => {
    if (writing || composing || sourceMount.hidden === false) return;
    const snapshot = view.state.field(draftState);
    if (snapshot === lastSnapshot) return;
    restore(snapshot);
    lastSnapshot = snapshot;
    lastHtml = area.innerHTML;
    valid = true;
    remember();
  };
  area.addEventListener("input", sync);
  area.addEventListener("compositionstart", () => {
    beforeInput = capture();
    composing = true;
  });
  area.addEventListener("compositionend", () => {
    composing = false;
    sync();
  });
  const canChangeSelection = () => {
    const selection = window.getSelection();
    return (
      !composing &&
      area.isContentEditable &&
      !view.state.readOnly &&
      selection?.rangeCount &&
      area.contains(selection.anchorNode) &&
      area.contains(selection.focusNode)
    );
  };
  area.addEventListener("cut", (event) => {
    if (!canChangeSelection()) event.preventDefault();
    else beforeInput = capture();
    // Let the browser write the clipboard before performing the deletion.
  });
  area.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain");
    if (!text || !canChangeSelection()) return;
    // execCommand may emit input without beforeinput. Capture the live range,
    // not the selection left by the previous edit, for our CM6 undo history.
    beforeInput = capture();
    document.execCommand("insertText", false, text.replace(/\r\n?/g, "\n"));
    sync();
  });
  area.addEventListener("drop", (event) => event.preventDefault());
  area.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a")) event.preventDefault();
  });
  const history = (back: boolean) => {
    if (composing) return;
    if (!valid) {
      restore(lastSnapshot);
      lastHtml = area.innerHTML;
      valid = true;
      beforeInput = null;
      return;
    }
    (back ? undo : redo)(view);
    refresh();
    area.focus();
  };
  area.addEventListener("beforeinput", (event) => {
    if (
      event.inputType === "historyUndo" ||
      event.inputType === "historyRedo"
    ) {
      event.preventDefault();
      history(event.inputType === "historyUndo");
    } else if (!composing) beforeInput = capture();
  });
  const format = (action: string) => {
    if (composing) return;
    const selected = window.getSelection();
    if (
      selected?.rangeCount &&
      !selected.isCollapsed &&
      (!area.contains(selected.anchorNode) ||
        !area.contains(selected.focusNode))
    ) {
      onError(t("请在同一个正文块内选择文字，跨块格式请使用分屏源码编辑。"));
      return;
    }
    remember();
    focus();
    beforeInput = capture();
    document.execCommand("styleWithCSS", false, "false");
    const commands: Record<string, string> = {
      bold: "bold",
      italic: "italic",
      strike: "strikeThrough",
      clear: "removeFormat",
      listCycle: "insertUnorderedList",
    };
    if (commands[action]) document.execCommand(commands[action]);
    else if (action === "quote")
      document.execCommand("formatBlock", false, "blockquote");
    else {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) {
        onError(t("请先选择要设置格式的文字。"));
        return;
      }
      const range = selection.getRangeAt(0);
      if (!area.contains(range.commonAncestorContainer)) return;
      const node = document.createElement(
        action === "highlight" ? "mark" : action === "code" ? "code" : "a",
      );
      if (action === "link") node.setAttribute("href", "https://example.com");
      node.append(range.extractContents());
      range.insertNode(node);
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return sync();
  };
  remember();
  return {
    area,
    sync,
    refresh,
    history,
    format,
    insertion() {
      if (composing || !sync()) return null;
      remember();
      if (!savedRange || !area.contains(savedRange.commonAncestorContainer))
        return null;
      // Serialize markers only in a detached clone; opening/cancelling a picker
      // must not normalize the live draft or move its selection.
      const text = richMarkdown(area);
      const position = (node: Node, offset: number) => {
        const p = point(node, offset);
        if (!p) return null;
        const clone = area.cloneNode(true) as HTMLElement;
        let target: Node = clone;
        for (const index of p.path) target = target.childNodes[index];
        const empty =
          target instanceof HTMLElement &&
          /^(P|DIV)$/.test(target.tagName) &&
          target.childNodes.length === 1 &&
          target.firstChild instanceof HTMLBRElement;
        if (empty && target instanceof HTMLElement) target.replaceChildren();
        const marker = `MDMDCARET${crypto.randomUUID().replaceAll("-", "")}END`;
        const range = document.createRange();
        range.setStart(target, empty ? 0 : p.offset);
        range.collapse(true);
        range.insertNode(document.createTextNode(marker));
        const mapped = richMarkdown(clone);
        const pos = mapped.indexOf(marker);
        return pos >= 0 && mapped.replace(marker, "") === text ? pos : null;
      };
      const from = position(savedRange.startContainer, savedRange.startOffset);
      const to = position(savedRange.endContainer, savedRange.endOffset);
      if (from === null || to === null) return null;
      const trailing = view.state.doc.toString().match(/\n*$/)![0];
      const ending = text.match(/\n*$/)![0];
      return { text: text + trailing.slice(ending.length), from, to };
    },
    focus,
    get composing() {
      return composing;
    },
    get valid() {
      return valid;
    },
    get active() {
      return sourceMount.hidden;
    },
    source() {
      if (!sync() || composing) return false;
      area.hidden = true;
      sourceMount.hidden = false;
      view.focus();
      return true;
    },
    destroy() {
      area.remove();
    },
  };
}
