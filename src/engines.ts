import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { engineProbe } from "./engine-probe";
interface Row {
  id: string;
  version: string;
  bytes: number;
  status: string;
  error: string | null;
}
interface View {
  rows: Row[];
  busy: string | null;
  downloaded: number;
  total: number;
  committing: boolean;
}
interface Asset {
  path: string;
  kind: string;
  content: string;
}
const names: Record<string, string> = {
  highlight: "语法高亮",
  mermaid: "Mermaid 图表",
  katex: "数学公式（KaTeX）",
  markmap: "脑图（markmap）",
};
const errors: Record<string, string> = {
  "engine-network": "下载连接失败或超时，请检查网络后重试。",
  "engine-http": "下载源返回错误，原有资源已保留，请稍后重试。",
  "engine-timeout": "下载超时，原有资源已保留，请重试。",
  "engine-integrity": "资源校验失败，未启用下载内容。请重新下载。",
  "engine-write": "资源保存失败，请检查应用数据目录权限后重试。",
  "engine-read": "资源读取失败，请检查权限后重试。",
  "engine-missing": "资源尚未安装，请下载。",
  "engine-cancelled": "下载已取消，原有资源保留。",
  "engine-busy": "正在处理另一项操作，请稍后重试。",
  "engine-load": "资源无法加载，请重新检测或重新下载。",
};
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let view: View = {
  rows: [],
  busy: null,
  downloaded: 0,
  total: 0,
  committing: false,
};
let checking = false,
  polling = false,
  message = "",
  generation = 0;
const ready = new Set<string>(),
  failed = new Set<string>();
let abortProbe: (() => void) | null = null;
let returnFocus: HTMLElement | null = null;
function decode(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function encode(text: string) {
  return btoa(
    Array.from(new TextEncoder().encode(text), (c) =>
      String.fromCharCode(c),
    ).join(""),
  );
}
function probe(id: string, assets: Asset[]): Promise<void> {
  const urls: string[] = [];
  const blob = (data: BlobPart, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    urls.push(url);
    return url;
  };
  const token = crypto.randomUUID(),
    frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  frame.className = "engine-probe";
  frame.title = t("渲染引擎加载自检");
  const scripts = assets
    .filter((f) => f.kind === "js")
    .map(
      (f) => `<script src="data:text/javascript;base64,${f.content}"></script>`,
    )
    .join("");
  const styles = assets
    .filter((f) => f.kind === "css")
    .map((f) => {
      const css = new TextDecoder()
        .decode(decode(f.content))
        .replace(/url\(([^)]+)\)/g, (_all, raw) => {
          const path = new URL(
            raw.replace(/["']/g, ""),
            "https://engine/" + f.path,
          ).pathname.slice(1);
          const font = assets.find((a) => a.path === path && a.kind === "font");
          if (!font) throw new Error("engine-load");
          return `url(data:font/${path.endsWith("woff2") ? "woff2" : path.endsWith("woff") ? "woff" : "ttf"};base64,${font.content})`;
        });
      return `<link rel="stylesheet" href="data:text/css;base64,${encode(css)}">`;
    })
    .join("");
  const bootstrap =
    "data:text/javascript;base64," +
    encode(
      `(${engineProbe.toString()})(${JSON.stringify(id)},${JSON.stringify(token)});`,
    );
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src data: 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><div id="probe"></div>${styles}${scripts}<script src="${bootstrap}"></script>`;
  return new Promise((resolve, reject) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
      urls.forEach(URL.revokeObjectURL);
      abortProbe = null;
      ok ? resolve() : reject(new Error("engine-load"));
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source === frame.contentWindow &&
        event.data?.type === "mdmd-engine-probe" &&
        event.data.token === token
      ) {
        if (!event.data.ok)
          console.error("Engine probe:", id, event.data.error);
        finish(event.data.ok === true);
      }
    };
    const timer = window.setTimeout(() => finish(false), 20000);
    abortProbe = () => finish(false);
    window.addEventListener("message", receive);
    frame.src = blob(html, "text/html");
    document.body.append(frame);
  });
}
export function reflectEngines() {
  for (const row of view.rows) {
    const status =
      view.busy === row.id
        ? t(view.committing ? "正在保存…" : "下载中")
        : checking && row.status === "installed" && !ready.has(row.id)
          ? t("加载检测中…")
          : ready.has(row.id)
            ? t("已就绪")
            : failed.has(row.id) || row.status === "damaged"
              ? t("失败")
              : row.status === "installed"
                ? t("待加载检测")
                : t("未安装");
    el(`engine-${row.id}-status`).textContent = status;
    el(`engine-${row.id}-status`).classList.toggle(
      "integration-ready",
      ready.has(row.id) && view.busy !== row.id,
    );
    el(`engine-${row.id}-version`).textContent =
      `${row.version} · ${(row.bytes / 1048576).toFixed(2)} MiB`;
    const button = el<HTMLButtonElement>(`engine-${row.id}-download`);
    button.disabled = checking || !!view.busy;
    button.textContent = t(row.status === "missing" ? "下载" : "重新下载");
    el(`engine-${row.id}-error`).textContent = t(
      errors[row.error ?? ""] ??
        (failed.has(row.id)
          ? errors["engine-load"]
          : row.status === "damaged"
            ? errors["engine-integrity"]
            : ""),
    );
  }
  el<HTMLButtonElement>("engines-refresh").disabled = checking || !!view.busy;
  el<HTMLButtonElement>("engines-cancel").disabled =
    !view.busy || view.committing;
  el("engines-progress-area").hidden = !view.busy;
  el<HTMLProgressElement>("engines-progress").max = view.total || 1;
  el<HTMLProgressElement>("engines-progress").value = view.downloaded;
  el("engines-progress-text").textContent = view.busy
    ? `${t(names[view.busy])} · ${Math.min(100, Math.floor((view.downloaded / Math.max(1, view.total)) * 100))}%`
    : "";
  el("engines-message").textContent = t(message);
}
async function refresh() {
  if (checking) return;
  checking = true;
  const run = ++generation;
  ready.clear();
  failed.clear();
  message = "";
  reflectEngines();
  try {
    const next = await invoke<View>("engine_action", {
      action: "refresh",
      id: "",
    });
    if (run !== generation) return;
    view = next;
    reflectEngines();
    if (!view.busy)
      for (const row of view.rows) {
        if (run !== generation) return;
        if (row.status !== "installed") continue;
        try {
          const assets = await invoke<Asset[]>("engine_assets", { id: row.id });
          if (run !== generation) return;
          await probe(row.id, assets);
          if (run === generation) ready.add(row.id);
        } catch (error) {
          console.error("MDMD engine check", row.id, error);
          if (run === generation) failed.add(row.id);
        }
        reflectEngines();
      }
  } catch {
    message = "无法检测渲染资源，请重试。";
  } finally {
    if (run === generation) {
      checking = false;
      reflectEngines();
      window.dispatchEvent(new Event("mdmd-engines-changed"));
    }
  }
}
async function action(action: string, id: string) {
  checking = true;
  reflectEngines();
  try {
    view = await invoke<View>("engine_action", { action, id });
    message = "";
  } catch (error) {
    message = errors[String(error)] ?? "无法检测渲染资源，请重试。";
  } finally {
    checking = false;
    reflectEngines();
  }
}
export function setupEngines(beforeOpen: () => void) {
  const dialog = el<HTMLDialogElement>("engines-dialog");
  el("engines-manage").onclick = () => {
    beforeOpen();
    returnFocus = document.activeElement as HTMLElement;
    dialog.showModal();
    el("engines-close").focus();
    void refresh();
  };
  el("engines-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    generation++;
    abortProbe?.();
    checking = false;
    // Some engines may already be installed while another probe is cancelled.
    // Invalidate document caches even when the full refresh did not finish.
    window.dispatchEvent(new Event("mdmd-engines-changed"));
    returnFocus?.focus();
  });
  el("engines-refresh").onclick = () => void refresh();
  el("engines-cancel").onclick = () =>
    view.busy && void action("cancel", view.busy);
  for (const id of Object.keys(names))
    el(`engine-${id}-download`).onclick = () => void action("download", id);
  window.setInterval(async () => {
    if (!dialog.open || checking || polling || !view.busy) return;
    polling = true;
    try {
      view = await invoke<View>("engine_state");
      if (!view.busy) {
        const lastErrors = new Map(view.rows.map((r) => [r.id, r.error]));
        await refresh();
        for (const row of view.rows) row.error = lastErrors.get(row.id) ?? null;
        reflectEngines();
      } else reflectEngines();
    } catch {
      message = "无法检测渲染资源，请重试。";
      reflectEngines();
    } finally {
      polling = false;
    }
  }, 500);
}
