import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
interface IconView {
  custom: boolean;
  preview: string;
  warning: string | null;
  canChange: boolean;
  canReset: boolean;
  cancelled: boolean;
  shortcuts: number;
}
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let state: IconView | null = null;
let pending = false;
let message = "";
const messages: Record<string, string> = {
  busy: "图标操作正被其他窗口使用，请稍后重试。",
  "icon-format":
    "请选择有效的 ICO：1–32 个方形图层，每层 16–256 像素。暂不支持 PNG、JPG 或 SVG。",
  "icon-size": "图标文件不能超过 2 MiB。",
  "icon-read": "无法读取图标文件，请检查文件是否存在及读取权限。",
  "icon-write": "图标未能保存，已尝试恢复原设置。请检查数据目录权限后重试。",
  "icon-window": "无法更新窗口图标，已尝试恢复原设置。",
  "icon-shortcut":
    "无法更新匹配的快捷方式，已尝试恢复原设置。请检查快捷方式的写入权限。",
  "icon-conflict":
    "已有系统图标配置不属于当前 MDMD，已保留。请先处理系统集成中的配置冲突。",
  "icon-record": "图标设置损坏。可恢复默认；原记录会另存备份。",
  "icon-future": "图标设置来自更高版本，当前版本不会覆盖。请使用对应版本处理。",
  "icon-missing": "保存的图标丢失或损坏。当前显示默认预览，请恢复默认后重试。",
  "icon-pending":
    "上次图标操作未完成。请恢复默认以重新统一窗口、关联和快捷方式图标。",
  "icon-recover": "请先恢复默认，再选择新图标。",
  "icon-rollback": "部分图标未能恢复。请保留程序位置，检查权限后点击恢复默认。",
  "icon-link-conflict": "快捷方式在操作期间发生变化，已停止更新并尝试恢复。",
  "icon-record-conflict": "图标设置已被其他实例修改，请重启后重试。",
  "icon-scan-limit":
    "快捷方式目录过大，已停止更新。请减少目录层级或文件数量后重试。",
  "icon-limit":
    "已保存的图标达到 100 个，本轮未应用新图标。请保留仍被快捷方式使用的文件。",
};
export function reflectAppIcon() {
  el<HTMLButtonElement>("app-icon-change").disabled =
    pending || !state?.canChange;
  el<HTMLButtonElement>("app-icon-reset").disabled =
    pending || !state?.canReset;
  el("app-icon-state").textContent = state?.custom ? t("自定义") : t("默认");
  el("app-icon-message").textContent = pending
    ? t("正在应用图标…")
    : t(messages[state?.warning ?? ""] ?? message);
  if (state) {
    el<HTMLImageElement>("app-icon-preview").src = state.preview;
    el<HTMLImageElement>("home-app-icon").src = state.preview;
    el<HTMLImageElement>("document-app-icon").src = state.preview;
  }
}
async function run(action: string) {
  if (pending) return;
  pending = true;
  reflectAppIcon();
  try {
    state = await invoke<IconView>("application_icon", { action });
    if (action !== "refresh")
      message = state.cancelled
        ? "已取消，图标未更改。"
        : "图标已应用并保存。系统缓存可能稍后刷新。";
  } catch (error) {
    message = messages[String(error)] ?? "图标操作失败，请检查权限后重试。";
    try {
      state = await invoke<IconView>("application_icon", { action: "refresh" });
    } catch {
      state = null;
    }
  } finally {
    pending = false;
    reflectAppIcon();
  }
}
export function setupAppIcon() {
  el("app-icon-change").onclick = () => void run("choose");
  el("app-icon-reset").onclick = () => void run("reset");
  window.addEventListener("focus", () => void run("refresh"));
  void run("refresh");
}
