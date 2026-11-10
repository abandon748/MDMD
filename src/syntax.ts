import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { t } from "./i18n";

interface Asset {
  path: string;
  kind: string;
  content: string;
}
interface Block {
  source: string;
  language: string;
}
interface Result {
  html?: string;
  language: string;
  status: string;
}
let assets: Promise<Asset[]> | null = null;
let cancel: (() => void) | null = null;
let epoch = 0;
export function resetSyntax() {
  assets = null;
  cancel?.();
}
export function stopSyntax() {
  epoch++;
  cancel?.();
}

// This function runs only in an opaque, network-disabled iframe. Source text is
// sent through postMessage; it is never interpolated into a script or HTML page.
function syntaxFrame(token: string) {
  const hljs = (window as any).hljs;
  const send = (value: object) => parent.postMessage({ token, ...value }, "*");
  try {
    if (!hljs?.getLanguage || !hljs?.highlight) throw Error("engine");
    hljs.safeMode();
    window.addEventListener("message", (event) => {
      if (
        event.source !== parent ||
        event.data?.token !== token ||
        !Array.isArray(event.data.blocks)
      )
        return;
      const result: Result[] = event.data.blocks.map((block: Block) => {
        try {
          if (block.language && !hljs.getLanguage(block.language))
            return { language: block.language, status: "unknown" };
          const out = block.language
            ? hljs.highlight(block.source, {
                language: block.language,
                ignoreIllegals: true,
              })
            : hljs.highlightAuto(block.source, [
                "javascript",
                "typescript",
                "python",
                "rust",
                "java",
                "cpp",
                "json",
                "xml",
                "css",
                "sql",
                "bash",
              ]);
          if (!block.language && (!out.language || out.relevance < 2))
            return { language: "text", status: "plain" };
          return {
            html: out.value,
            language: out.language || block.language,
            status: "ready",
          };
        } catch {
          return { language: block.language, status: "failed" };
        }
      });
      send({ result });
    });
    send({ ready: true });
  } catch {
    send({ failed: true });
  }
}

function render(blocks: Block[], files: Asset[]): Promise<Result[]> {
  const token = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  frame.className = "engine-probe";
  frame.title = t("代码高亮隔离渲染");
  const encode = (s: string) =>
    btoa(
      Array.from(new TextEncoder().encode(s), (c) =>
        String.fromCharCode(c),
      ).join(""),
    );
  const script = files.find((f) => f.kind === "js");
  if (!script) return Promise.reject("engine-load");
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src data:;connect-src 'none';base-uri 'none';form-action 'none'"><script src="data:text/javascript;base64,${script.content}"></script><script src="data:text/javascript;base64,${encode(`(${syntaxFrame.toString()})(${JSON.stringify(token)})`)}"></script>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  return new Promise((resolve, reject) => {
    const finish = (value?: Result[]) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
      URL.revokeObjectURL(url);
      if (cancel === abort) cancel = null;
      value ? resolve(value) : reject("engine-load");
    };
    const abort = () => finish();
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token)
        return;
      if (event.data.ready)
        frame.contentWindow!.postMessage({ token, blocks }, "*");
      else if (
        Array.isArray(event.data.result) &&
        event.data.result.length === blocks.length
      )
        finish(event.data.result);
      else finish();
    };
    const timer = window.setTimeout(abort, 5000);
    cancel = abort;
    window.addEventListener("message", receive);
    frame.src = url;
    document.body.append(frame);
  });
}

function colors(files: Asset[]) {
  for (const theme of ["light", "dark"]) {
    const id = `syntax-${theme}`;
    document.getElementById(id)?.remove();
    const file = files.find((f) =>
      f.path.endsWith(
        theme === "dark" ? "/github-dark.min.css" : "/github.min.css",
      ),
    );
    if (!file) throw Error("engine-load");
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      new TextDecoder().decode(
        Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)),
      ),
    );
    const style = document.createElement("style");
    style.id = id;
    style.textContent = [...sheet.cssRules]
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .map((rule) => {
        const selectors = rule.selectorText
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.startsWith(".hljs-") || s.startsWith(".hljs."));
        return selectors.length
          ? `${selectors.map((s) => `:root[data-theme="${theme}"] #preview ${s}`).join(",")} {${rule.style.cssText}}`
          : "";
      })
      .join("\n");
    document.head.append(style);
  }
}

// Clone ranges from sanitized spans, preserving multiline comments/strings and
// exact newline bytes. Number gutters and language labels remain CSS content.
export function codeLines(code: HTMLElement, html?: string) {
  const source = code.textContent || "";
  const box = document.createElement("div");
  if (html !== undefined) {
    box.innerHTML = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["span"],
      ALLOWED_ATTR: ["class"],
    });
    if (box.textContent !== source) throw Error("highlight-source");
  } else box.textContent = source;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT),
    nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let index = 0,
    base = 0;
  const point = (offset: number): [Node, number] => {
    while (index < nodes.length - 1 && offset > base + nodes[index].length) {
      base += nodes[index].length;
      index++;
    }
    return nodes.length ? [nodes[index], offset - base] : [box, 0];
  };
  const lines = source.split("\n");
  if (source.endsWith("\n")) lines.pop();
  const output = document.createDocumentFragment();
  let offset = 0;
  lines.forEach((line, i) => {
    const span = document.createElement("span");
    span.className = "code-line";
    span.dataset.number = String(i + 1);
    const range = document.createRange();
    range.setStart(...point(offset));
    range.setEnd(...point(offset + line.length));
    let content: Node = range.cloneContents();
    let ancestor: Node | null = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode;
    while (ancestor instanceof HTMLElement && ancestor !== box) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(content);
      content = wrapper;
      ancestor = ancestor.parentNode;
    }
    span.append(content);
    if (!line) span.append(document.createElement("br"));
    output.append(span);
    if (i < lines.length - 1 || source.endsWith("\n")) output.append("\n");
    offset += line.length + 1;
  });
  code.replaceChildren(output);
  code.classList.add("code-lines");
  code.style.setProperty(
    "--number-width",
    `${String(lines.length).length + 2}ch`,
  );
}

export async function syntaxHighlight(
  preview: HTMLElement,
  valid: () => boolean,
) {
  stopSyntax();
  const run = epoch;
  const codes = [...preview.querySelectorAll<HTMLElement>("pre > code")];
  const selected: HTMLElement[] = [];
  const blocks: Block[] = [];
  let total = 0;
  const label = (code: HTMLElement, language: string, status: string) => {
    code.dataset.highlight = status;
    const descriptions: Record<string, string> = {
      loading: "加载高亮…",
      missing: "未安装高亮引擎，请在设置中下载后刷新",
      failed: "高亮失败，已保留纯文本；修复引擎后刷新重试",
      unknown: "未知语言，保留纯文本",
      limit: "代码过大，保留纯文本",
      plain: "纯文本",
    };
    code.parentElement!.dataset.language =
      (language || "auto") +
      (descriptions[status] ? ` · ${t(descriptions[status])}` : "");
  };
  for (const code of codes) {
    const source = code.textContent || "";
    const language = (
      [...code.classList].find((s) => s.startsWith("language-"))?.slice(9) || ""
    ).toLowerCase();
    codeLines(code);
    if (
      [
        "text",
        "txt",
        "plaintext",
        "nohighlight",
        "mermaid",
        "markmap",
      ].includes(language) ||
      !source
    ) {
      label(code, language, "plain");
      continue;
    }
    // ponytail: bounded whole-preview batches; use a worker/viewport queue if
    // measured large-document needs exceed these conservative limits.
    if (
      source.length > (language ? 65536 : 8192) ||
      blocks.length >= 100 ||
      total + source.length > 262144
    ) {
      label(code, language, "limit");
      continue;
    }
    total += source.length;
    selected.push(code);
    blocks.push({ source, language });
    label(code, language, "loading");
  }
  if (!blocks.length) return;
  const current = () => run === epoch && valid();
  try {
    assets ||= invoke<Asset[]>("engine_assets", { id: "highlight" });
    const files = await assets;
    if (!current()) return;
    colors(files);
    const result = await render(blocks, files);
    if (!current()) return;
    result.forEach((value, i) => {
      const code = selected[i];
      if (!code.isConnected || code.textContent !== blocks[i].source) return;
      const selection = window.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        selection.containsNode(code, true)
      ) {
        label(code, blocks[i].language, "plain");
        return;
      }
      try {
        if (
          value.status === "ready" &&
          typeof value.html === "string" &&
          value.html.length <= 2 * 1024 * 1024
        )
          codeLines(code, value.html);
        else if (value.status === "ready") throw Error("output-size");
        label(
          code,
          typeof value.language === "string"
            ? value.language.slice(0, 80)
            : blocks[i].language,
          value.status,
        );
      } catch {
        label(code, blocks[i].language, "failed");
      }
    });
  } catch (e) {
    if (current())
      selected.forEach((code, i) =>
        label(
          code,
          blocks[i].language,
          String(e) === "engine-missing" ? "missing" : "failed",
        ),
      );
  }
}
