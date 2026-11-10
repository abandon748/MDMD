import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import type { OutputSnapshot } from "./output";
interface Entry {
  key: string;
  modified: number;
  bytes: number;
}
interface Version {
  content: string;
  hash: string;
}
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export function setupVersions(
  prepare: () => Promise<OutputSnapshot | null>,
  apply: (snapshot: OutputSnapshot, content: string) => boolean,
) {
  const dialog = el<HTMLDialogElement>("versions-dialog");
  let snapshot: OutputSnapshot | null = null,
    loaded: Version | null = null,
    working = false,
    chosen = "";
  const message = (text: string) => {
    el("versions-message").textContent = t(text);
  };
  el("versions-open").onclick = async () => {
    if (working) return;
    working = true;
    try {
      snapshot = await prepare();
      if (!snapshot) return;
      loaded = null;
      chosen = "";
      el<HTMLTextAreaElement>("versions-source").value = "";
      el<HTMLButtonElement>("versions-apply").disabled = true;
      el("versions-list").replaceChildren();
      message("正在读取版本…");
      dialog.showModal();
      const entries = await invoke<Entry[]>("document_versions", {
        id: snapshot.id,
        revision: snapshot.revision,
      });
      message(
        entries.length
          ? "选择版本预览；恢复只替换编辑内容，可撤销。恢复后自动保存暂停，请手动保存。"
          : "没有可用历史版本。保存覆盖文件后会生成备份。",
      );
      for (const entry of entries) {
        const button = document.createElement("button");
        button.textContent = `${new Date(entry.modified).toLocaleString()} · ${entry.bytes} B · ${entry.key.split("/")[0]}`;
        button.title = entry.key;
        button.onclick = async () => {
          if (working || !snapshot) return;
          working = true;
          loaded = null;
          el<HTMLButtonElement>("versions-apply").disabled = true;
          try {
            loaded = await invoke<Version>("read_version", {
              id: snapshot.id,
              revision: snapshot.revision,
              key: entry.key,
            });
            chosen = entry.key;
            el<HTMLTextAreaElement>("versions-source").value = loaded.content;
            el<HTMLButtonElement>("versions-apply").disabled = false;
            message(
              "选择版本预览；恢复只替换编辑内容，可撤销。恢复后自动保存暂停，请手动保存。",
            );
          } catch {
            message(
              "读取版本失败；文件可能失效、已变化或编码不支持。当前内容保留。",
            );
          } finally {
            working = false;
          }
        };
        el("versions-list").append(button);
      }
    } catch {
      message("读取版本失败；文件可能失效、已变化或编码不支持。当前内容保留。");
    } finally {
      working = false;
    }
  };
  el("versions-close").onclick = () => {
    if (!working) dialog.close();
  };
  dialog.addEventListener("cancel", (e) => {
    if (working) e.preventDefault();
  });
  dialog.addEventListener("close", () => el("versions-open").focus());
  el("versions-apply").onclick = async () => {
    if (working || !snapshot || !loaded) return;
    working = true;
    try {
      const version = await invoke<Version>("read_version", {
        id: snapshot.id,
        revision: snapshot.revision,
        key: chosen,
        expected: loaded.hash,
      });
      if (!apply(snapshot, version.content)) throw Error("stale");
      dialog.close();
    } catch {
      message(
        "恢复失败；版本或当前文档已变化，请重新打开版本列表。当前内容保留。",
      );
    } finally {
      working = false;
    }
  };
}
