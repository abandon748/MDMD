import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { t } from "./i18n";
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const fields = ["problem", "steps", "expected", "actual"] as const;
const headings = ["问题描述", "复现步骤", "期望结果", "实际结果"];
let version = "",
  busy = false,
  message = "",
  savedPath = "";
let projectUrl = "",
  projectLoading = false,
  projectBusy = false,
  projectMessage = "";
function reflectProject() {
  el("project-url").textContent = projectUrl;
  for (const id of ["project-open", "project-copy"])
    el<HTMLButtonElement>(id).disabled = !projectUrl || projectBusy;
  el("project-message").textContent = t(projectMessage);
  el("project-message").hidden = !projectMessage;
}
function report() {
  const parts = [`# MDMD ${t("问题反馈")}`, `${t("应用版本")}：${version}`];
  fields.forEach((key, i) => {
    const text = el<HTMLTextAreaElement>(`feedback-${key}`).value.trim();
    if (text) parts.push(`## ${t(headings[i])}\n\n${text}`);
  });
  if (el<HTMLInputElement>("feedback-environment").checked)
    parts.push(
      `## ${t("浏览器环境")}\n\n${navigator.userAgent}\n\n${navigator.language}`,
    );
  return parts.join("\n\n") + "\n";
}
export function reflectFeedback() {
  if (!projectUrl && !projectLoading) {
    projectLoading = true;
    void invoke<string>("project_repository", { open: false })
      .then((url) => {
        projectUrl = url;
        projectMessage = "";
      })
      .catch(() => {
        projectMessage = "项目链接加载失败，请关闭设置后重新打开。";
      })
      .finally(() => {
        projectLoading = false;
        reflectProject();
      });
  }
  reflectProject();
  el<HTMLTextAreaElement>("feedback-preview").value = report();
  for (const node of document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >(
    "#settings-feedback-content input, #settings-feedback-content textarea:not([readonly])",
  ))
    node.disabled = busy;
  const valid =
    !!version && !!el<HTMLTextAreaElement>("feedback-problem").value.trim();
  for (const id of ["feedback-copy", "feedback-export"])
    el<HTMLButtonElement>(id).disabled = busy || !valid;
  el<HTMLButtonElement>("feedback-clear").disabled = busy;
  el("feedback-message").textContent = t(message, savedPath ? [savedPath] : []);
}
export function setupFeedback() {
  for (const action of ["open", "copy"] as const)
    el(`project-${action}`).onclick = async () => {
      if (projectBusy || !projectUrl) return;
      projectBusy = true;
      projectMessage = "";
      reflectProject();
      try {
        if (action === "open") {
          await invoke<string>("project_repository", { open: true });
          projectMessage =
            "已请求系统浏览器打开项目主页；如未打开，可复制链接自行访问。";
        } else {
          await navigator.clipboard.writeText(projectUrl);
          projectMessage = "项目链接已复制。";
        }
      } catch {
        projectMessage =
          action === "open"
            ? "无法打开浏览器，请复制链接后自行访问。"
            : "复制失败，可选中页面中的地址手动复制。";
      } finally {
        projectBusy = false;
        reflectProject();
      }
    };
  void getVersion()
    .then((v) => {
      version = v;
      reflectFeedback();
    })
    .catch(() => {
      version = t("版本不可用");
      reflectFeedback();
    });
  for (const key of fields)
    el(`feedback-${key}`).oninput = () => {
      message = "";
      savedPath = "";
      reflectFeedback();
    };
  el("feedback-environment").onchange = () => {
    message = "";
    reflectFeedback();
  };
  el("feedback-clear").onclick = () => {
    for (const key of fields)
      el<HTMLTextAreaElement>(`feedback-${key}`).value = "";
    el<HTMLInputElement>("feedback-environment").checked = false;
    message = "反馈草稿已清空。";
    savedPath = "";
    reflectFeedback();
    el("feedback-problem").focus();
  };
  el("feedback-copy").onclick = async () => {
    const text = report();
    busy = true;
    message = "";
    reflectFeedback();
    try {
      await navigator.clipboard.writeText(text);
      message = "反馈内容已复制，请自行发送。";
    } catch {
      message = "复制失败，请重试或导出反馈文件。";
    } finally {
      busy = false;
      reflectFeedback();
      el("feedback-message").scrollIntoView({ block: "nearest" });
    }
  };
  el("feedback-export").onclick = async () => {
    const text = report();
    busy = true;
    message = "";
    savedPath = "";
    reflectFeedback();
    try {
      const path = await invoke<string | null>("export_feedback", { text });
      if (path) {
        savedPath = path;
        message = "反馈已导出：{0}";
      } else message = "已取消导出，反馈草稿保留。";
    } catch (error) {
      const code = String(error);
      message =
        code === "feedback-exists"
          ? "同名文件或目录已存在，未覆盖。请重新选择名称。"
          : code === "feedback-extension"
            ? "反馈文件仅支持 .md 扩展名。"
            : code === "feedback-invalid"
              ? "反馈内容为空、过长或含无效字符。"
              : "反馈导出失败，请检查目录权限后重试；草稿已保留。";
    } finally {
      busy = false;
      reflectFeedback();
      el("feedback-message").scrollIntoView({ block: "nearest" });
    }
  };
  reflectFeedback();
}
