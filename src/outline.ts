import { t } from "./i18n.ts";
const outline = document.getElementById("outline")!;
const preview = document.getElementById("preview")!;
const scroller = document.getElementById("preview-scroll")!;
const count = document.getElementById("heading-count")!;
interface Heading {
  target: HTMLElement;
  level: number;
  parent: number;
  row: HTMLElement;
  label: HTMLButtonElement;
  toggle: HTMLButtonElement;
  children: HTMLUListElement;
}
let headings: Heading[] = [];
let signature = "";
let emptyMessage = "";
let active = -1;
let frame = 0;
let clicked: { index: number; top: number } | null = null;

export function clearOutline(message: string) {
  emptyMessage = message;
  headings = [];
  signature = "";
  active = -1;
  clicked = null;
  outline.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-outline";
  empty.textContent = t(message);
  outline.append(empty);
  count.textContent = "0";
}

function markCurrent(index: number) {
  const changed = active !== index;
  active = index;
  let visible = index;
  for (let p = index; p >= 0; p = headings[p].parent) {
    const parent = headings[p].parent;
    if (parent >= 0 && headings[parent].children.hidden) visible = parent;
  }
  headings.forEach((h, i) => {
    if (i === index) h.label.setAttribute("aria-current", "location");
    else h.label.removeAttribute("aria-current");
    h.row.classList.toggle("contains-current", i === visible && i !== index);
    h.toggle.title =
      (h.children.hidden ? t("展开") : t("折叠")) +
      (i === visible && i !== index ? t("（当前标题在此分支内）") : "");
  });
  if (changed && visible >= 0 && !outline.hidden) {
    const row = headings[visible].row.getBoundingClientRect();
    const box = outline.getBoundingClientRect();
    if (row.top < box.top) outline.scrollTop += row.top - box.top;
    else if (row.bottom > box.bottom)
      outline.scrollTop += row.bottom - box.bottom;
  }
}

function follow() {
  if (!headings.length || !scroller.clientHeight) return;
  if (clicked && Math.abs(scroller.scrollTop - clicked.top) < 1) {
    markCurrent(clicked.index);
    return;
  }
  clicked = null;
  const top = scroller.getBoundingClientRect().top + 25;
  let index = -1;
  // ponytail: linear heading scan per animation frame; cache offsets if measured long outlines need it.
  headings.forEach((h, i) => {
    if (h.target.getBoundingClientRect().top <= top) index = i;
  });
  if (
    scroller.scrollHeight > scroller.clientHeight + 1 &&
    scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
  )
    index = headings.length - 1;
  markCurrent(index);
}

export function followOutline() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(follow);
}

export function renderOutline(documentId: string) {
  const targets = [
    ...preview.querySelectorAll<HTMLElement>(
      "h1[data-line],h2[data-line],h3[data-line],h4[data-line],h5[data-line],h6[data-line]",
    ),
  ];
  if (!targets.length) {
    clearOutline("此文档没有标题");
    return;
  }
  const nextSignature = JSON.stringify([
    documentId,
    targets.map((h) => [h.tagName, h.textContent]),
  ]);
  const collapsed =
    nextSignature === signature
      ? new Set(headings.flatMap((h, i) => (h.children.hidden ? [i] : [])))
      : new Set<number>();
  signature = nextSignature;
  headings = [];
  active = -1;
  clicked = null;
  outline.replaceChildren();
  const list = document.createElement("ul");
  outline.append(list);
  const stack: number[] = [];
  targets.forEach((target, index) => {
    const level = Number(target.tagName.slice(1));
    while (stack.length && headings[stack.at(-1)!].level >= level) stack.pop();
    const parent = stack.at(-1) ?? -1;
    const item = document.createElement("li");
    const row = document.createElement("div");
    row.className = "outline-row";
    row.style.paddingLeft = `${(level - 1) * 12}px`;
    row.dataset.level = String(level);
    const toggle = document.createElement("button");
    toggle.className = "outline-toggle";
    toggle.textContent = "▾";
    toggle.hidden = true;
    const label = document.createElement("button");
    label.className = "outline-label";
    label.textContent = target.textContent?.trim() || t("无标题");
    label.dataset.line = target.dataset.line;
    label.title = t("H{0} · 第 {1} 行 · {2}", [
      level,
      target.dataset.line,
      label.textContent,
    ]);
    label.setAttribute("aria-label", label.title);
    const children = document.createElement("ul");
    children.id = `outline-children-${target.dataset.line}`;
    children.hidden = collapsed.has(index);
    row.append(toggle, label);
    item.append(row, children);
    (parent < 0 ? list : headings[parent].children).append(item);
    headings.push({ target, level, parent, row, label, toggle, children });
    stack.push(index);
    toggle.onclick = () => {
      children.hidden = !children.hidden;
      toggle.setAttribute("aria-expanded", String(!children.hidden));
      toggle.textContent = children.hidden ? "▸" : "▾";
      markCurrent(active);
    };
    label.onclick = () => {
      scroller.scrollTop +=
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        24;
      clicked = { index, top: scroller.scrollTop };
      markCurrent(index);
    };
  });
  headings.forEach((h) => {
    if (!h.children.childElementCount) return;
    h.toggle.hidden = false;
    h.toggle.setAttribute(
      "aria-label",
      t("{0} 的子标题", [h.label.textContent]),
    );
    h.toggle.setAttribute("aria-controls", h.children.id);
    h.toggle.setAttribute("aria-expanded", String(!h.children.hidden));
    h.toggle.textContent = h.children.hidden ? "▸" : "▾";
  });
  count.textContent = String(headings.length);
  followOutline();
}

scroller.addEventListener("scroll", followOutline);
const resizeObserver = new ResizeObserver(followOutline);
resizeObserver.observe(preview);
resizeObserver.observe(scroller);

export function refreshOutlineLanguage() {
  if (!headings.length) {
    const empty = outline.querySelector(".empty-outline");
    if (empty) empty.textContent = t(emptyMessage);
    return;
  }
  for (const h of headings) {
    h.label.textContent = h.target.textContent?.trim() || t("无标题");
    h.label.title = t("H{0} · 第 {1} 行 · {2}", [
      h.level,
      h.target.dataset.line,
      h.label.textContent,
    ]);
    h.label.setAttribute("aria-label", h.label.title);
    h.toggle.setAttribute(
      "aria-label",
      t("{0} 的子标题", [h.label.textContent]),
    );
  }
  markCurrent(active);
}
