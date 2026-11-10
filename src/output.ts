import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { tableCsv } from "./csv";
import { blockRange } from "./inline-edit";
import { previewText } from "./diagrams";
export interface OutputSnapshot {
  id: string;
  revision: number;
  content: string;
  name: string;
}
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
// Copy the rendered snapshot, never infer Markdown from its DOM.
export function exportHtml(
  preview: HTMLElement,
  name: string,
  simple: boolean,
) {
  if (
    preview.querySelector(
      '[data-diagram-status="loading"], [data-diagram-status="failed"], [data-diagram-status="limit"], [data-math-status="loading"], [data-math-status="failed"], [data-math-status="limit"]',
    )
  )
    throw Error("output-resources");
  for (const embed of preview.querySelectorAll<HTMLElement>("[data-embed]"))
    if (embed.dataset.embedStatus !== "ready") throw Error("output-resources");
  for (const formula of preview.querySelectorAll<HTMLElement>("[data-math]"))
    if (formula.dataset.mathStatus !== "ready") throw Error("output-resources");
  for (const img of preview.querySelectorAll("img"))
    if (!img.src.startsWith("data:") || !img.complete || !img.naturalWidth)
      throw Error("output-resources");
  const clone = preview.cloneNode(true) as HTMLElement;
  const originals = [preview, ...preview.querySelectorAll<HTMLElement>("*")],
    copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  const properties = [
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-decoration",
    "white-space",
    "vertical-align",
    "display",
    "position",
    "top",
    "bottom",
    "left",
    "right",
    "width",
    "height",
    "min-width",
    "max-width",
    "border",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-radius",
    "border-collapse",
    "padding",
    "margin",
    "transform",
    "transform-origin",
    "overflow-wrap",
    "box-sizing",
  ];
  originals.forEach((node, i) => {
    const style = getComputedStyle(node);
    copies[i].removeAttribute("style");
    for (const prop of properties)
      copies[i].style.setProperty(prop, style.getPropertyValue(prop));
    if (!node.closest(".katex")) {
      copies[i].style.width = "auto";
      copies[i].style.height = "auto";
      copies[i].style.minWidth = "0";
      copies[i].style.maxWidth = "100%";
    }
    for (const attr of [...copies[i].attributes])
      if (
        attr.name.startsWith("data-") ||
        attr.name.startsWith("on") ||
        attr.name === "tabindex"
      )
        copies[i].removeAttribute(attr.name);
    if (node.hasAttribute("data-stat-ignore") || node.hidden)
      copies[i].setAttribute("data-output-remove", "");
  });
  clone
    .querySelectorAll<HTMLInputElement>("input.task-check")
    .forEach((n) =>
      n.replaceWith(document.createTextNode(n.checked ? "☑ " : "☐ ")),
    );
  clone
    .querySelectorAll(
      "[data-output-remove], .welcome, .diagram-controls, button, input, iframe, script",
    )
    .forEach((n) => n.remove());
  clone
    .querySelectorAll<HTMLElement>(".diagram-scroll,.table-scroll,pre")
    .forEach((n) => {
      n.style.overflow = "visible";
      n.style.maxWidth = "100%";
      n.style.height = "auto";
    });
  clone.querySelectorAll<HTMLElement>("img").forEach((n) => {
    n.style.maxWidth = "100%";
    n.style.height = "auto";
  });
  clone.style.maxWidth = "100%";
  clone.style.width = "auto";
  clone.style.height = "auto";
  clone.style.margin = "0";
  clone.style.padding = "24px";
  if (simple)
    for (const n of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
      n.style.color = "#202020";
      n.style.backgroundColor = "transparent";
    }
  const title = document.createElement("title");
  title.textContent = name;
  const fonts = document.getElementById("math-styles")?.textContent || "";
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\';img-src data:;font-src data:;base-uri \'none\'">' +
    title.outerHTML +
    "<style>body{margin:0;background:" +
    (simple
      ? "white"
      : getComputedStyle(document.documentElement).getPropertyValue(
          "--surface",
        )) +
    ";}img{max-width:100%}pre{white-space:pre-wrap}" +
    fonts.replace(/<\/style/gi, "<\\/style") +
    "</style></head><body>" +
    clone.outerHTML +
    "</body></html>"
  );
}
export function setupOutput(
  prepare: () => Promise<OutputSnapshot | null>,
  preview: HTMLElement,
) {
  const dialog = el<HTMLDialogElement>("output-dialog");
  let snapshot: OutputSnapshot | null = null,
    working = false;
  el("output-open").onclick = async () => {
    try {
      snapshot = await prepare();
      if (!snapshot) return;
      el("output-message").textContent = "";
      const tables = el<HTMLSelectElement>("output-table");
      tables.replaceChildren();
      preview
        .querySelectorAll<HTMLElement>("table[data-line][data-end-line]")
        .forEach((table, index) => {
          tables.add(
            new Option(
              t("表格 {0}", [index + 1]),
              `${table.dataset.line}:${table.dataset.endLine}`,
            ),
          );
        });
      el<HTMLButtonElement>("output-csv").disabled = !tables.options.length;
      dialog.showModal();
    } catch (e) {
      el("error").hidden = false;
      el("error").textContent = String(e);
    }
  };
  el("output-close").onclick = () => {
    if (!working) dialog.close();
  };
  el("output-print").onclick = async () => {
    if (!snapshot || working) return;
    working = true;
    let root: HTMLElement | null = null,
      sheet: HTMLStyleElement | null = null;
    const clean = () => {
      root?.remove();
      sheet?.remove();
      working = false;
      window.removeEventListener("afterprint", clean);
      if (!dialog.open) dialog.showModal();
      el("output-message").textContent = t(
        "打印界面已返回；是否保存 PDF 或完成打印，请在系统界面确认。",
      );
    };
    try {
      const html = exportHtml(
        preview,
        snapshot.name,
        el<HTMLSelectElement>("output-style").value === "simple",
      );
      const size =
        el<HTMLSelectElement>("output-paper").value === "Letter"
          ? "Letter"
          : "A4";
      const orientation =
        el<HTMLSelectElement>("output-orientation").value === "landscape"
          ? "landscape"
          : "portrait";
      const margin = Number(el<HTMLInputElement>("output-margin").value);
      if (!Number.isInteger(margin) || margin < 5 || margin > 30)
        throw Error("margin");
      root = document.createElement("section");
      root.id = "print-root";
      const doc = new DOMParser().parseFromString(html, "text/html");
      root.append(...doc.body.childNodes);
      root.querySelector<HTMLElement>("#preview")!.id = "print-preview";
      sheet = document.createElement("style");
      sheet.id = "print-styles";
      sheet.textContent = `@page { size:${size} ${orientation}; margin:${margin}mm; } #print-root{display:none} @media print { html,body{overflow:visible!important;height:auto!important;background:white!important} body > :not(#print-root){display:none!important} #print-root{display:block!important} #print-root #print-preview{padding:0!important} #print-root pre{white-space:pre-wrap!important} #print-root table{width:100%!important} #print-root img{max-width:100%!important} }`;
      document.head.append(sheet);
      document.body.append(root);
      await Promise.all(
        [...root.querySelectorAll("img")].map((i) => i.decode()),
      );
      await document.fonts.ready;
      dialog.close();
      window.addEventListener("afterprint", clean);
      window.print();
      // WebView2 returns after its native print UI. afterprint also handles browser implementations that return early.
      if (root.isConnected) clean();
    } catch {
      root?.remove();
      sheet?.remove();
      working = false;
      window.removeEventListener("afterprint", clean);
      el("output-message").textContent = t(
        "打印准备失败，请检查资源和页边距后重试。",
      );
    }
  };
  dialog.addEventListener("cancel", (event) => {
    if (working) event.preventDefault();
  });
  dialog.addEventListener("close", () => el("output-open").focus());
  for (const kind of ["markdown", "html-copy", "rich", "csv"]) {
    el(`output-${kind}`).onclick = async () => {
      if (!snapshot || working) return;
      working = true;
      el("output-message").textContent = t("正在处理…");
      try {
        if (kind === "markdown")
          await navigator.clipboard.writeText(snapshot.content);
        else if (kind === "csv") {
          const [start, end] = el<HTMLSelectElement>("output-table")
            .value.split(":")
            .map(Number);
          const range = blockRange(snapshot.content, start, end);
          const text = tableCsv(snapshot.content.slice(range.from, range.to));
          const path = await invoke<string | null>("export_document", {
            id: snapshot.id,
            revision: snapshot.revision,
            text,
            kind: "csv",
          });
          el("output-message").textContent = path
            ? t("已导出：{0}", [path])
            : t("已取消导出，文档未改变。");
          return;
        } else {
          const html = exportHtml(
            preview,
            snapshot.name,
            el<HTMLSelectElement>("output-style").value === "simple",
          );
          if (kind === "html-copy") await navigator.clipboard.writeText(html);
          else
            await navigator.clipboard.write([
              new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob(
                  [snapshot.content ? previewText(preview) : ""],
                  {
                    type: "text/plain",
                  },
                ),
              }),
            ]);
        }
        el("output-message").textContent =
          t("已复制。目标软件可能调整富文本样式。");
      } catch (e) {
        el("output-message").textContent = t(
          String(e) === "output-exists"
            ? "同名文件或目录已存在，未覆盖。请重新选择名称。"
            : "处理失败；请检查资源、表格格式或剪贴板权限，内容未改变。",
        );
      } finally {
        working = false;
      }
    };
  }
  el("output-html").onclick = async () => {
    if (!snapshot || working) return;
    working = true;
    el<HTMLButtonElement>("output-html").disabled = true;
    el<HTMLButtonElement>("output-close").disabled = true;
    el("output-message").textContent = t("正在导出…");
    try {
      const text = exportHtml(
        preview,
        snapshot.name,
        el<HTMLSelectElement>("output-style").value === "simple",
      );
      const path = await invoke<string | null>("export_document", {
        id: snapshot.id,
        revision: snapshot.revision,
        text,
        kind: "html",
      });
      el("output-message").textContent = path
        ? t("已导出：{0}", [path])
        : t("已取消导出，文档未改变。");
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      el("output-message").textContent = t(
        code === "output-exists"
          ? "同名文件或目录已存在，未覆盖。请重新选择名称。"
          : code === "output-resources"
            ? "图片、公式或图表尚未就绪，请等待或修复后重试。"
            : "导出失败，请检查扩展名、路径和文档状态后重试。",
      );
    } finally {
      working = false;
      el<HTMLButtonElement>("output-html").disabled = false;
      el<HTMLButtonElement>("output-close").disabled = false;
    }
  };
}
