import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { installExtensions } from "./extensions";
import { t } from "./i18n";
const parser = installExtensions(
  new MarkdownIt({ html: false, linkify: true }),
);
parser.renderer.rules.image = (tokens, i, _o, _e, r) => {
  const token = tokens[i];
  token.attrSet("data-local-src", token.attrGet("src") || "");
  token.attrSet("src", "");
  token.attrSet("alt", token.content);
  return r.renderToken(tokens, i, _o);
};
function relative(base: string, target: string) {
  if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) return target;
  return (
    new URL(target, "https://mdmd.invalid/" + base).pathname.slice(1) +
    new URL(target, "https://mdmd.invalid/" + base).hash
  );
}
export async function renderEmbeds(
  preview: HTMLElement,
  id: string,
  valid: () => boolean,
  changed: () => void,
) {
  let count = 0;
  for (const node of preview.querySelectorAll<HTMLElement>("[data-embed]")) {
    if (!valid()) return;
    const path = node.dataset.embed!;
    node.dataset.embedStatus = "loading";
    try {
      if (++count > 10) throw Error("limit");
      const source = await invoke<{ content: string }>("preview_link", {
        id,
        kind: "markdown",
        target: decodeURIComponent(path),
      });
      if (!valid()) return;
      const html = DOMPurify.sanitize(
        parser.render(source.content, { mdmdEmbedded: true }),
      );
      const body = document.createElement("div");
      body.className = "embedded-body";
      body.innerHTML = html;
      body.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      body
        .querySelectorAll<HTMLAnchorElement>("a[href]")
        .forEach((a) =>
          a.setAttribute("href", relative(path, a.getAttribute("href")!)),
        );
      for (const img of body.querySelectorAll<HTMLImageElement>(
        "img[data-local-src]",
      )) {
        const link = relative(path, img.dataset.localSrc!);
        img.src = await invoke<string>("read_image", {
          id,
          relative: decodeURIComponent(link),
        });
        await img.decode();
      }
      if (!valid()) return;
      const link = document.createElement("a");
      link.href = path;
      link.textContent = path;
      node.replaceChildren(link, body);
      node.dataset.embedStatus = "ready";
      changed();
    } catch {
      if (!valid()) return;
      node.dataset.embedStatus = "failed";
      node.title = t("嵌入读取失败或超过限制；原引用保留，修复后刷新。");
      changed();
    }
  }
}
