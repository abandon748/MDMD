import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";

type Registration = "absent" | "ready" | "partial" | "conflict" | "stale";
interface IntegrationView {
  association: Registration;
  menu: Registration;
  defaultApp: "current" | "other" | "unknown";
  executable: string;
}
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let view: IntegrationView | null = null;
let pending = false;
let message = "";
let returnFocus: HTMLElement | null = null;
const buttons = [
  "integration-set",
  "integration-remove",
  "integration-add-menu",
  "integration-remove-menu",
  "integration-default-settings",
  "integration-refresh",
];
const errors: Record<string, string> = {
  conflict:
    "现有 MDMD 配置与当前程序不一致，已保留原配置。请从原位置的 MDMD 解除后重试。",
  "choose-other":
    "请在 Windows 默认应用中为 .md 选择其他应用，返回后刷新，再点击解除关联。当前配置尚未移除。",
  "default-unknown":
    "无法确定 .md 的默认应用，已保留关联配置。请在 Windows 设置中选择其他应用后重试。",
  "settings-launch":
    "无法打开 Windows 默认应用设置。已写入的配置仍保留；请手动打开系统设置 → 应用 → 默认应用，搜索 .md。",
  "rollback-failed":
    "回滚未能确认完成。请刷新检查实际状态，保留当前程序位置，再重试或联系支持。",
};
function associationLabel() {
  if (!view) return t("未检测");
  if (view.association === "conflict") return t("配置冲突");
  if (view.association === "stale") return t("旧路径已失效");
  if (view.association === "partial") return t("配置不完整");
  if (view.association === "ready" && view.defaultApp === "current")
    return t("已关联");
  if (view.defaultApp === "unknown") return t("默认应用未知");
  return view.association === "ready" ? t("待系统选择") : t("未关联");
}
export function reflectIntegration() {
  const label = associationLabel();
  for (const id of [
    "home-association-status",
    "integration-association-status",
  ]) {
    el(id).textContent = label;
    el(id).classList.toggle(
      "integration-ready",
      view?.association === "ready" && view.defaultApp === "current",
    );
  }
  el("integration-menu-status").textContent = !view
    ? t("未检测")
    : view.menu === "ready"
      ? t("已安装")
      : view.menu === "partial"
        ? t("配置不完整")
        : view.menu === "stale"
          ? t("旧路径已失效")
          : view.menu === "conflict"
            ? t("配置冲突")
            : t("未安装");
  el("integration-menu-status").classList.toggle(
    "integration-ready",
    view?.menu === "ready",
  );
  el("integration-message").textContent = pending
    ? t("正在检查或更新系统配置…")
    : t(message);
  el("integration-executable").textContent = view?.executable ?? "";
  el("integration-set").textContent = t(
    view?.association === "stale" || view?.association === "partial"
      ? "修复关联并选择默认应用"
      : "在 Windows 中选择默认应用",
  );
  for (const id of buttons)
    el<HTMLButtonElement>(id).disabled =
      pending || (!view && id !== "integration-refresh");
  if (!pending && view) {
    el<HTMLButtonElement>("integration-remove").disabled =
      view.association === "absent";
    el<HTMLButtonElement>("integration-remove-menu").disabled =
      view.menu === "absent";
    el<HTMLButtonElement>("integration-add-menu").disabled =
      view.menu === "ready";
  }
  el("integration-dialog").setAttribute("aria-busy", String(pending));
}
async function run(action: string) {
  if (pending) return;
  pending = true;
  if (action !== "refresh") message = "";
  reflectIntegration();
  try {
    view = await invoke<IntegrationView>("system_integration", { action });
    if (action === "set-default" || action === "default-settings")
      message =
        "已打开 Windows 默认应用设置。点击 .md → 选择 MDMD → 确认设为默认；若打开的是设置首页，请搜索 .md。返回后自动检测，关闭或取消不会更改默认应用。";
    else if (action !== "refresh") message = "系统配置已更新，并已重新检测。";
  } catch (error) {
    const code = String(error);
    message =
      errors[code] ??
      "系统配置操作失败。未完成的写入已请求回滚，请刷新检查后重试。";
    if (action === "refresh") {
      view = null;
      message = "无法读取系统配置。请稍后刷新重试。";
    } else {
      try {
        view = await invoke<IntegrationView>("system_integration", {
          action: "refresh",
        });
      } catch {
        view = null;
      }
    }
  } finally {
    pending = false;
    reflectIntegration();
  }
}
export function setupIntegration(beforeOpen: () => void) {
  const dialog = el<HTMLDialogElement>("integration-dialog");
  const open = () => {
    beforeOpen();
    returnFocus = document.activeElement as HTMLElement;
    dialog.showModal();
    el("integration-close").focus();
    void run("refresh");
  };
  el("home-association-manage").onclick = open;
  el("integration-manage").onclick = open;
  el("integration-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => returnFocus?.focus());
  for (const [id, action] of Object.entries({
    "integration-set": "set-default",
    "integration-remove": "remove-association",
    "integration-add-menu": "add-menu",
    "integration-remove-menu": "remove-menu",
    "integration-default-settings": "default-settings",
    "integration-refresh": "refresh",
  }))
    el(id).onclick = () => void run(action);
  window.addEventListener("focus", () => void run("refresh"));
  void run("refresh");
}
