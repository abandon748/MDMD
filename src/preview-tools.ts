import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";

// Controls are outside source-mapped blocks and excluded from statistics/export.
export function previewTools(
  preview: HTMLElement,
  editTable: (table: HTMLElement) => void,
) {
  const controls = () => {
    const box = document.createElement("div");
    box.className = "preview-tools";
    box.dataset.previewTool = "";
    box.dataset.statIgnore = "";
    return box;
  };
  for (const table of preview.querySelectorAll<HTMLElement>(
    "table[data-end-line]",
  )) {
    const box = controls(),
      button = document.createElement("button");
    button.textContent = t("编辑表格");
    button.dataset.documentEdit = "";
    button.onclick = () => editTable(table);
    box.append(button);
    table.parentElement!.before(box);
  }
  for (const code of preview.querySelectorAll<HTMLElement>("pre > code")) {
    if (code.matches(".language-mermaid,.language-markmap")) continue;
    const pre = code.parentElement!,
      source = code.textContent || "";
    const box = controls(),
      copy = document.createElement("button"),
      numbers = document.createElement("button");
    copy.textContent = t("复制代码");
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(source);
        copy.textContent = t("已复制");
      } catch {
        copy.textContent = t("复制失败，请重试");
      }
    };
    numbers.textContent = t("行号");
    numbers.dataset.codeNumbers = "";
    numbers.setAttribute(
      "aria-pressed",
      String(preview.classList.contains("code-numbered")),
    );
    numbers.title = t("仅影响此代码块；刷新后跟随全局设置。");
    numbers.onclick = () => {
      const on = numbers.getAttribute("aria-pressed") !== "true";
      pre.dataset.lineNumbers = String(on);
      numbers.setAttribute("aria-pressed", String(on));
    };
    box.append(copy, numbers);
    pre.before(box);
  }
}

export function remoteImage(
  img: HTMLImageElement,
  id: string,
  valid: () => boolean,
) {
  const src = img.dataset.localSrc || "";
  let url: URL;
  try {
    url = new URL(src);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      throw Error();
  } catch {
    img.title = t("不支持的网络图片地址");
    return;
  }
  const box = document.createElement("span"),
    button = document.createElement("button"),
    note = document.createElement("span");
  box.className = "network-image";
  box.dataset.previewTool = box.dataset.statIgnore = "";
  button.textContent = t("加载网络图片");
  note.textContent = url.host;
  box.title = t(
    "仅点击后联网，不发送 Cookie 或文档内容；最大 10 MiB，不支持 SVG。刷新后需重新加载。",
  );
  img.hidden = true;
  img.after(box);
  box.append(button, note);
  const fail = () => {
    img.hidden = true;
    img.removeAttribute("src");
    button.hidden = false;
    button.disabled = false;
    button.textContent = t("加载失败，点击重试");
  };
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = t("加载中…");
    try {
      const data = await invoke<{ content: string; contentType: string }>(
        "preview_link",
        { id, kind: "image", target: url.href },
      );
      if (!valid() || !img.isConnected) return;
      img.src = `data:${data.contentType.split(";")[0]};base64,${data.content}`;
      await img.decode();
      if (!valid() || !img.isConnected) return;
      // Bound decoded dimensions as well as transfer bytes.
      if (img.naturalWidth * img.naturalHeight > 40_000_000)
        throw Error("pixels");
      img.hidden = false;
      box.hidden = true;
    } catch {
      if (valid() && img.isConnected) fail();
    }
  };
}
