import { invoke } from "@tauri-apps/api/core";
import MarkdownIt from "markdown-it";
import { t } from "./i18n.ts";

interface Context {
  id: string;
  content: string;
}
interface Source {
  kind: "web" | "markdown";
  content: string;
  contentType: string;
}
interface Target {
  kind: "web" | "markdown" | "anchor";
  target: string;
  fragment: string;
}
const parser = new MarkdownIt({ html: false });
const short = (value: string, length: number) => {
  const text = value.replace(/\s+/g, " ").trim();
  const points = Array.from(text);
  return points.slice(0, length).join("") + (points.length > length ? "…" : "");
};
export function previewTarget(href: string): Target | null {
  if (!href || href.length > 4096) return null;
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.username || url.password) return null;
      return { kind: "web", target: url.href, fragment: "" };
    } catch {
      return null;
    }
  }
  if (/^[\\/]|^[a-z][\w+.-]*:/i.test(href) || href.includes("?")) return null;
  const index = href.indexOf("#");
  try {
    const target = decodeURIComponent(index < 0 ? href : href.slice(0, index));
    const fragment = index < 0 ? "" : decodeURIComponent(href.slice(index + 1));
    if (!target && fragment) return { kind: "anchor", target: "", fragment };
    if (!/\.(md|markdown|mdown)$/i.test(target)) return null;
    return { kind: "markdown", target, fragment };
  } catch {
    return null;
  }
}

export function markdownExcerpt(source: string, fragment: string) {
  if (new TextEncoder().encode(source).length > 256 * 1024)
    throw new Error("preview-size");
  const tokens = parser.parse(source, {});
  const inline = (token: (typeof tokens)[number]) =>
    (token.children || [])
      .filter((child) => child.type !== "image")
      .map((child) =>
        child.type.endsWith("break")
          ? " "
          : ["text", "code_inline"].includes(child.type)
            ? child.content
            : "",
      )
      .join("");
  let start = 0,
    found = !fragment;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open") continue;
    const title = inline(tokens[i + 1]);
    if (
      fragment &&
      (fragment === `line-${(tokens[i].map?.[0] || 0) + 1}` ||
        title.toLowerCase().replace(/\s+/g, "-") === fragment.toLowerCase())
    ) {
      start = i;
      found = true;
      break;
    }
  }
  let title = "";
  const text: string[] = [];
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].type === "heading_open" && !title)
      title = inline(tokens[i + 1]);
    if (tokens[i].type === "inline") text.push(inline(tokens[i]));
    else if (["fence", "code_block"].includes(tokens[i].type))
      text.push(tokens[i].content);
    if (text.join(" ").length > 1600 && title) break;
  }
  return {
    title: short(title || t("Markdown 文档"), 120),
    summary: short(text.join(" "), 500) || t("文档为空或没有可摘录的正文。"),
    missingAnchor: !found,
  };
}
export function webExcerpt(source: Source) {
  const bytes = Uint8Array.from(atob(source.content), (c) => c.charCodeAt(0));
  const declaration = source.contentType.match(
    /charset\s*=\s*["']?([^\s;"']+)/i,
  )?.[1];
  // Template content is inert: it is never attached to the document. Only strings leave it.
  const template = document.createElement("template");
  template.innerHTML = new TextDecoder(declaration || "utf-8").decode(bytes);
  if (!declaration) {
    const charset =
      template.content
        .querySelector("meta[charset]")
        ?.getAttribute("charset") ||
      template.content
        .querySelector('meta[http-equiv="Content-Type" i]')
        ?.getAttribute("content")
        ?.match(/charset\s*=\s*([^\s;]+)/i)?.[1];
    if (charset) template.innerHTML = new TextDecoder(charset).decode(bytes);
  }
  const meta = (key: string) =>
    Array.from(template.content.querySelectorAll("meta"))
      .find(
        (node) =>
          (
            node.getAttribute("property") ||
            node.getAttribute("name") ||
            ""
          ).toLowerCase() === key,
      )
      ?.getAttribute("content")
      ?.trim() || "";
  const title = short(
    meta("og:title") ||
      template.content.querySelector("title")?.textContent ||
      "",
    120,
  );
  const summary = short(meta("description") || meta("og:description"), 500);
  if (!title && !summary) throw new Error("preview-metadata");
  return {
    title: title || t("网页"),
    summary: summary || t("该网页未提供摘要。"),
    missingAnchor: false,
  };
}

export function createLinkPreview(
  preview: HTMLElement,
  getContext: () => Context | null,
) {
  const card = document.getElementById("link-preview")!;
  const title = document.getElementById("link-preview-title")!;
  const address = document.getElementById("link-preview-address")!;
  const content = document.getElementById("link-preview-content")!;
  const note = document.getElementById("link-preview-note")!;
  const retry = document.getElementById(
    "link-preview-retry",
  ) as HTMLButtonElement;
  let enabled = true,
    anchor: HTMLAnchorElement | null = null;
  let serial = 0,
    timer = 0,
    dismissTimer = 0;
  let inFlight: Promise<unknown> = Promise.resolve();
  let description: string | null = null;
  const errors: Record<string, string> = {
    "preview-size": "预览内容过大（网页最多 1 MiB，Markdown 最多 256 KiB）。",
    "preview-path":
      "仅预览当前文档目录内的普通 Markdown 文件，不支持链接目录或越界路径。",
    "preview-missing": "目标文件不存在或不可读取。",
    "preview-encoding": "不支持此文本编码；本地 Markdown 需要 UTF-8。",
    "preview-network": "网页加载失败，请检查网络后重试。",
    "preview-timeout": "网页加载超时，请稍后重试。",
    "preview-type": "此链接的内容类型不支持预览。",
    "preview-redirect": "网页重定向过多或不安全，未继续加载。",
    "preview-http": "网页返回错误或需要登录，无法预览。",
    "preview-metadata": "该网页没有可用的标题或摘要。",
    "preview-unsaved": "请先保存当前文档，再预览相对文件链接。",
    "preview-busy": "上一预览仍在加载，请稍后重试。",
    "preview-stale": "文档已变化，请重新悬停链接。",
    "preview-url": "链接地址无效或包含登录信息。",
  };
  function hide() {
    serial++;
    clearTimeout(timer);
    clearTimeout(dismissTimer);
    if (anchor) {
      if (description === null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", description);
    }
    anchor = null;
    card.hidden = true;
  }
  function position(link: HTMLElement) {
    const rect = link.getBoundingClientRect();
    card.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - card.offsetWidth - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - card.offsetHeight - 8))}px`;
  }
  async function load() {
    const link = anchor,
      context = getContext();
    if (!link || !context || !enabled) return hide();
    const target = previewTarget(link.getAttribute("href") || "");
    if (!target) return hide();
    const stamp = ++serial;
    title.textContent = t("链接预览");
    address.textContent = link.getAttribute("href");
    content.textContent = t("正在加载预览…");
    note.textContent = "";
    retry.hidden = true;
    card.hidden = false;
    position(link);
    const active = () =>
      stamp === serial &&
      enabled &&
      link.isConnected &&
      getContext()?.id === context.id;
    try {
      // One native request at a time; moving across links replaces the waiting target.
      await inFlight.catch(() => {});
      if (!active()) return;
      const request =
        target.kind === "anchor"
          ? Promise.resolve({
              kind: "markdown",
              content: context.content,
              contentType: "text/markdown",
            } as Source)
          : invoke<Source>("preview_link", {
              id: context.id,
              kind: target.kind,
              target: target.target,
            });
      inFlight = request;
      const source = await request;
      if (!active()) return;
      const result =
        source.kind === "web"
          ? webExcerpt(source)
          : markdownExcerpt(source.content, target.fragment);
      title.textContent = result.title;
      content.textContent = result.summary;
      note.textContent = result.missingAnchor
        ? t("未找到目标锚点，显示文档开头。")
        : t("仅供预览，不会打开或修改文档。");
    } catch (error) {
      if (!active()) return;
      const code = String(error).replace(/^Error: /, "");
      content.textContent = t(errors[code] || "预览加载失败，请稍后重试。");
      retry.textContent = t("重试");
      retry.hidden = false;
    }
    if (active()) position(link);
  }
  function enter(link: HTMLAnchorElement) {
    clearTimeout(dismissTimer);
    if (anchor === link) return;
    hide();
    if (
      !enabled ||
      !getContext() ||
      !previewTarget(link.getAttribute("href") || "")
    )
      return;
    anchor = link;
    description = link.getAttribute("aria-describedby");
    link.setAttribute(
      "aria-describedby",
      [description, "link-preview"].filter(Boolean).join(" "),
    );
    timer = window.setTimeout(() => void load(), 400);
  }
  function leave(event: FocusEvent | MouseEvent) {
    if (!anchor) return;
    const related = event.relatedTarget;
    if (
      related instanceof Node &&
      (card.contains(related) || anchor?.contains(related))
    )
      return;
    clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(hide, 180);
  }
  preview.addEventListener("mouseover", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (link) enter(link);
  });
  preview.addEventListener("mouseout", leave);
  preview.addEventListener("focusin", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (link) enter(link);
  });
  preview.addEventListener("focusout", leave);
  card.addEventListener("mouseenter", () => clearTimeout(dismissTimer));
  card.addEventListener("mouseleave", leave);
  card.addEventListener("focusin", () => clearTimeout(dismissTimer));
  card.addEventListener("focusout", leave);
  retry.onclick = () => void load();
  document.getElementById("link-preview-close")!.onclick = () => {
    const link = anchor;
    hide();
    link?.focus();
    hide();
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !card.hidden) {
        event.preventDefault();
        hide();
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!card.contains(event.target as Node)) hide();
    },
    true,
  );
  document.addEventListener(
    "scroll",
    (event) => {
      if (!card.contains(event.target as Node)) hide();
    },
    true,
  );
  window.addEventListener("resize", hide);
  window.addEventListener("blur", hide);
  new MutationObserver(hide).observe(preview, {
    childList: true,
    subtree: true,
  });
  return {
    hide,
    setEnabled(value: boolean) {
      enabled = value;
      if (!enabled) hide();
    },
  };
}
