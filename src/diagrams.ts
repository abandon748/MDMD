import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
interface Asset {
  path: string;
  kind: string;
  content: string;
}
interface Result {
  graph?: GraphInfo;
  svg: string;
  width: number;
  height: number;
  labels?: DiagramLabel[];
}
export interface GraphInfo {
  nodes: { id: string; parent: string; group: boolean; label: string }[];
  edges: { id: string; from: string; to: string }[];
}
export interface DiagramLabel {
  text: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const cache = new Map<string, Promise<Asset[]>>();
let epoch = 0;
const cancels = new Set<() => void>();
export function stopDiagrams() {
  epoch++;
  for (const cancel of cancels) cancel();
}
export function resetDiagrams() {
  cache.clear();
  stopDiagrams();
}
const encode = (s: string) =>
  btoa(
    Array.from(new TextEncoder().encode(s), (c) => String.fromCharCode(c)).join(
      "",
    ),
  );

async function diagramFrame(token: string, id: string) {
  const w = window as any;
  const send = (value: object) => parent.postMessage({ token, ...value }, "*");
  window.addEventListener("message", async (event) => {
    if (
      event.source !== parent ||
      event.data?.token !== token ||
      !Array.isArray(event.data.sources)
    )
      return;
    const { sources, dark, foreground, background } = event.data;
    const result = [];
    for (let i = 0; i < sources.length; i++) {
      const box = document.getElementById("diagram")!;
      box.replaceChildren();
      let map: any;
      try {
        if (id === "mermaid") {
          w.mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            maxTextSize: 32768,
            maxEdges: 500,
            theme: dark ? "dark" : "default",
            htmlLabels: false,
            flowchart: { htmlLabels: false },
            themeVariables: { background, textColor: foreground },
          });
          const { svg } = await w.mermaid.render(`diagram-${i}`, sources[i]);
          box.innerHTML = svg;
        } else {
          const { root } = new w.markmap.Transformer().transform(
            sources[i].replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
          );
          box.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400" style="width:800px;height:400px"></svg>';
          map = w.markmap.Markmap.create(box.firstElementChild, {
            duration: 0,
            maxWidth: 250,
          });
          await map.setData(root);
          await map.fit();
        }
        const svg = box.querySelector("svg")!;
        if (!svg) throw Error("svg");
        const clone = svg.cloneNode(true) as SVGSVGElement;
        const view = svg.viewBox.baseVal;
        const width = view.width || 800,
          height = view.height || 400;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));
        clone.style.cssText = `background:${background};color:${foreground};max-width:none`;
        if (id === "markmap") {
          const style = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "style",
          );
          style.textContent =
            [...document.querySelectorAll("style")]
              .map((s) => s.textContent)
              .join("\n") + `\n.markmap-foreign {color:${foreground}}`;
          clone.prepend(style);
        }
        const labels: DiagramLabel[] = [];
        let graph: GraphInfo | undefined;
        if (event.data.editLabels && id === "mermaid") {
          const inverse = svg.getScreenCTM()?.inverse();
          if (
            inverse &&
            /^\s*(?:%%[^\n]*\n\s*)*(?:graph|flowchart)\s/.test(sources[i])
          ) {
            const parsed = await w.mermaid.mermaidAPI.getDiagramFromText(
              sources[i],
            );
            const data = parsed.db.getData();
            graph = {
              nodes: data.nodes.map((n: any) => ({
                id: n.id,
                parent: n.parentId || "",
                group: !!n.isGroup,
                label: String(n.label ?? n.id),
              })),
              edges: data.edges.map((e: any) => ({
                id: e.id,
                from: e.start,
                to: e.end,
              })),
            };
            const add = (kind: string, text: string, p: DOMPoint) => {
              if (labels.length >= 600) return;
              labels.push({
                kind,
                text,
                x: (p.x - view.x) / width,
                y: (p.y - view.y) / height,
                w: 0,
                h: 0,
              });
            };
            for (const el of svg.querySelectorAll<SVGGraphicsElement>(
              "g.cluster,g.node,path.flowchart-link",
            )) {
              const local = el.getScreenCTM();
              if (!local) continue;
              if (el instanceof SVGPathElement) {
                const key = el.getAttribute("data-id") || "";
                if (graph!.edges.some((e) => e.id === key))
                  add(
                    "graph-edge",
                    key,
                    el
                      .getPointAtLength(el.getTotalLength() / 2)
                      .matrixTransform(local)
                      .matrixTransform(inverse),
                  );
              } else {
                const cluster = el.classList.contains("cluster");
                const prefix = "diagram-" + i + "-";
                const key = el.id.slice(prefix.length);
                const id = cluster
                  ? key
                  : /^flowchart-(.+)-\d+$/.exec(key)?.[1];
                if (!id || !graph!.nodes.some((n) => n.id === id)) continue;
                const rect = (
                  cluster ? el.querySelector(".cluster-label") || el : el
                ).getBoundingClientRect();
                add(
                  cluster ? "graph-group" : "graph-node",
                  id,
                  new DOMPoint(
                    rect.left + rect.width / 2,
                    rect.top + rect.height / 2,
                  ).matrixTransform(inverse),
                );
              }
            }
          }
          const labelLimit = labels.length + 600;
          for (const el of svg.querySelectorAll("text")) {
            if (!inverse || labels.length >= labelLimit) break;
            const kind = el.closest(".node")
              ? "node"
              : el.closest(".edgeLabel")
                ? "edge"
                : el.matches(".messageText")
                  ? "message"
                  : el.matches(".noteText")
                    ? "note"
                    : el.matches(".actor,.actor-box,.actor-man,.actor-female")
                      ? "actor"
                      : "";
            if (!kind) continue;
            const rect = el.getBoundingClientRect();
            const a = new DOMPoint(rect.left, rect.top).matrixTransform(
              inverse,
            );
            const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(
              inverse,
            );
            labels.push({
              kind,
              text: el.textContent?.trim() || "",
              x: (a.x - view.x) / width,
              y: (a.y - view.y) / height,
              w: (b.x - a.x) / width,
              h: (b.y - a.y) / height,
            });
          }
        }
        result.push({
          graph,
          labels,
          svg: new XMLSerializer().serializeToString(clone),
          width,
          height,
        });
      } catch {
        result.push(null);
      } finally {
        map?.destroy();
        box.replaceChildren();
      }
    }
    send({ result });
  });
  send({ ready: true });
}
function render(
  id: string,
  sources: string[],
  files: Asset[],
  editLabels: boolean,
): Promise<(Result | null)[]> {
  const token = crypto.randomUUID(),
    frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  frame.className = "engine-probe";
  frame.title = t("图表隔离渲染");
  const scripts = files
    .filter((f) => f.kind === "js")
    .map(
      (f) => `<script src="data:text/javascript;base64,${f.content}"></script>`,
    )
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src data:;style-src 'unsafe-inline';img-src data:;connect-src 'none';base-uri 'none';form-action 'none'"><div id="diagram" style="width:800px"></div>${scripts}<script src="data:text/javascript;base64,${encode(`(${diagramFrame.toString()})(${JSON.stringify(token)},${JSON.stringify(id)})`)}"></script>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  return new Promise((resolve, reject) => {
    const finish = (result?: (Result | null)[]) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
      URL.revokeObjectURL(url);
      cancels.delete(abort);
      result ? resolve(result) : reject("engine-load");
    };
    const abort = () => finish();
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token)
        return;
      if (event.data.ready) {
        const styles = getComputedStyle(document.documentElement);
        frame.contentWindow!.postMessage(
          {
            token,
            sources,
            editLabels,
            dark: document.documentElement.dataset.theme === "dark",
            foreground: styles.getPropertyValue("--text").trim(),
            background: styles.getPropertyValue("--surface").trim(),
          },
          "*",
        );
      } else if (
        Array.isArray(event.data.result) &&
        event.data.result.length === sources.length
      )
        finish(event.data.result);
      else finish();
    };
    const timer = window.setTimeout(abort, 10000);
    cancels.add(abort);
    window.addEventListener("message", receive);
    frame.src = url;
    document.body.append(frame);
  });
}
export async function inspectGraph(body: string) {
  const files = await cache.get("mermaid");
  if (!files || body.length > 32768) throw Error("graph");
  const [result] = await render("mermaid", [body], files, true);
  if (!result?.graph) throw Error("graph");
  return result.graph;
}
export async function renderDiagrams(
  preview: HTMLElement,
  valid: () => boolean,
  changed: () => void,
  edit: (node: HTMLElement) => void,
  visual?: (node: HTMLElement) => void,
  showControls = true,
  onLabels?: (
    container: HTMLElement,
    labels: DiagramLabel[],
    graph?: GraphInfo,
  ) => void,
) {
  stopDiagrams();
  const run = epoch,
    current = () => epoch === run && valid();
  let total = 0,
    count = 0;
  for (const id of ["mermaid", "markmap"]) {
    const pres: HTMLElement[] = [],
      sources: string[] = [];
    for (const code of preview.querySelectorAll<HTMLElement>(
      `pre > code.language-${id}`,
    )) {
      const pre = code.parentElement!,
        source = code.textContent || "";
      if (
        source.length > 32768 ||
        count >= 12 ||
        total + source.length > 65536
      ) {
        pre.dataset.diagramStatus = "limit";
        pre.dataset.language = t("图表过大，已保留源码");
        pre.title = t("图表过大，已保留源码");
        continue;
      }
      pres.push(pre);
      sources.push(source);
      total += source.length;
      count++;
      pre.dataset.diagramStatus = "loading";
      pre.title = t("正在渲染图表…");
    }
    if (!pres.length) continue;
    try {
      if (!cache.has(id))
        cache.set(id, invoke<Asset[]>("engine_assets", { id }));
      const files = await cache.get(id)!;
      if (!current()) return;
      const result = await render(id, sources, files, !!onLabels);
      if (!current()) return;
      for (let i = 0; i < result.length; i++) {
        const value = result[i],
          pre = pres[i];
        if (!pre.isConnected) continue;
        const selection = window.getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          selection.containsNode(pre, true)
        ) {
          pre.dataset.diagramStatus = "plain";
          pre.title = "";
          continue;
        }
        if (
          !value ||
          typeof value.svg !== "string" ||
          value.svg.length > 2097152 ||
          !Number.isFinite(value.width) ||
          !Number.isFinite(value.height) ||
          value.width <= 0 ||
          value.height <= 0
        ) {
          pre.dataset.diagramStatus = "failed";
          pre.dataset.language = t("图表未就绪，已保留源码");
          pre.title = t("图表渲染失败，已保留源码；修正语法或修复引擎后刷新");
          continue;
        }
        const box = document.createElement("div");
        box.className = "diagram";
        box.dataset.diagramStatus = "ready";
        box.dataset.engine = id;
        for (const key of ["line", "endLine"])
          if (pre.dataset[key]) box.dataset[key] = pre.dataset[key];
        const controls = document.createElement("div");
        controls.className = "diagram-controls";
        controls.dataset.statIgnore = "";
        const scroll = document.createElement("div");
        scroll.className = "diagram-scroll";
        const img = document.createElement("img");
        img.alt = id === "mermaid" ? t("Mermaid 图表") : t("脑图（markmap）");
        img.className = "diagram-image";
        img.src = `data:image/svg+xml;base64,${encode(value.svg)}`;
        let scale = 100;
        const size = () => {
          img.style.width = `${scale}%`;
          img.style.maxWidth = "none";
          label.textContent = `${id} · ${scale}%`;
          minus.disabled = scale <= 25;
          plus.disabled = scale >= 200;
        };
        const button = (text: string, action: () => void) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = text;
          b.onclick = action;
          controls.append(b);
          return b;
        };
        const label = document.createElement("span");
        controls.append(label);
        const minus = button("−", () => {
          scale -= 25;
          size();
        });
        minus.title = t("缩小图表");
        const plus = button("+", () => {
          scale += 25;
          size();
        });
        plus.title = t("放大图表");
        button(t("适应宽度"), () => {
          scale = 100;
          size();
        });
        const sourceButton = button(t("查看源码"), () => {
          pre.hidden = !pre.hidden;
          pre.toggleAttribute("data-stat-ignore", pre.hidden);
          sourceButton.setAttribute("aria-expanded", String(!pre.hidden));
          changed();
        });
        sourceButton.setAttribute("aria-expanded", "false");
        button(t("编辑源码"), () => edit(box)).dataset.documentEdit = "";
        if (id === "mermaid" && visual)
          button(t("可视化编辑"), () => visual(box)).dataset.documentEdit = "";
        controls.hidden = !showControls;
        size();
        scroll.append(img);
        pre.before(box);
        box.append(controls, scroll, pre);
        pre.hidden = true;
        if (onLabels && Array.isArray(value.labels))
          onLabels(scroll, value.labels.slice(0, 1200), value.graph);
        pre.dataset.statIgnore = "";
        delete pre.dataset.diagramStatus;
        pre.title = "";
        img.onerror = () => {
          if (!box.isConnected) return;
          scroll.remove();
          controls.remove();
          pre.hidden = false;
          pre.removeAttribute("data-stat-ignore");
          box.dataset.diagramStatus = "failed";
          box.title = t("图表图片无法显示，已保留源码");
          changed();
        };
      }
      changed();
    } catch (error) {
      if (!current()) return;
      pres.forEach((pre) => {
        pre.dataset.diagramStatus = "failed";
        pre.dataset.language = t("图表未就绪，已保留源码");
        pre.title = t(
          String(error) === "engine-missing"
            ? "未安装图表引擎，请在设置中下载后刷新"
            : "图表渲染失败，已保留源码；修正语法或修复引擎后刷新",
        );
      });
    }
  }
}

export function previewText(node: Node) {
  if (!(node as ParentNode).querySelector?.("[data-stat-ignore]"))
    return node.textContent || "";
  const copy = node.cloneNode(true) as ParentNode;
  copy.querySelectorAll?.("[data-stat-ignore]").forEach((n) => n.remove());
  return copy.textContent || "";
}
