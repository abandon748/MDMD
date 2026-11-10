import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { t } from "./i18n";
interface Asset {
  path: string;
  kind: string;
  content: string;
}
interface Formula {
  source: string;
  block: boolean;
}
let assets: Promise<Asset[]> | null = null;
let cancel: (() => void) | null = null;
let epoch = 0;
export function stopMath() {
  epoch++;
  cancel?.();
}
export function resetMath() {
  assets = null;
  stopMath();
}
const decode = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const encode = (s: string) =>
  btoa(
    Array.from(new TextEncoder().encode(s), (c) => String.fromCharCode(c)).join(
      "",
    ),
  );

function mathFrame(token: string) {
  const engine = (window as any).katex;
  if (!engine?.renderToString) {
    parent.postMessage({ token, failed: true }, "*");
    return;
  }
  window.addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.data?.token !== token ||
      !Array.isArray(event.data.formulas)
    )
      return;
    const result = event.data.formulas.map((f: Formula) => {
      try {
        return engine.renderToString(f.source, {
          displayMode: f.block,
          trust: false,
          throwOnError: true,
          output: "html",
          maxExpand: 200,
          maxSize: 10,
        });
      } catch {
        return null;
      }
    });
    parent.postMessage({ token, result }, "*");
  });
  parent.postMessage({ token, ready: true }, "*");
}
function render(
  formulas: Formula[],
  files: Asset[],
): Promise<(string | null)[]> {
  const script = files.find((f) => f.kind === "js");
  if (!script) return Promise.reject("engine-load");
  const token = crypto.randomUUID(),
    frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  frame.className = "engine-probe";
  frame.title = t("公式隔离渲染");
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src data:;connect-src 'none';base-uri 'none';form-action 'none'"><script src="data:text/javascript;base64,${script.content}"></script><script src="data:text/javascript;base64,${encode(`(${mathFrame.toString()})(${JSON.stringify(token)})`)}"></script>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  return new Promise((resolve, reject) => {
    const finish = (result?: (string | null)[]) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
      URL.revokeObjectURL(url);
      if (cancel === abort) cancel = null;
      result ? resolve(result) : reject("engine-load");
    };
    const abort = () => finish();
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token)
        return;
      if (event.data.ready)
        frame.contentWindow!.postMessage({ token, formulas }, "*");
      else if (
        Array.isArray(event.data.result) &&
        event.data.result.length === formulas.length
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
function styles(files: Asset[]) {
  if (document.getElementById("math-styles")) return;
  const css = files.find((f) => f.kind === "css");
  if (!css) throw Error("engine-load");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    decode(css.content).replace(/url\(([^)]+)\)/g, (_all, raw) => {
      const path = new URL(
        raw.replace(/["']/g, ""),
        "https://engine/" + css.path,
      ).pathname.slice(1);
      const font = files.find((f) => f.path === path && f.kind === "font");
      if (!font) throw Error("engine-load");
      return `url(data:font/${path.endsWith("woff2") ? "woff2" : path.endsWith("woff") ? "woff" : "ttf"};base64,${font.content})`;
    }),
  );
  const style = document.createElement("style");
  style.id = "math-styles";
  style.textContent = [...sheet.cssRules]
    .map((rule) => {
      if (rule instanceof CSSFontFaceRule) return rule.cssText;
      if (rule instanceof CSSStyleRule)
        return `${rule.selectorText
          .split(",")
          .map((s) => `#preview ${s.trim()}`)
          .join(",")} {${rule.style.cssText}}`;
      return "";
    })
    .join("\n");
  document.head.append(style);
}
export async function renderMath(
  preview: HTMLElement,
  valid: () => boolean,
  changed: () => void,
) {
  stopMath();
  const run = epoch;
  const nodes: HTMLElement[] = [],
    formulas: Formula[] = [];
  let total = 0;
  const mark = (node: HTMLElement, status: string) => {
    node.dataset.mathStatus = status;
    node.title = t(
      status === "missing"
        ? "未安装公式引擎，请在设置中下载后刷新"
        : status === "limit"
          ? "公式过大，已保留 TeX 原文"
          : status === "loading"
            ? "正在渲染公式…"
            : "公式渲染失败，已保留 TeX 原文；修正语法或修复引擎后刷新",
    );
  };
  for (const node of preview.querySelectorAll<HTMLElement>(".math-source")) {
    const source = node.textContent || "";
    if (
      source.length > 16384 ||
      nodes.length >= 100 ||
      total + source.length > 65536
    ) {
      mark(node, "limit");
      continue;
    }
    nodes.push(node);
    formulas.push({ source, block: node.dataset.math === "block" });
    total += source.length;
    mark(node, "loading");
  }
  if (!nodes.length) return;
  const current = () => run === epoch && valid();
  try {
    assets ||= invoke<Asset[]>("engine_assets", { id: "katex" });
    const files = await assets;
    if (!current()) return;
    styles(files);
    const result = await render(formulas, files);
    if (!current()) return;
    result.forEach((html, i) => {
      const node = nodes[i],
        source = formulas[i].source;
      if (!node.isConnected || node.textContent !== source) return;
      const selection = window.getSelection();
      if (
        selection &&
        !selection.isCollapsed &&
        selection.containsNode(node, true)
      ) {
        node.dataset.mathStatus = "plain";
        node.title = source;
        return;
      }
      if (typeof html !== "string" || html.length > 524288) {
        mark(node, "failed");
        return;
      }
      const safe = DOMPurify.sanitize(html, {
        FORBID_TAGS: ["a", "img", "iframe", "style", "script"],
        FORBID_ATTR: ["href", "src"],
      });
      const box = document.createElement("div");
      box.innerHTML = safe;
      if (!box.querySelector(".katex")) {
        mark(node, "failed");
        return;
      }
      node.replaceChildren(...box.childNodes);
      node.dataset.mathStatus = "ready";
      node.setAttribute("role", "math");
      node.setAttribute("aria-label", source);
      node.title = source;
    });
    changed();
  } catch (error) {
    if (current())
      nodes.forEach((n) =>
        mark(n, String(error) === "engine-missing" ? "missing" : "failed"),
      );
  }
}
