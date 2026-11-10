import { canEditRich, setupRichEditor, richCaretOffset } from "./rich-edit";
import { previewTools, remoteImage } from "./preview-tools";
import { setupSidebarResize } from "./sidebar-resize";
import { setupPreviewSearch } from "./preview-search";
import { installExtensions } from "./extensions";
import { renderEmbeds } from "./embeds";
import { installTasks, taskChange } from "./tasks";
import { setupVersions } from "./versions";
import { setupOutput } from "./output";
import { setupFlowEditor } from "./flow-edit";
import {
  renderDiagrams,
  stopDiagrams,
  resetDiagrams,
  previewText,
} from "./diagrams";
import { installMath } from "./math-rules";
import { renderMath, stopMath, resetMath } from "./math";
import { syntaxHighlight, resetSyntax, stopSyntax } from "./syntax";
import { previewTarget } from "./link-preview.ts";
import {
  formatActions,
  formatEdit,
  installHighlight,
  type FormatAction,
} from "./format-edit";
import {
  snippets,
  snippetRange,
  snippetText,
  snippetEdit,
  type Snippet,
} from "./snippets";
import {
  blockRange,
  blockReplacement,
  codeSourcePosition,
} from "./inline-edit";
import { newTable, parseTable, tableInsertionPosition } from "./table-model";
import { setupTableEditor } from "./table-edit";
import { setupFeedback, reflectFeedback } from "./feedback";
import { setupEngines, reflectEngines } from "./engines";
import { createLinkPreview } from "./link-preview";
import { setupIntegration, reflectIntegration } from "./integration";
import { setupAppIcon, reflectAppIcon } from "./app-icon";
import {
  t,
  getLocale,
  setLocale,
  validLanguage,
  bindStaticTranslations,
  type Language,
  type Locale,
} from "./i18n.ts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  indentWithTab,
  undo,
  redo,
  isolateHistory,
} from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import {
  clearOutline,
  renderOutline,
  followOutline,
  refreshOutlineLanguage,
} from "./outline";

import {
  actions,
  schemes,
  presets,
  bindings,
  defaultShortcuts,
  validShortcuts,
  bindingError,
  eventCombination,
  managedDefaults,
  type Action,
  type Scheme,
  type Shortcuts,
} from "./shortcuts";

import {
  colorLabels,
  colorKeys,
  defaultColors,
  defaultAppearance,
  appearanceError,
  type Appearance,
} from "./appearance";

import {
  defaultCustomCss,
  validCustomCss,
  compileCustomCss,
  type CustomCss,
} from "./custom-css";

interface Snapshot {
  id: string;
  path: string | null;
  name: string;
  content: string;
  revision: number;
  dirty: boolean;
  bom: boolean;
  eol: string;
  readOnly: boolean;
  readOnlyReason: string;
  external: boolean;
  backupPath: string | null;
}
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const preview = el("preview"),
  previewScroll = el("preview-scroll");
const previewSearch = setupPreviewSearch(preview);
const readonly = new Compartment();
const editorLanguage = new Compartment();
const applyStaticLanguage = bindStaticTranslations(document.body);
let language: Language = "system";
let languagePending = false;
let current: Snapshot;
let editor: EditorView;
let renderedSource: string | null = null;
let inline: {
  view: EditorView;
  host: HTMLElement;
  source: string;
  id: string;
  from: number;
  to: number;
  original: string;
  table?: ReturnType<typeof setupTableEditor>;
  rich?: ReturnType<typeof setupRichEditor>;
} | null = null;
let inlineTarget: HTMLElement | null = null;
let inlinePoint: {
  id: string;
  source: string | null;
  line: string | undefined;
  offset: number;
  anchor?: number | null;
  codeOffset: number | null;
  codeAnchor?: number | null;
} | null = null;
function rememberInlinePoint(target: HTMLElement | null) {
  if (!target) return;
  const offset = richCaretOffset(target);
  if (offset !== null)
    inlinePoint = {
      id: current.id,
      source: renderedSource,
      line: target.dataset.line,
      offset,
      anchor: richCaretOffset(target, "anchor"),
      codeAnchor:
        target.tagName === "PRE" && target.querySelector("code")
          ? richCaretOffset(
              target.querySelector<HTMLElement>("code")!,
              "anchor",
            )
          : null,
      codeOffset:
        target.tagName === "PRE" && target.querySelector("code")
          ? richCaretOffset(target.querySelector<HTMLElement>("code")!)
          : null,
    };
}
const inlineDirty = () =>
  !!inline && inline.view.state.doc.toString() !== inline.original;
let homeVisible = true;
interface Folder {
  displayPath: string;
  displayRoot: string;
  canGoUp: boolean;
  directories: string[];
  files: string[];
  empty: boolean;
}
interface HistoryView {
  entries: { path: string; openedAt: number; error: string | null }[];
  warning: string | null;
  canRetry: boolean;
}
type FavoriteKind = "file" | "folder";
interface FavoriteEntry {
  kind: FavoriteKind;
  path: string;
  addedAt: number;
  error?: string;
}
interface FavoritesView {
  entries: FavoriteEntry[];
  warning: string | null;
  blocked: boolean;
}
let favorites: FavoritesView = { entries: [], warning: null, blocked: false };
let collectionTitle = "历史记录";
let history: HistoryView = { entries: [], warning: null, canRetry: false };
let folder: Folder | null = null;
let folderWaiting = false;
let busy = true,
  reading = false,
  syncError = "",
  generation = 0;
// User-selected inline mode outlives an individual block draft. Temporary
// actions (table/diagram tools, opt-in double-click) do not select this mode.
let inlineSelected = false;
let acknowledgedRevision = 0;
let saveError = "",
  diskError = "";
let saving = false,
  checkingDisk = false,
  diskEpoch = 0;
let pending = Promise.resolve(),
  renderTimer = 0,
  scrollLock = 0;
const settingsKey = "mdmd.settings";
let showWordCount = true;
let showLinkPreview = true;
let doubleClickEdit = false;
let taskStrike = true;
let reloadMessage = "";
let reloadNoticeTimer = 0;
let autoSave = false,
  autoPaused = false,
  autoDue = 0;
const autoDelay = 1000;
function deferAutoSave() {
  autoDue = performance.now() + autoDelay;
}
function reflectAutoSave() {
  if (!current) return;
  // Fail closed for this session, even if a later disk poll happens to succeed.
  if (autoSave && (current.external || diskError || syncError || saveError))
    autoPaused = true;
  el("autosave-status").textContent = !autoSave
    ? ""
    : autoPaused
      ? t("自动保存已暂停 · 请手动保存或重载")
      : !current.path
        ? t("自动保存等待首次手动保存")
        : inline
          ? t("自动保存等待应用草稿")
          : t("自动保存已开启");
  el("autosave-status").dataset.paused = String(autoPaused);
}
function tryAutoSave() {
  if (
    !autoSave ||
    !current ||
    !editor ||
    !autoDue ||
    autoPaused ||
    busy ||
    homeVisible ||
    folderWaiting ||
    !current.path ||
    !current.dirty ||
    current.readOnly ||
    current.external ||
    syncError ||
    diskError ||
    saveError ||
    inline ||
    editor.compositionStarted ||
    document.hidden ||
    document.querySelector("dialog[open]")
  )
    return;
  if (performance.now() < autoDue) return;
  autoDue = 0;
  void command("save", undefined, true);
}
const linkPreview = createLinkPreview(preview, () =>
  current &&
  !busy &&
  !homeVisible &&
  !folderWaiting &&
  !document.querySelector("dialog[open]")
    ? current
    : null,
);
type TitleFormat = "path" | "name";
let titleFormat: TitleFormat = "path";
let titleFormatPending = false;
let fullCount: number | null = null;
let statisticsFrame = 0;
function countText(text: string) {
  let count = 0;
  for (const point of text) if (!/\s/u.test(point)) count++;
  return count;
}
function scheduleStatistics() {
  if (statisticsFrame) return;
  statisticsFrame = requestAnimationFrame(() => {
    statisticsFrame = 0;
    if (!editor) return;
    const output = el("wordcount");
    const total = fullCount === null ? t("待刷新") : fullCount.toLocaleString();
    let selected: number | null = null;
    let source = false;
    if (
      !homeVisible &&
      !folderWaiting &&
      !document.querySelector("dialog[open]")
    ) {
      if (inline?.view.hasFocus || (!reading && editor.hasFocus)) {
        const active = inline?.view.hasFocus ? inline.view : editor;
        const ranges = active.state.selection.ranges.filter((r) => !r.empty);
        if (ranges.length) {
          source = true;
          selected = ranges.reduce(
            (sum, r) =>
              sum + countText(active.state.doc.sliceString(r.from, r.to)),
            0,
          );
        }
      } else if (
        fullCount !== null &&
        current.content &&
        (document.activeElement === document.body ||
          preview.contains(document.activeElement))
      ) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.rangeCount === 1) {
          const range = selection.getRangeAt(0);
          if (
            preview.contains(range.startContainer) &&
            preview.contains(range.endContainer)
          )
            selected = countText(previewText(range.cloneContents()));
        }
      }
    }
    output.textContent =
      selected === null
        ? t("字数 {0}", [total])
        : t("{0} {1} · 全文 {2}", [
            source ? t("源码选中") : t("选中"),
            selected.toLocaleString(),
            total,
          ]);
    output.title = t(
      "全文与预览选区：渲染文本的非空白 Unicode 码点数，含标点和代码，不含图片替代文字或显示行号。源码选区：所选原文，含 Markdown 标记。",
    );
  });
}
type Theme = "system" | "light" | "dark";
let theme: Theme = "system";
let appearance = defaultAppearance();
let paletteDraft: Appearance;
let customCss = defaultCustomCss();
let customCssCompiled = "";
const customCssStyle = document.createElement("style");
customCssStyle.id = "custom-css-style";
document.head.append(customCssStyle);
function reflectCustomCss() {
  el<HTMLInputElement>("setting-custom-css").checked = customCss.enabled;
  el<HTMLInputElement>("setting-custom-css").disabled = settingsBlocked;
  el<HTMLButtonElement>("css-edit").disabled = settingsBlocked;
  const output = customCss.enabled ? customCssCompiled : "";
  if (customCssStyle.textContent !== output)
    customCssStyle.textContent = output;
  document.documentElement.classList.toggle("custom-css-active", !!output);
}
let settingsBlocked = false;
let shortcuts = defaultShortcuts();
let recording: Action | null = null;
const toolbarDefaults = {
  modes: true,
  external: true,
  format: true,
  insert: true,
};
let toolbarVisibility = { ...toolbarDefaults };
let focusMode = false;
function setFocusMode(value: boolean) {
  focusMode = value;
  document.body.classList.toggle("focus-mode", value);
  el("focus-exit-zone").hidden = !value;
  el("focus-toggle").setAttribute("aria-pressed", String(value));
  if (value) {
    if (!reading) editor.focus();
    else {
      previewScroll.tabIndex = -1;
      previewScroll.focus({ preventScroll: true });
    }
  } else el("focus-toggle").focus({ preventScroll: true });
  editor?.requestMeasure();
}
const navigationDefaults = { history: true, favorites: true, files: true };
let navigation = { ...navigationDefaults };
type SidebarView = boolean | "history" | "favorites";
let sidebarView: SidebarView = false;
function sidebarVisible(view: SidebarView) {
  return view === false || navigation[view === true ? "files" : view];
}
function reflectNavigation() {
  for (const key of ["history", "favorites", "files"] as const) {
    const checkbox = el<HTMLInputElement>(`setting-${key}`);
    checkbox.checked = navigation[key];
    checkbox.disabled = settingsBlocked;
    el(`tab-${key}`).hidden = !navigation[key];
  }
  el("home-history").hidden = !navigation.history;
  el("home-favorites").hidden = !navigation.favorites;
  if (!sidebarVisible(sidebarView)) {
    if (folderWaiting) showHome(true);
    else showSidebar(false);
  }
  if (current && editor) status();
}
function requireFiles() {
  if (navigation.files) return true;
  openSettings();
  el("settings-general").click();
  settingsMessage(t("文件栏已隐藏，请先开启“文件”以浏览文件夹。"));
  return false;
}
const typographyDefaults = {
  bodyFont: "",
  codeFont: "",
  fontScale: 100,
  columnWidth: 900,
  outlineFontScale: 100,
  outlineArrowScale: 100,
  outlineGap: 20,
  swapPanes: false,
  softBreaks: true,
  codeLineNumbers: false,
  codeWrap: false,
};
type Typography = typeof typographyDefaults;
let typography: Typography = { ...typographyDefaults };
const bodyFallback = '"Segoe UI", "Microsoft YaHei UI", sans-serif';
const codeFallback = 'Consolas, "Cascadia Code", monospace';
const typographySteps = {
  fontScale: { min: 75, max: 200, step: 5, unit: "%" },
  columnWidth: { min: 450, max: 1600, step: 50, unit: "px" },
  outlineFontScale: { min: 75, max: 200, step: 5, unit: "%" },
  outlineArrowScale: { min: 75, max: 150, step: 5, unit: "%" },
  outlineGap: { min: 0, max: 80, step: 5, unit: "px" },
};
const typographyStepKeys = Object.keys(
  typographySteps,
) as (keyof typeof typographySteps)[];
function validFont(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    value === value.trim() &&
    !/[\x00-\x1f\x7f"'\\,;{}<>]/.test(value)
  );
}
function validTypography(value: unknown): value is Typography {
  if (!value || typeof value !== "object") return false;
  const t = value as Typography;
  return (
    validFont(t.bodyFont) &&
    validFont(t.codeFont) &&
    typeof t.codeLineNumbers === "boolean" &&
    typeof t.codeWrap === "boolean" &&
    typeof t.swapPanes === "boolean" &&
    typeof t.softBreaks === "boolean" &&
    typographyStepKeys.every((key) => {
      const { min, max, step } = typographySteps[key];
      return (
        Number.isInteger(t[key]) &&
        t[key] >= min &&
        t[key] <= max &&
        t[key] % step === 0
      );
    })
  );
}
function fontFamily(name: string, fallback: string) {
  return name ? `${JSON.stringify(name)}, ${fallback}` : fallback;
}
function reflectSplit() {
  const divider = el("divider");
  divider.setAttribute(
    "aria-valuetext",
    t("编辑区 {0}%（{1}）", [
      divider.getAttribute("aria-valuenow"),
      typography.swapPanes ? t("右侧") : t("左侧"),
    ]),
  );
  editor?.requestMeasure();
}
function reflectTypography() {
  const top = previewScroll.scrollTop;
  el("panes").classList.toggle("swapped", typography.swapPanes);
  reflectSplit();
  const style = el("document-view").style;
  style.setProperty(
    "--outline-font-scale",
    String(typography.outlineFontScale / 100),
  );
  style.setProperty(
    "--outline-arrow-scale",
    String(typography.outlineArrowScale / 100),
  );
  style.setProperty("--outline-gap", `${typography.outlineGap}px`);
  preview.style.setProperty(
    "--body-font",
    fontFamily(typography.bodyFont, bodyFallback),
  );
  preview.style.setProperty(
    "--code-font",
    fontFamily(typography.codeFont, codeFallback),
  );
  preview.style.setProperty(
    "--reading-scale",
    String(typography.fontScale / 100),
  );
  preview.style.setProperty("--column-width", `${typography.columnWidth}px`);
  preview.classList.toggle("code-numbered", typography.codeLineNumbers);
  for (const button of preview.querySelectorAll<HTMLButtonElement>(
    "[data-code-numbers]",
  )) {
    const pre = button.closest(".preview-tools")
      ?.nextElementSibling as HTMLElement | null;
    button.setAttribute(
      "aria-pressed",
      pre?.dataset.lineNumbers ?? String(typography.codeLineNumbers),
    );
  }
  preview.classList.toggle("code-wrap", typography.codeWrap);
  for (const key of ["bodyFont", "codeFont"] as const) {
    el(`value-${key}`).textContent =
      typography[key] ||
      (key === "bodyFont" ? t("默认（系统字体）") : t("默认（等宽字体）"));
  }
  for (const key of [
    "codeLineNumbers",
    "codeWrap",
    "swapPanes",
    "softBreaks",
  ] as const)
    el<HTMLInputElement>(`setting-${key}`).checked = typography[key];
  for (const key of typographyStepKeys)
    el(`value-${key}`).textContent =
      `${typography[key]}${typographySteps[key].unit}`;
  for (const control of el("settings-typography-content").querySelectorAll<
    HTMLInputElement | HTMLButtonElement
  >("input,button")) {
    const key = control.dataset.step as
      keyof typeof typographySteps | undefined;
    const direction = Number(control.dataset.direction);
    control.disabled =
      settingsBlocked ||
      !!(
        key &&
        (direction < 0
          ? typography[key] <= typographySteps[key].min
          : typography[key] >= typographySteps[key].max)
      );
  }
  previewScroll.scrollTop = top;
}
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const editorAppearance = new Compartment();
const darkSyntaxColors: Record<string, string> = {
  "#404740": "#bbc5d3",
  "#708": "#d9a8ff",
  "#219": "#b7b3ff",
  "#164": "#99d9b1",
  "#a11": "#ffadad",
  "#e40": "#ffc38c",
  "#00f": "#9fc8ff",
  "#30a": "#c6b2ff",
  "#085": "#8ddbc3",
  "#167": "#91d5e8",
  "#256": "#a4d5e3",
  "#00c": "#a9c6ff",
  "#940": "#d7bc90",
  "#f00": "#ff9999",
};
const darkHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) =>
    spec.color
      ? { ...spec, color: darkSyntaxColors[String(spec.color)] || "#d4deed" }
      : spec,
  ),
);
function isDark() {
  return theme === "dark" || (theme === "system" && systemTheme.matches);
}
function editorTheme() {
  const dark = isDark();
  return [
    EditorView.theme({}, { dark }),
    syntaxHighlighting(dark ? darkHighlightStyle : defaultHighlightStyle),
  ];
}
function applyAppearance() {
  const mode = isDark() ? "dark" : "light";
  const palette = appearance.custom.find((p) => p.id === appearance.palette);
  for (const key of colorKeys) {
    if (palette)
      document.documentElement.style.setProperty(
        `--${key}`,
        palette[mode][key],
      );
    else document.documentElement.style.removeProperty(`--${key}`);
    // Keep settings readable even if a custom palette has low contrast.
    for (const id of [
      "settings-dialog",
      "palette-dialog",
      "css-dialog",
      "integration-dialog",
      "engines-dialog",
    ])
      el(id).style.setProperty(`--${key}`, defaultColors[mode][key]);
  }
  document.documentElement.style.setProperty(
    "--content-radius",
    appearance.corners === "rounded" ? "8px" : "0px",
  );
}
function paletteOptions(select: HTMLSelectElement, value: Appearance) {
  select.replaceChildren(
    new Option(t("默认"), "default"),
    ...value.custom.map((p) => new Option(p.name, p.id)),
  );
  select.value = value.palette;
}
function reflectAppearance() {
  paletteOptions(el<HTMLSelectElement>("setting-palette"), appearance);
  el<HTMLSelectElement>("setting-corners").value = appearance.corners;
  for (const id of ["setting-palette", "palette-manage", "setting-corners"])
    (el(id) as HTMLInputElement).disabled = settingsBlocked;
}
function showPaletteDraft() {
  paletteOptions(el<HTMLSelectElement>("palette-select"), paletteDraft);
  const selected = paletteDraft.custom.find(
    (p) => p.id === paletteDraft.palette,
  );
  const name = el<HTMLInputElement>("palette-name");
  name.value = selected?.name || t("默认");
  name.disabled = !selected;
  el<HTMLButtonElement>("palette-delete").disabled = !selected;
  el<HTMLButtonElement>("palette-copy").disabled =
    paletteDraft.custom.length >= 20;
  const fields = el("palette-fields");
  fields.replaceChildren();
  for (const mode of ["light", "dark"] as const) {
    const group = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = mode === "light" ? t("浅色") : t("深色");
    group.append(legend);
    for (const key of colorKeys) {
      const label = document.createElement("label");
      label.textContent = t(colorLabels[key]);
      const input = document.createElement("input");
      input.type = "color";
      input.id = `palette-${mode}-${key}`;
      input.setAttribute(
        "aria-label",
        `${legend.textContent} · ${t(colorLabels[key])}`,
      );
      input.value = (selected || defaultColors)[mode][key];
      input.disabled = !selected;
      input.oninput = () => {
        if (selected) selected[mode][key] = input.value;
      };
      label.append(input);
      group.append(label);
    }
    fields.append(group);
  }
  el("palette-message").textContent = "";
}
function applyTheme() {
  document.documentElement.dataset.theme = isDark() ? "dark" : "light";
  applyAppearance();
  if (editor)
    editor.dispatch({ effects: editorAppearance.reconfigure(editorTheme()) });
  if (inline)
    inline.view.dispatch({ effects: inlineTheme.reconfigure(editorTheme()) });
}
function reflectSettings() {
  preview.classList.toggle("task-strike", taskStrike);
  el<HTMLInputElement>("setting-task-strike").checked = taskStrike;
  el<HTMLInputElement>("setting-task-strike").disabled = settingsBlocked;
  el<HTMLInputElement>("setting-double-click-edit").checked = doubleClickEdit;
  el<HTMLInputElement>("setting-double-click-edit").disabled = settingsBlocked;
  for (const key of Object.keys(
    toolbarDefaults,
  ) as (keyof typeof toolbarDefaults)[]) {
    const checkbox = el<HTMLInputElement>(`setting-tools-${key}`);
    checkbox.checked = toolbarVisibility[key];
    checkbox.disabled = settingsBlocked;
    document
      .querySelectorAll<HTMLElement>(`[data-toolbar-group="${key}"]`)
      .forEach((node) => (node.hidden = !toolbarVisibility[key]));
  }
  el<HTMLInputElement>("setting-autosave").checked = autoSave;
  el("save").classList.toggle("auto-save-enabled", autoSave);
  el<HTMLInputElement>("setting-autosave").disabled = settingsBlocked;
  reflectAutoSave();
  el<HTMLInputElement>("setting-link-preview").checked = showLinkPreview;
  el<HTMLInputElement>("setting-link-preview").disabled = settingsBlocked;
  linkPreview.setEnabled(showLinkPreview);
  el<HTMLSelectElement>("setting-language").value = language;
  el<HTMLSelectElement>("setting-language").disabled =
    settingsBlocked || languagePending;
  el<HTMLSelectElement>("setting-title-format").value = titleFormat;
  el<HTMLSelectElement>("setting-title-format").disabled =
    settingsBlocked || titleFormatPending;
  el<HTMLInputElement>("setting-wordcount").checked = showWordCount;
  el("wordcount").hidden = !showWordCount;
  scheduleStatistics();
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    'input[name="theme"]',
  )) {
    radio.checked = radio.value === theme;
    radio.disabled = settingsBlocked;
  }
  el<HTMLInputElement>("setting-wordcount").disabled = settingsBlocked;
  reflectTypography();
  reflectAppearance();
  reflectCustomCss();
  reflectNavigation();
  applyTheme();
  reflectShortcuts();
}
function saveSettings(
  nextTheme: Theme,
  nextWordCount: boolean,
  nextTypography = typography,
  nextNavigation = navigation,
  nextShortcuts = shortcuts,
  nextAppearance = appearance,
  nextCustomCss = customCss,
  nextTitleFormat = titleFormat,
  nextLanguage = language,
  nextLinkPreview = showLinkPreview,
  nextAutoSave = autoSave,
  nextToolbar = toolbarVisibility,
  nextDoubleClickEdit = doubleClickEdit,
  nextTaskStrike = taskStrike,
): boolean {
  const breaksChanged = nextTypography.softBreaks !== typography.softBreaks;
  if (settingsBlocked) {
    reflectSettings();
    return false;
  }
  let compiled = customCssCompiled;
  if (nextCustomCss !== customCss) {
    try {
      if (!validCustomCss(nextCustomCss))
        throw new Error(t("CSS 设置格式无效或超过长度限制。"));
      // Turning off is always available, including recovery from invalid saved CSS.
      if (nextCustomCss.enabled || nextCustomCss.source !== customCss.source)
        compiled = compileCustomCss(nextCustomCss.source);
    } catch (error) {
      settingsMessage(t("CSS 未应用：{0}", [String(error)]), true);
      reflectSettings();
      return false;
    }
  }
  try {
    localStorage.setItem(
      settingsKey,
      JSON.stringify({
        schemaVersion: 16,
        taskStrike: nextTaskStrike,
        doubleClickEdit: nextDoubleClickEdit,
        toolbarVisibility: nextToolbar,
        autoSave: nextAutoSave,
        linkPreview: nextLinkPreview,
        language: nextLanguage,
        titleFormat: nextTitleFormat,
        showWordCount: nextWordCount,
        theme: nextTheme,
        typography: nextTypography,
        navigation: nextNavigation,
        shortcuts: nextShortcuts,
        appearance: nextAppearance,
        customCss: nextCustomCss,
      }),
    );
    if (autoSave !== nextAutoSave) deferAutoSave();
    autoSave = nextAutoSave;
    doubleClickEdit = nextDoubleClickEdit;
    taskStrike = nextTaskStrike;
    toolbarVisibility = { ...nextToolbar };
    titleFormat = nextTitleFormat;
    language = nextLanguage;
    showLinkPreview = nextLinkPreview;
    theme = nextTheme;
    showWordCount = nextWordCount;
    typography = { ...nextTypography };
    navigation = { ...nextNavigation };
    shortcuts = structuredClone(nextShortcuts);
    appearance = structuredClone(nextAppearance);
    customCss = { ...nextCustomCss };
    customCssCompiled = compiled;
    settingsMessage(t("已保存"));
  } catch {
    settingsMessage(
      t("设置保存失败，已保留原值。请检查可用空间或存储权限后重试。"),
      true,
    );
    reflectSettings();
    return false;
  }
  reflectSettings();
  if (breaksChanged && current && !homeVisible && !folderWaiting) {
    fullCount = null;
    generation++;
    if (current.content.length <= 1024 * 1024) {
      const top = previewScroll.scrollTop;
      renderPreview();
      previewScroll.scrollTop = top;
      followOutline();
    } else schedulePreview();
    scheduleStatistics();
  }
  return true;
}
let settingsReturnFocus: HTMLElement | null = null;
function reflectShortcuts() {
  const active = bindings(shortcuts);
  const welcome = preview.querySelector("#welcome-shortcuts");
  if (welcome) {
    welcome.replaceChildren();
    for (const action of ["open", "save", "split"] as const) {
      const line = document.createElement("span");
      line.textContent = `${active[action]} ${t(actions[action])}`;
      welcome.append(line, document.createElement("br"));
    }
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-scheme]",
  )) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.scheme === shortcuts.scheme),
    );
    button.disabled = settingsBlocked;
  }
  for (const action of Object.keys(actions) as Action[]) {
    const label = active[action] || t("未绑定");
    const button = document.getElementById(
      `shortcut-${action}`,
    ) as HTMLButtonElement | null;
    if (button) {
      button.disabled = settingsBlocked;
      button.setAttribute("aria-pressed", String(recording === action));
      button.setAttribute(
        "aria-label",
        t("{0}：{1}，点击修改", [t(actions[action]), label]),
      );
      button.replaceChildren();
      for (const key of label.split("+")) {
        const cap = document.createElement("kbd");
        cap.textContent = key;
        button.append(cap);
      }
      button.title = t("方案默认：{0}{1}", [
        presets[shortcuts.scheme][action] || t("未绑定"),
        shortcuts.overrides[shortcuts.scheme][action] ? t("；已自定义") : "",
      ]);
    }
  }
  const hints: Partial<Record<Action, string[]>> = {
    open: ["home-open", "open"],
    new: ["home-new", "new"],
    save: ["save"],
    saveAs: ["save-as"],
    find: ["find"],
    split: ["split-mode", "read-mode"],
    external: ["external-edit"],
    inline: ["inline-mode", "menu-inline"],
    table: ["insert-table"],
    refresh: ["refresh"],
    settings: ["home-settings", "document-settings"],
  };
  for (const [id, targets] of Object.entries(hints)) {
    const action = id as Action;
    for (const target of targets) {
      const node = el(target);
      node.title = `${t(actions[action])} · ${active[action]}`;
      node.setAttribute(
        "aria-keyshortcuts",
        active[action].replace("Ctrl", "Control"),
      );
      const cap = node.querySelector("kbd");
      if (cap) cap.textContent = active[action].split("+").join(" + ");
    }
  }
}
function cancelRecording() {
  recording = null;
  el("shortcut-message").textContent = "";
  reflectShortcuts();
}
function initShortcuts() {
  el("shortcut-list").replaceChildren();
  for (const action of Object.keys(actions) as Action[]) {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    const name = document.createElement("span");
    name.textContent = t(actions[action]);
    const button = document.createElement("button");
    button.id = `shortcut-${action}`;
    button.setAttribute("aria-describedby", "shortcut-message");
    button.onclick = () => {
      recording = action;
      el("shortcut-message").textContent = t(
        "正在修改“{0}”：请按组合键，Esc 取消，Backspace 恢复默认。",
        [t(actions[action])],
      );
      reflectShortcuts();
    };
    row.append(name, button);
    el("shortcut-list").append(row);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-scheme]",
  )) {
    button.onclick = () => {
      cancelRecording();
      saveSettings(theme, showWordCount, typography, navigation, {
        ...shortcuts,
        scheme: button.dataset.scheme as Scheme,
      });
    };
  }
  reflectShortcuts();
}
function handleShortcut(event: KeyboardEvent) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState("AltGraph")
  )
    return;
  const stop = () => {
    event.preventDefault();
    event.stopPropagation();
  };
  if (recording) {
    if (event.key === "Tab") {
      cancelRecording();
      return;
    }
    stop();
    if (event.repeat) return;
    if (event.key === "Escape") {
      cancelRecording();
      return;
    }
    const reset =
      event.key === "Backspace" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey;
    const key = reset
      ? presets[shortcuts.scheme][recording]
      : eventCombination(event);
    if (key === null || (!key && !reset)) return;
    const problem = bindingError(shortcuts, recording, key);
    if (problem) {
      el("shortcut-message").textContent = problem;
      return;
    }
    const next = structuredClone(shortcuts);
    if (reset || key === presets[next.scheme][recording])
      delete next.overrides[next.scheme][recording];
    else next.overrides[next.scheme][recording] = key;
    if (saveSettings(theme, showWordCount, typography, navigation, next)) {
      cancelRecording();
      el("shortcut-message").textContent = reset
        ? t("已恢复当前方案默认")
        : t("快捷键已保存");
    } else
      el("shortcut-message").textContent = t(
        "保存失败，原快捷键保持生效；请重试或按 Esc 取消。",
      );
    return;
  }
  const key = eventCombination(event);
  if (!key) return;
  const action = (Object.keys(actions) as Action[]).find(
    (id) => bindings(shortcuts)[id] === key,
  );
  // Native text inputs keep their own undo history, never undo the Markdown behind them.
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    if (key === "Ctrl+Z" || key === "Ctrl+Y" || key === "Ctrl+Shift+Z") return;
    if (
      action === "undo" ||
      action === "redo" ||
      (action && Object.hasOwn(formatActions, action))
    )
      return;
  }
  if (inline?.rich?.active && (action === "undo" || action === "redo")) {
    stop();
    inline.rich.history(action === "undo");
    return;
  }
  if (!action && !managedDefaults.has(key)) return;
  stop();
  if (!action || event.repeat || busy || document.querySelector("dialog[open]"))
    return;
  if (action === "settings") {
    openSettings();
    return;
  }
  if (action === "open") {
    void command("open");
    return;
  }
  if (folderWaiting) return;
  if (action === "new") {
    void command(homeVisible ? "new-file" : "new");
    return;
  }
  if (homeVisible) return;
  if (Object.hasOwn(formatActions, action)) runFormat(action as FormatAction);
  else if (action === "save" || action === "saveAs") {
    if (!current.readOnly) void command(action === "save" ? "save" : "save-as");
  } else if (action === "external") void command("external-edit");
  else if (action === "inline") selectInlineMode();
  else if (action === "table") startInline(null, "insert");
  else if (action === "split") mode(!reading);
  else if (action === "find") {
    if (inline) {
      if (inline.rich?.active) inline.rich.source();
      openSearchPanel(inline.view);
    } else if (reading) previewSearch.open();
    else openSearchPanel(editor);
  } else if (action === "refresh") {
    resetSyntax();
    resetMath();
    resetDiagrams();
    if (finishInline(true)) renderPreview();
  } else if (
    !current.readOnly &&
    (inline?.view.hasFocus ||
      (!reading && editor.hasFocus) ||
      (reading && !inline && document.activeElement === el("inline-mode")))
  ) {
    (action === "undo" ? undo : redo)(
      inline?.view.hasFocus ? inline.view : editor,
    );
  }
}
function settingsMessage(message: string, failed = false) {
  el("settings-message").textContent = message;
  el("settings-message").classList.toggle("settings-error", failed);
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(settingsKey);
    if (raw !== null) {
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object")
        throw new Error("invalid settings");
      if (
        ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(
          value.schemaVersion,
        ) &&
        typeof value.schemaVersion === "number"
      ) {
        settingsBlocked = true;
        settingsMessage(
          t(
            "此设置版本暂不支持，已使用默认值并保留原记录。请使用兼容版本修改。",
          ),
          true,
        );
        return;
      }
      // Migrate only fields introduced after the stored schema. Existing fields
      // still require validation; legacy rendering keeps soft breaks disabled.
      const loadedTypography =
        value.schemaVersion < 3
          ? { ...typographyDefaults, softBreaks: false }
          : {
              ...(value.schemaVersion < 6
                ? {
                    outlineFontScale: typographyDefaults.outlineFontScale,
                    outlineArrowScale: typographyDefaults.outlineArrowScale,
                    outlineGap: typographyDefaults.outlineGap,
                  }
                : {}),
              ...value.typography,
              ...(value.schemaVersion < 7
                ? { swapPanes: false, softBreaks: false }
                : {}),
            };
      if (
        ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(
          value.schemaVersion,
        ) ||
        typeof value.showWordCount !== "boolean" ||
        (value.schemaVersion >= 2 &&
          !["system", "light", "dark"].includes(value.theme)) ||
        (value.schemaVersion >= 3 && !validTypography(loadedTypography)) ||
        (value.schemaVersion >= 4 &&
          (!value.navigation ||
            ["history", "favorites", "files"].some(
              (key) => typeof value.navigation[key] !== "boolean",
            ))) ||
        (value.schemaVersion >= 5 && !validShortcuts(value.shortcuts)) ||
        (value.schemaVersion >= 8 && !!appearanceError(value.appearance)) ||
        (value.schemaVersion >= 9 && !validCustomCss(value.customCss)) ||
        (value.schemaVersion >= 10 &&
          !["path", "name"].includes(value.titleFormat)) ||
        (value.schemaVersion >= 11 && !validLanguage(value.language)) ||
        (value.schemaVersion >= 12 && typeof value.linkPreview !== "boolean") ||
        (value.schemaVersion >= 13 && typeof value.autoSave !== "boolean") ||
        (value.schemaVersion >= 15 &&
          typeof value.doubleClickEdit !== "boolean") ||
        (value.schemaVersion >= 16 && typeof value.taskStrike !== "boolean") ||
        (value.schemaVersion >= 14 &&
          (!value.toolbarVisibility ||
            Object.keys(toolbarDefaults).some(
              (key) => typeof value.toolbarVisibility[key] !== "boolean",
            )))
      )
        throw new Error("invalid settings");
      if (value.schemaVersion >= 14)
        toolbarVisibility = { ...value.toolbarVisibility };
      doubleClickEdit =
        value.schemaVersion >= 15 ? value.doubleClickEdit : false;
      taskStrike = value.schemaVersion >= 16 ? value.taskStrike : true;
      if (value.schemaVersion >= 13) autoSave = value.autoSave;
      if (value.schemaVersion >= 12) showLinkPreview = value.linkPreview;
      if (value.schemaVersion >= 11) language = value.language;
      if (value.schemaVersion >= 10) titleFormat = value.titleFormat;
      showWordCount = value.showWordCount;
      theme = value.schemaVersion === 1 ? "system" : value.theme;
      typography = { ...loadedTypography } as Typography;
      if (value.schemaVersion >= 4) navigation = { ...value.navigation };
      if (value.schemaVersion >= 5)
        shortcuts = structuredClone(value.shortcuts);
      if (value.schemaVersion >= 8)
        appearance = structuredClone(value.appearance);
      if (value.schemaVersion >= 9) {
        customCss = { ...value.customCss };
        try {
          customCssCompiled = compileCustomCss(customCss.source);
        } catch (error) {
          customCss.enabled = false;
          settingsMessage(
            t("自定义 CSS 已停用，原文保留，请编辑修正或恢复默认：{0}", [
              String(error),
            ]),
            true,
          );
        }
      }
    }
  } catch {
    settingsMessage(
      t("设置读取失败，暂用默认值；原记录未覆盖。修改设置可尝试重新保存。"),
      true,
    );
  } finally {
    reflectSettings();
  }
}
function openSettings() {
  linkPreview.hide();
  const dialog = el<HTMLDialogElement>("settings-dialog");
  if (busy || dialog.open || el<HTMLDialogElement>("confirm-dialog").open)
    return;
  if (!finishInline(true)) return;
  settingsReturnFocus = document.activeElement as HTMLElement;
  dialog.showModal();
  el("settings-close").focus();
}
const parser = installMath(
  installHighlight(
    new MarkdownIt({ html: false, linkify: true, breaks: false }),
  ),
);
installExtensions(parser);
installTasks(parser);
parser.core.ruler.push("source-lines", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1)
      token.attrSet("data-line", String(token.map[0] + 1));
    if (token.map && token.level === 0 && token.nesting !== -1 && !token.hidden)
      token.attrSet("data-end-line", String(token.map[1] + 1));
    if (token.type === "heading_open")
      token.attrSet("id", `line-${token.map![0] + 1}`);
  }
});
for (const name of ["fence", "code_block"]) {
  const render = parser.renderer.rules[name]!;
  parser.renderer.rules[name] = (tokens, i, options, env, self) => {
    const token = tokens[i];
    const html = render(tokens, i, options, env, self);
    return token.map && token.level === 0
      ? html.replace(
          "<pre",
          `<pre data-line="${token.map[0] + 1}" data-end-line="${token.map[1] + 1}"`,
        )
      : html;
  };
}
parser.renderer.rules.image = (tokens, i, options, _env, renderer) => {
  const token = tokens[i];
  token.attrSet("data-local-src", token.attrGet("src") || "");
  token.attrs = token.attrs?.filter(([name]) => name !== "src") || null;
  token.attrSet("alt", token.content);
  return renderer.renderToken(tokens, i, options);
};
function error(message: unknown) {
  el("error-text").textContent = String(message);
  el("error").hidden = false;
}
function insertionTarget(mapRich = true) {
  let fromPreview = false;
  if (
    !inline &&
    (reading ||
      (inlinePoint?.id === current.id &&
        inlinePoint.source === current.content))
  ) {
    startInline();
    fromPreview = true;
  }
  if (fromPreview) {
    if (!inline) return null;
    // Complex rendered blocks have no reliable text-to-source caret map.
    // Leave their source editor available, but never guess offset zero.
    if (inline.original && !inline.rich && inlineTarget?.tagName !== "PRE") {
      error(t("无法安全定位插入位置，请在源码中选择位置后重试。"));
      return null;
    }
  }
  if (reading && !inline) return null;
  const view = inline?.view || editor;
  if (
    view.compositionStarted ||
    view.state.readOnly ||
    view.state.selection.ranges.length !== 1
  )
    return null;
  const rich = inline?.rich?.active ? inline.rich : null;
  const range =
    rich && mapRich
      ? rich.insertion()
      : {
          text: view.state.doc.toString(),
          from: view.state.selection.main.from,
          to: view.state.selection.main.to,
        };
  if (!range) {
    error(t("无法安全定位插入位置，请在源码中选择位置后重试。"));
    return null;
  }
  return { view, rich, ...range };
}

function insertAtTarget(
  target: NonNullable<ReturnType<typeof insertionTarget>>,
  from: number,
  to: number,
  insert: string,
  cursor: number,
) {
  if (target.rich && !target.rich.source()) return false;
  target.view.dispatch({
    changes: target.rich
      ? {
          from: 0,
          to: target.view.state.doc.length,
          insert: target.text.slice(0, from) + insert + target.text.slice(to),
        }
      : { from, to, insert },
    selection: { anchor: cursor },
    annotations: isolateHistory.of("full"),
  });
  return true;
}

let snippetSession: {
  target: NonNullable<ReturnType<typeof insertionTarget>>;
  view: EditorView;
  doc: EditorState["doc"];
  id: string;
  content: string;
  pos: number;
} | null = null;

function openSnippets(trigger?: EditorView) {
  if (
    busy ||
    homeVisible ||
    folderWaiting ||
    current.readOnly ||
    inline?.table ||
    document.querySelector("dialog[open]")
  )
    return;
  const target = insertionTarget();
  if (!target) return;
  const { view } = target;
  if (
    (trigger && trigger !== view) ||
    view.compositionStarted ||
    view.state.readOnly
  )
    return;
  const pos = target.from;
  if (target.from !== target.to || !snippetRange(target.text, pos)) {
    if (!trigger)
      error(
        t(
          "请将光标放在顶层空行（或单独的 / 行）；片段暂支持 262144 个 UTF-16 单元以内的源码。",
        ),
      );
    return;
  }
  snippetSession = {
    target,
    view,
    doc: view.state.doc,
    id: current.id,
    content: current.content,
    pos,
  };
  el<HTMLInputElement>("snippet-filter").value = "";
  el("snippet-message").textContent = "";
  filterSnippets();
  el<HTMLDialogElement>("snippet-dialog").showModal();
  el("snippet-filter").focus();
}

function maybeSlash(update: ViewUpdate) {
  if (
    !update.docChanged ||
    update.view.compositionStarted ||
    !update.transactions.some((tr) => tr.isUserEvent("input.type"))
  )
    return;
  let count = 0,
    slash = false;
  update.changes.iterChanges((from, to, fromB, _toB, insert) => {
    count++;
    slash =
      from === to &&
      insert.toString() === "/" &&
      update.state.selection.main.head === fromB + 1;
  });
  if (count !== 1 || !slash) return;
  const doc = update.state.doc;
  queueMicrotask(() => {
    if (update.view.dom.isConnected && update.view.state.doc === doc)
      openSnippets(update.view);
  });
}

function filterSnippets() {
  const query = el<HTMLInputElement>("snippet-filter")
    .value.trim()
    .toLowerCase();
  const list = el<HTMLSelectElement>("snippet-list");
  list.replaceChildren();
  for (const [key, value] of Object.entries(snippets)) {
    if (`${key} ${value.label} ${t(value.label)}`.toLowerCase().includes(query))
      list.add(new Option(t(value.label), key));
  }
  list.selectedIndex = list.options.length ? 0 : -1;
  previewSnippet();
}

function previewSnippet() {
  const key = el<HTMLSelectElement>("snippet-list").value as Snippet;
  const valid = Object.hasOwn(snippets, key);
  el("snippet-preview").textContent = valid
    ? snippetText(key, t("文本"))
    : t("没有匹配的片段");
  el<HTMLButtonElement>("snippet-apply").disabled = !valid;
}

function applySnippet() {
  const session = snippetSession;
  const key = el<HTMLSelectElement>("snippet-list").value as Snippet;
  if (!session || !Object.hasOwn(snippets, key)) return;
  if (
    busy ||
    current.readOnly ||
    current.id !== session.id ||
    current.content !== session.content ||
    (inline?.view || editor) !== session.view ||
    session.view.state.doc !== session.doc ||
    session.view.compositionStarted
  ) {
    el("snippet-message").textContent = t(
      "文档状态已变化，未插入片段。请取消后重新打开。",
    );
    return;
  }
  const edit = snippetEdit(session.target.text, session.pos, key, t("文本"));
  if (
    !insertAtTarget(
      session.target,
      edit.from,
      edit.to,
      edit.insert,
      edit.cursor,
    )
  )
    return;
  el<HTMLDialogElement>("snippet-dialog").close();
  el("error").hidden = true;
}

function setupSnippets() {
  el("insert-snippet").onclick = () => openSnippets();
  el("snippet-filter").oninput = filterSnippets;
  el("snippet-list").onchange = previewSnippet;
  el("snippet-apply").onclick = applySnippet;
  const dialog = el<HTMLDialogElement>("snippet-dialog");
  el("snippet-cancel").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    const session = snippetSession;
    const view = session?.view;
    snippetSession = null;
    if (view?.dom.isConnected) {
      if (session?.target.rich?.active) session.target.rich.focus();
      else view.focus();
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" && event.target === el("snippet-filter")) {
      event.preventDefault();
      el("snippet-list").focus();
    } else if (
      event.key === "Enter" &&
      [el("snippet-filter"), el("snippet-list")].includes(
        event.target as HTMLElement,
      )
    ) {
      event.preventDefault();
      applySnippet();
    }
  });
}

function rememberFormatSelection() {
  if (inline) return;
  const selection = window.getSelection();
  const node = selection?.focusNode;
  const block = sourceBlock(
    node instanceof Element ? node : node?.parentElement || null,
  );
  if (block) {
    inlineTarget = block;
    rememberInlinePoint(block);
  } else if (
    selection &&
    !selection.isCollapsed &&
    (preview.contains(selection.anchorNode) ||
      preview.contains(selection.focusNode))
  ) {
    inlinePoint = {
      id: current.id,
      source: renderedSource,
      line: undefined,
      offset: 0,
      anchor: null,
      codeOffset: null,
    };
  }
}
function runFormat(action: FormatAction) {
  if (
    busy ||
    homeVisible ||
    folderWaiting ||
    current.readOnly ||
    inline?.table ||
    document.querySelector("dialog[open]")
  )
    return;
  rememberFormatSelection();
  if (
    !inline &&
    inlinePoint?.id === current.id &&
    inlinePoint.source !== current.content
  ) {
    error(t("预览映射已过期，请刷新预览后重新选择编辑块。"));
    return;
  }
  if (
    !inline &&
    inlinePoint?.id === current.id &&
    inlinePoint.anchor === null
  ) {
    error(t("请在同一个正文块内选择文字，跨块格式请使用分屏源码编辑。"));
    return;
  }
  const target = insertionTarget(false);
  if (!target) return;
  if (inline?.rich?.active) {
    if (inline.rich.format(action)) el("error").hidden = true;
    return;
  }
  const view = target.view;
  if (view.compositionStarted) return;
  if (view.state.selection.ranges.length !== 1) {
    error(
      t("格式操作未应用：请选择单一源码范围，最多 262144 个 UTF-16 单元。"),
    );
    return;
  }
  const { from, to } = view.state.selection.main;
  try {
    const edit = formatEdit(
      view.state.doc.toString(),
      from,
      to,
      action,
      t("文本"),
    );
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.anchor, head: edit.head },
      annotations: isolateHistory.of("full"),
    });
    el("error").hidden = true;
    view.focus();
  } catch {
    error(
      t("格式操作未应用：请选择单一源码范围，最多 262144 个 UTF-16 单元。"),
    );
  }
}
function attachmentError(reason: unknown) {
  const keys: Record<string, string> = {
    "attachment-unsaved": "请先保存文档，再插入图片或打开相对链接。",
    "attachment-size": "图片超过 10 MiB，未插入。",
    "attachment-type": "图片格式无效，仅支持 PNG、JPEG、GIF、WebP、BMP、AVIF。",
    "attachment-path":
      "路径不可用：仅支持文档目录内的普通文件，不允许上级目录、绝对路径或目录联接。",
    "attachment-link": "仅支持 HTTP(S)、文档内锚点和目录内的 Markdown 链接。",
    "attachment-browser": "无法启动默认浏览器，请检查系统的 HTTP(S) 默认应用。",
    "attachment-stale":
      "文档已变化，未插入图片；已复制的附件保留在 assets 目录。",
    "attachment-readonly": "当前文档只读，无法插入图片。",
  };
  error(
    t(keys[String(reason)] || "附件或链接操作失败，当前内容已保留。") +
      (keys[String(reason)] ? "" : ` ${String(reason)}`),
  );
}
async function insertImage(blob?: Blob) {
  if (
    busy ||
    homeVisible ||
    folderWaiting ||
    current.readOnly ||
    inline?.table ||
    document.querySelector("dialog[open]")
  )
    return;
  if (!current.path) {
    attachmentError("attachment-unsaved");
    return;
  }
  const target = insertionTarget();
  if (!target) return;
  const { view, from, to } = target;
  if (view.compositionStarted || view.state.selection.ranges.length !== 1)
    return;
  const before = view.state.doc,
    id = current.id,
    revision = current.revision;
  busy = true;
  editor.dispatch({
    effects: readonly.reconfigure(EditorState.readOnly.of(true)),
  });
  if (view !== editor)
    view.dispatch({
      effects: readonly.reconfigure(EditorState.readOnly.of(true)),
    });
  status();
  try {
    if (blob && blob.size > 10 * 1024 * 1024) throw "attachment-size";
    await flushEdits();
    const data = blob
      ? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject("attachment-type");
          reader.readAsDataURL(blob);
        })
      : null;
    const relative = await invoke<string | null>("import_image", {
      id,
      revision,
      data,
    });
    if (!relative) return;
    if (
      current.id !== id ||
      current.revision !== revision ||
      view.state.doc !== before ||
      (view !== editor && inline?.view !== view)
    )
      throw "attachment-stale";
    const insert = `![${t("图片")}](${relative})`;
    if (!insertAtTarget(target, from, to, insert, from + insert.length)) return;
    el("error").hidden = true;
  } catch (e) {
    attachmentError(e);
  } finally {
    busy = false;
    editor.dispatch({
      effects: readonly.reconfigure(EditorState.readOnly.of(current.readOnly)),
    });
    if (view !== editor && inline?.view === view)
      view.dispatch({
        effects: readonly.reconfigure(EditorState.readOnly.of(false)),
      });
    status();
    if (target.rich?.active) target.rich.focus();
    else view.focus();
  }
}
function jumpLink(fragment: string) {
  const exact = [...preview.querySelectorAll<HTMLElement>("[id]")].find(
    (n) => n.id === fragment,
  );
  const target =
    exact ||
    [...preview.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].find(
      (h) =>
        h.id === fragment ||
        h.textContent?.toLowerCase().replace(/\s+/g, "-") ===
          fragment.toLowerCase(),
    );
  if (target) target.scrollIntoView({ block: "start" });
  else error(t("未找到链接锚点，已保留当前文档。"));
}
async function openLink(href: string) {
  if (busy || inline || document.querySelector("dialog[open]")) return;
  const target = previewTarget(href);
  if (!target) {
    attachmentError("attachment-link");
    return;
  }
  if (target.kind === "anchor") {
    jumpLink(target.fragment);
    return;
  }
  if (target.kind === "web") {
    try {
      await invoke("open_web_link", { id: current.id, url: target.target });
    } catch (e) {
      attachmentError(e);
    }
  } else {
    const before = current.id;
    await command("open-link", target.target);
    if (current.id !== before && target.fragment) {
      renderPreview();
      jumpLink(target.fragment);
    }
  }
}
function setupAttachments() {
  el("insert-image").onclick = () => void insertImage();
  document.addEventListener(
    "paste",
    (event) => {
      if (
        !(event.target as Element)?.closest(
          "#editor .cm-content, #inline-source .cm-content",
        )
      )
        return;
      const files = [...(event.clipboardData?.items || [])].filter(
        (item) => item.kind === "file",
      );
      if (!files.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (files.length !== 1 || !files[0].type.startsWith("image/")) {
        attachmentError("attachment-type");
        return;
      }
      const blob = files[0].getAsFile();
      if (blob) void insertImage(blob);
    },
    true,
  );
  const dialog = el<HTMLDialogElement>("image-dialog"),
    image = el<HTMLImageElement>("image-full");
  const scale = el<HTMLInputElement>("image-scale");
  scale.oninput = () => {
    image.style.width = `${(image.naturalWidth * Number(scale.value)) / 100}px`;
    image.style.maxWidth = "none";
    el("image-percent").textContent = scale.value + "%";
  };
  el("image-fit").onclick = () => {
    image.style.width = "auto";
    image.style.maxWidth = "100%";
    el("image-percent").textContent = t("适应窗口");
  };
  el("image-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => image.removeAttribute("src"));
  preview.addEventListener("click", (event) => {
    const img = (event.target as Element).closest<HTMLImageElement>("img");
    if (
      !img ||
      img.closest(
        "a, input.task-check, .embedded-body, .footnotes, .inline-editor, .diagram-controls",
      ) ||
      !img.src.startsWith("data:image/") ||
      !img.naturalWidth ||
      busy ||
      inline ||
      document.querySelector("dialog[open]")
    )
      return;
    image.src = img.src;
    image.alt = img.alt;
    scale.value = "100";
    el("image-fit").click();
    dialog.showModal();
  });
}

function status() {
  reflectModes();
  el<HTMLButtonElement>("insert-image").disabled =
    busy || folderWaiting || current.readOnly || !!inline?.table;

  el<HTMLButtonElement>("insert-snippet").disabled =
    busy || folderWaiting || current.readOnly || !!inline?.table;
  el<HTMLSelectElement>("format-action").disabled =
    busy || folderWaiting || current.readOnly || !!inline?.table;
  reflectAutoSave();
  if (busy || homeVisible || folderWaiting) linkPreview.hide();
  for (const id of [
    "home-open",
    "home-new",
    "home-back",
    "home-settings",
    "home-folder",
    "home-history",
    "home-favorites",
    "tab-favorites",
    "tab-history",
    "folder-home",
    "document-settings",
    "output-open",
    "versions-open",
  ])
    el<HTMLButtonElement>(id).disabled = busy;
  favoriteStatus();
  el("home").setAttribute("aria-busy", String(busy));
  el("folder-panel").setAttribute("aria-busy", String(busy));
  el<HTMLButtonElement>("history-retry").disabled = busy;
  for (const button of el("history-list").querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    button.disabled = busy;
    const active =
      current.path?.toLowerCase() === button.dataset.path?.toLowerCase();
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    button.querySelector("small")!.textContent = active ? t("当前") : "";
  }
  el<HTMLButtonElement>("tab-files").disabled =
    busy || (!folder && !current.path);
  el<HTMLButtonElement>("folder-up").disabled = busy || !folder?.canGoUp;
  el<HTMLButtonElement>("folder-locate").disabled = busy || !current.path;
  for (const button of el(
    "folder-directories",
  ).querySelectorAll<HTMLButtonElement>("button"))
    button.disabled = busy;
  el("filename").textContent =
    `${current.dirty || inlineDirty() ? "● " : ""}${current.name}`;
  el("filepath").textContent = current.path || t("本地阅读，自由书写");
  el("filepath").title = current.path || "";
  const saveState = saving
    ? "saving"
    : syncError
      ? "sync-error"
      : busy
        ? "busy"
        : acknowledgedRevision < current.revision
          ? "syncing"
          : current.readOnly
            ? "read-only"
            : current.external
              ? "conflict"
              : diskError
                ? "disk-error"
                : saveError
                  ? "save-error"
                  : inlineDirty()
                    ? "inline-draft"
                    : current.dirty
                      ? "dirty"
                      : current.path
                        ? "saved"
                        : "unsaved";
  const saveLabels = {
    "inline-draft": t("就地草稿 · 尚未应用到文档"),
    saving: t("正在保存…"),
    "sync-error": t("编辑同步失败 · 请重试保存，勿关闭窗口"),
    busy: t("正在处理…"),
    syncing: t("正在同步编辑…"),
    "read-only": t("只读 · 不可保存"),
    conflict: t("磁盘版本已变化 · 请处理冲突"),
    "disk-error": t("磁盘状态未知 · 请检查文件"),
    "save-error": t("保存未确认 · 请重试或另存副本"),
    dirty: t("有未保存的修改"),
    saved: t("已保存"),
    unsaved: t("尚未保存到文件"),
  };
  el("save-status").textContent = saveLabels[saveState];
  el("save-status").dataset.state = saveState;
  el("save-status").title = syncError || saveError || diskError;
  el("save-indicator").classList.toggle("dirty", saveState !== "saved");
  el("save-indicator").classList.toggle(
    "failure",
    ["sync-error", "save-error", "disk-error", "conflict"].includes(saveState),
  );
  el("encoding").textContent = current.bom ? "UTF-8 BOM" : "UTF-8";
  el("line-ending").textContent = current.eol;
  el("readonly").textContent = current.readOnly ? t("只读") : "";
  scheduleStatistics();
  if (folderWaiting && folder) {
    el("filename").textContent =
      folder.displayPath.split(/[\\/]/).filter(Boolean).pop() ||
      folder.displayPath;
    el("filepath").textContent = folder.displayPath;
    el("filepath").title = folder.displayPath;
  }
  if (folderWaiting && !folder) {
    el("filename").textContent = t(collectionTitle);
    el("filepath").textContent = t("从{0}选择文档", [t(collectionTitle)]);
    el("filepath").title = "";
  }
  el("panes").hidden = folderWaiting;
  el("folder-welcome").hidden = !folderWaiting;
  el("document-view").querySelector("footer")!.hidden = folderWaiting;
  for (const id of [
    "read-mode",
    "split-mode",
    "inline-mode",
    "insert-table",
    "external-edit",
    "focus-toggle",
    "new",
    "save",
    "save-as",
    "find",
    "refresh",
    "tab-outline",
  ])
    el<HTMLButtonElement>(id).disabled =
      busy ||
      folderWaiting ||
      (current.readOnly &&
        (id.startsWith("save") ||
          id === "inline-mode" ||
          id === "insert-table"));
  for (const button of el("folder-files").querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    button.disabled = busy;
    const active =
      current.path?.toLowerCase() ===
      `${folder?.displayPath.replace(/[\\/]$/, "")}\\${button.dataset.name}`.toLowerCase();
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    button.querySelector("small")!.textContent = active ? t("当前") : "";
  }
  el("notice").hidden = !(
    current.external ||
    current.readOnly ||
    diskError ||
    reloadMessage
  );
  el("notice-text").textContent =
    reloadMessage +
    (current.readOnly
      ? current.readOnlyReason +
        t(
          "重新载入或重启不会转换换行。可备份后统一原文件换行，或另存为可编辑副本。",
        )
      : diskError
        ? t("无法检查磁盘文件：{0}。当前内容仍保留，可重试保存或另存副本。", [
            diskError,
          ])
        : current.external
          ? t(
              "文件已被其他程序修改或删除。重新载入磁盘版本，或另存副本保留当前内容。",
            )
          : "");
  updatePreviewEditControls();
  el("notice-copy").textContent = current.readOnly
    ? t("另存为可编辑副本")
    : t("另存副本");
  el<HTMLButtonElement>("notice-copy").disabled = busy;
  el("notice-normalize").hidden = !current.readOnly;
  el<HTMLButtonElement>("notice-normalize").disabled = busy;
  for (const id of ["open", "new", "save", "save-as", "reload"])
    el<HTMLButtonElement>(id).disabled =
      busy ||
      (folderWaiting && id !== "open") ||
      (current.readOnly && (id.startsWith("save") || id === "inline-mode"));
  if (inline?.rich)
    inline.rich.area.contentEditable = String(!busy && !current.readOnly);
  const active = inline?.view || editor;
  const pos = active.state.selection.main.head,
    line = active.state.doc.lineAt(pos);
  const baseLine = inline ? editor.state.doc.lineAt(inline.from).number - 1 : 0;
  el("position").textContent = t("行 {0}，列 {1}", [
    baseLine + line.number,
    pos - line.from + 1,
  ]);
}
function makeState(content: string) {
  return EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      editorAppearance.of(editorTheme()),
      markdown(),
      keymap.of([indentWithTab]),
      EditorView.lineWrapping,
      readonly.of(EditorState.readOnly.of(busy || current.readOnly)),
      editorLanguage.of(editorLanguageExtensions()),
      EditorView.updateListener.of((update) => {
        maybeSlash(update);
        if (update.docChanged) {
          fullCount = null;
          current.content = update.state.doc.toString();
          current.revision++;
          deferAutoSave();
          // Until this exact revision is acknowledged, never claim the buffer is saved.
          current.dirty = true;
          const { id, revision, content } = current;
          pending = pending.then(() => syncEdit(id, revision, content));
          schedulePreview();
        }
        if (update.docChanged || update.selectionSet) status();
      }),
    ],
  });
}
async function syncEdit(id: string, revision: number, content: string) {
  try {
    const result = await invoke<Snapshot>("document_edit", {
      id,
      revision,
      content,
    });
    if (current.id === id && current.revision === revision) {
      acknowledgedRevision = revision;
      current.dirty = result.dirty;
      syncError = "";
    }
  } catch (e) {
    if (current.id === id && current.revision === revision) {
      syncError = String(e);
      error(e);
    }
  }
  status();
}
async function flushEdits() {
  await pending;
  if (syncError || acknowledgedRevision < current.revision) {
    await syncEdit(current.id, current.revision, current.content);
  }
  if (syncError) throw new Error(syncError);
}
function apply(snapshot: Snapshot) {
  const changed = !current || current.id !== snapshot.id;
  const pathChanged = !current || current.path !== snapshot.path;
  current = snapshot;
  if (changed && (pathChanged || snapshot.readOnly)) inlineSelected = false;
  acknowledgedRevision = snapshot.revision;
  if (changed) {
    reloadMessage = "";
    previewSearch.reset();
    autoPaused = false;
    deferAutoSave();
    fullCount = null;
    syncError = "";
    saveError = "";
    diskError = "";
    editor.setState(makeState(snapshot.content));
  }
  if (changed || pathChanged) {
    if (snapshot.content.length <= 1024 * 1024) renderPreview();
    else {
      fullCount = null;
      generation++;
      preview.replaceChildren();
      clearOutline("内容较大，请点击刷新生成大纲");
      schedulePreview();
    }
  }
  status();
}
function schedulePreview() {
  clearTimeout(renderTimer);
  if (current.content.length > 1024 * 1024) {
    el("refresh").textContent = t("内容较大 · 点击刷新");
    clearOutline("内容较大，请点击刷新生成大纲");
    return;
  }
  renderTimer = window.setTimeout(renderPreview, 180);
}
function renderPreview() {
  clearTimeout(renderTimer);
  if (inline) return;
  stopSyntax();
  stopMath();
  stopDiagrams();
  renderedSource = current.content;
  inlineTarget = null;
  parser.options.breaks = typography.softBreaks;
  const stamp = ++generation,
    id = current.id;
  el("refresh").textContent = t("刷新");
  if (!current.content) {
    fullCount = 0;
    scheduleStatistics();
    preview.innerHTML = t(
      '<div class="welcome"><span class="eyebrow">YOUR WORDS, YOUR SPACE</span><h1>从一页文字开始。</h1><p>打开 Markdown 文档，或在编辑区写下第一行。<br>内容与预览，在这里并肩呈现。</p><div class="welcome-card"><strong>轻量阅读，专注书写</strong><p id="welcome-shortcuts"></p></div></div>',
    );
    reflectShortcuts();
    clearOutline("此文档没有标题");
    return;
  }
  const tokens = parser.parse(current.content, {});
  preview.innerHTML = DOMPurify.sanitize(
    parser.renderer.render(tokens, parser.options, {}),
  );
  fullCount = countText(previewText(preview));
  scheduleStatistics();
  void renderEmbeds(
    preview,
    id,
    () => stamp === generation && id === current.id && !inline,
    () => {
      fullCount = countText(previewText(preview));
      scheduleStatistics();
    },
  );
  void syntaxHighlight(
    preview,
    () => stamp === generation && id === current.id && !inline,
  );
  void renderMath(
    preview,
    () => stamp === generation && id === current.id && !inline,
    () => {
      fullCount = countText(previewText(preview));
      scheduleStatistics();
    },
  );
  void renderDiagrams(
    preview,
    () => stamp === generation && id === current.id && !inline,
    () => {
      updatePreviewEditControls();
      fullCount = countText(previewText(preview));
      scheduleStatistics();
    },
    (node) => startInline(node),
    (node) => startInline(node, "flow"),
  );
  for (const table of preview.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", t("表格，可横向滚动"));
    table.before(scroll);
    scroll.append(table);
  }
  preview
    .querySelectorAll<HTMLInputElement>(".task-check")
    .forEach((n) => (n.disabled = current.readOnly));
  previewTools(preview, (table) => startInline(table, "edit"));
  updatePreviewEditControls();
  renderOutline(current.id);
  for (const img of preview.querySelectorAll<HTMLImageElement>(
    "img[data-local-src]",
  )) {
    const src = img.dataset.localSrc || "";
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(src)) {
      remoteImage(img, id, () => stamp === generation && id === current.id);
      continue;
    }
    let relative: string;
    try {
      relative = decodeURIComponent(src);
    } catch {
      img.title = t("图片路径编码无效");
      continue;
    }
    void invoke<string>("read_image", { id, relative })
      .then((data) => {
        if (stamp === generation && id === current.id) {
          img.onerror = () => {
            img.title = t("图片无法解码或已损坏；源文件未修改。");
          };
          img.src = data;
        }
      })
      .catch((e) => {
        img.title = String(e);
      });
  }
}
async function confirmLeave(external = false): Promise<string> {
  const dialog = el<HTMLDialogElement>("confirm-dialog");
  dialog.querySelector<HTMLButtonElement>("button[value=discard]")!.hidden =
    external;
  el("confirm-detail").textContent = external
    ? t("外部编辑需要先保存当前文件。保存并打开外部编辑器？")
    : t("“{0}”还有未保存的修改。是否保存后继续？", [current.name]);
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue || "cancel"),
      { once: true },
    );
    dialog.returnValue = "cancel";
    dialog.showModal();
  });
}
async function nativeAction(name: string, discard = false, entry?: string) {
  const previousId = current.id;
  diskEpoch++;
  saving = ["save", "save-as", "editable-copy", "normalize-newlines"].includes(
    name,
  );
  status();
  try {
    const result = await invoke<Snapshot & { cancelled: boolean }>(
      "document_action",
      {
        id: current.id,
        revision: current.revision,
        name,
        discard,
        entry: entry ?? null,
      },
    );
    apply(result);
    if (name === "reload" && !result.cancelled) {
      reloadMessage =
        t("已重新读取磁盘文件。") +
        (current.readOnly ? t("文件仍为只读。") : "");
      const session = current.id;
      const acknowledgement = reloadMessage;
      clearTimeout(reloadNoticeTimer);
      reloadNoticeTimer = window.setTimeout(() => {
        if (current.id !== session || reloadMessage !== acknowledgement) return;
        reloadMessage = "";
        status(); // Keep actionable read-only, disk-error and conflict notices.
      }, 2500);
    }
    if (name === "editable-copy" && !result.cancelled)
      reloadMessage = t("已创建可编辑副本，换行已统一为 LF，原文件未修改。");
    if (name === "normalize-newlines")
      reloadMessage = t("已备份并统一为 LF，可直接编辑原文件。原始备份：{0}", [
        current.backupPath || "",
      ]);
    if (saving && !result.cancelled && !result.dirty) {
      autoPaused = false;
      saveError = "";
      diskError = "";
    }
  } catch (e) {
    if (saving) {
      saveError = String(e);
      // Reconcile a native save whose response failed, without replacing editor/undo.
      try {
        const state = await invoke<Snapshot>("document_state");
        if (
          state.id === current.id &&
          state.revision === current.revision &&
          state.content === current.content
        )
          apply(state);
      } catch {
        /* Keep the local buffer; retry remains explicit. */
      }
    }
    throw e;
  } finally {
    saving = false;
    diskEpoch++;
  }
  if (name === "home") showHome(true);
  else if (name === "normalize-newlines") mode(false);
  else if (
    current.id !== previousId &&
    [
      "editable-copy",
      "open",
      "open-entry",
      "open-link",
      "open-history",
      "open-favorite",
      "new",
      "new-file",
    ].includes(name)
  ) {
    const fromHome = homeVisible || folderWaiting;
    folderWaiting = false;
    if (name !== "open-entry") {
      folder = null;
      renderFolder();
      showSidebar(false);
    }
    showHome(false);
    if (name === "new" || name === "new-file" || name === "editable-copy")
      mode(false);
    else if (fromHome) mode(true);
    if (name === "open-history") showSidebar("history");
    if (name === "open-favorite") showSidebar("favorites");
  }
}
async function command(name: string, entry?: string, automatic = false) {
  if (automatic && (inline || !autoSave || !current.path || autoPaused)) return;
  const snippetDialog = el<HTMLDialogElement>("snippet-dialog");
  if (snippetDialog.open) {
    if (name !== "close") return;
    snippetDialog.close();
  }
  const imageDialog = el<HTMLDialogElement>("image-dialog");
  if (imageDialog.open) {
    if (name !== "close") return;
    imageDialog.close();
  }
  if (busy || !finishInline(true)) return;
  if (
    ["open-history", "open-favorite"].includes(name) &&
    current.path?.toLowerCase() === entry?.toLowerCase()
  )
    return;
  if (
    folderWaiting &&
    ![
      "home",
      "open",
      "open-entry",
      "open-link",
      "open-history",
      "open-favorite",
      "close",
    ].includes(name)
  )
    return;
  const externalDialog = el<HTMLDialogElement>("external-dialog");
  if (externalDialog.open) {
    if (name !== "close") return;
    externalDialog.close();
  }
  const settings = el<HTMLDialogElement>("settings-dialog");
  if (settings.open) {
    if (name !== "close") return;
    const fontDialog = el<HTMLDialogElement>("font-dialog");
    if (fontDialog.open) fontDialog.close();
    const paletteDialog = el<HTMLDialogElement>("palette-dialog");
    if (paletteDialog.open) paletteDialog.close();
    const cssDialog = el<HTMLDialogElement>("css-dialog");
    if (cssDialog.open) cssDialog.close();
    settings.close();
  }
  busy = true;
  reloadMessage = "";
  editor.dispatch({
    effects: readonly.reconfigure(EditorState.readOnly.of(true)),
  });
  status();
  try {
    await flushEdits();
    if (name === "normalize-newlines") {
      const dialog = el<HTMLDialogElement>("normalize-dialog");
      const answer = await new Promise<string>((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue), {
          once: true,
        });
        dialog.returnValue = "cancel";
        dialog.showModal();
      });
      if (answer !== "convert") return;
    }
    let discard = false;
    if (name === "external-edit" && (current.dirty || !current.path)) {
      if ((await confirmLeave(true)) !== "save") return;
      await nativeAction("save");
      if (current.dirty || !current.path) return;
    }
    if (
      [
        "home",
        "new",
        "new-file",
        "open",
        "open-entry",
        "open-link",
        "open-history",
        "open-favorite",
        "reload",
        "close",
      ].includes(name) &&
      current.dirty
    ) {
      const answer = await confirmLeave();
      if (answer === "cancel") return;
      if (answer === "save") {
        await nativeAction("save");
        if (current.dirty) return;
      } else discard = true;
    }
    await nativeAction(name, discard, entry);
    el("error").hidden = true;
  } catch (e) {
    if (automatic) autoPaused = true;
    if (name === "open-link") attachmentError(e);
    else error(e);
  } finally {
    await refreshHistory();
    await refreshFavorites();
    busy = false;
    editor.dispatch({
      effects: readonly.reconfigure(EditorState.readOnly.of(current.readOnly)),
    });
    status();
    if (homeVisible) el(name === "new-file" ? "home-new" : "home-open").focus();
    else if (name === "open-favorite" && !el("favorites-panel").hidden) {
      Array.from(
        el("favorites-list").querySelectorAll<HTMLButtonElement>(
          ".favorite-open",
        ),
      )
        .find((button) => button.dataset.path === entry)
        ?.focus();
    } else if (name === "open-history" && !el("history-panel").hidden) {
      Array.from(
        el("history-list").querySelectorAll<HTMLButtonElement>("button"),
      )
        .find((button) => button.dataset.path === entry)
        ?.focus();
    }
  }
}
function showHome(show: boolean) {
  homeVisible = show;
  el("home").hidden = !show;
  el("document-view").hidden = show;
  if (show) {
    if (focusMode) setFocusMode(false);
    folder = null;
    folderWaiting = false;
    renderFolder();
    showSidebar(false);
    el("home-open").focus();
  } else editor.requestMeasure();
}
function showSidebar(view: SidebarView) {
  if (!sidebarVisible(view)) view = false;
  sidebarView = view;
  const files = view === true,
    historical = view === "history",
    starred = view === "favorites";
  el("favorites-panel").hidden = !starred;
  el("tab-favorites").setAttribute("aria-pressed", String(starred));
  if (starred) renderFavorites();
  el("history-panel").hidden = !historical;
  el("tab-history").setAttribute("aria-pressed", String(historical));
  if (historical) renderHistory();
  el("folder-panel").hidden = !files;
  el("outline").hidden = files || historical || starred;
  el("outline-heading").hidden = files || historical || starred;
  el("tab-files").setAttribute("aria-pressed", String(files));
  el("tab-outline").setAttribute(
    "aria-pressed",
    String(!files && !historical && !starred),
  );
  if (!files && !historical && !starred) followOutline();
}
async function refreshHistory(retry = false) {
  try {
    history = await invoke<HistoryView>("history_state", { retry });
  } catch (e) {
    history.warning = t("历史加载失败：") + String(e);
    history.canRetry = false;
  }
  renderHistory();
}
function renderHistory() {
  el("history-warning").textContent = history.warning || "";
  el("history-warning").hidden = !history.warning;
  el("history-retry").hidden = !history.canRetry;
  const list = el("history-list");
  list.replaceChildren();
  const dateKey = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  const now = new Date(),
    today = dateKey(now),
    yesterday = dateKey(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
    );
  let previous = "";
  for (const entry of history.entries) {
    const date = dateKey(new Date(entry.openedAt));
    if (date !== previous) {
      const heading = document.createElement("h3");
      heading.textContent =
        date === today ? t("今天") : date === yesterday ? t("昨天") : date;
      list.append(heading);
      previous = date;
    }
    const button = document.createElement("button");
    button.dataset.path = entry.path;
    button.title = entry.path + (entry.error ? "\n" + entry.error : "");
    const label = document.createElement("span"),
      marker = document.createElement("small");
    label.className = "history-name";
    label.textContent = entry.path.split(/[\\/]/).pop() || entry.path;
    button.append(label, marker);
    button.onclick = () => void command("open-history", entry.path);
    list.append(button);
    if (entry.error) {
      const message = document.createElement("p");
      message.className = "history-error";
      message.textContent = t("无法打开，可恢复文件后重试：") + entry.error;
      list.append(message);
    }
  }
  if (!history.entries.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = t("暂无历史记录，成功打开文件后会显示在这里。");
    list.append(empty);
  }
  status();
}
function openHomeHistory(starred = false) {
  if (busy || !homeVisible || !navigation[starred ? "favorites" : "history"])
    return;
  showHome(false);
  collectionTitle = starred ? "收藏" : "历史记录";
  folderWaiting = true;
  el("folder-welcome-title").textContent = t("从{0}选择文档", [
    t(collectionTitle),
  ]);
  el("folder-welcome-detail").textContent = t(
    "点击左侧文件重新打开，也可返回首页选择其他文件。",
  );
  showSidebar(starred ? "favorites" : "history");
  status();
  (
    el(starred ? "favorites-list" : "history-list").querySelector<HTMLElement>(
      "button",
    ) || el("folder-home")
  ).focus();
}

function favoritePath(action: "file" | "folder" | "parent") {
  if (action === "file") return current.path;
  if (action === "folder" && folder) return folder.displayPath;
  const parent = current.path?.replace(/[\\/][^\\/]+$/, "");
  return parent?.endsWith(":") ? parent + "\\" : parent || null;
}
function favoriteStatus() {
  for (const [id, action] of [
    ["favorite-file", "file"],
    ["favorite-folder", "folder"],
  ] as const) {
    const path = favoritePath(action),
      kind = action === "file" ? "file" : "folder";
    const exists = favorites.entries.some(
      (e) => e.kind === kind && e.path.toLowerCase() === path?.toLowerCase(),
    );
    const button = el<HTMLButtonElement>(id);
    button.disabled = busy || favorites.blocked || !path;
    button.textContent = t(
      kind === "file"
        ? exists
          ? "取消当前文件收藏"
          : "收藏当前文件"
        : exists
          ? "取消当前目录收藏"
          : "收藏当前目录",
    );
    button.title = path || t("请先打开或保存文件，或选择目录。");
  }
  for (const button of el("favorites-list").querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    button.disabled =
      busy ||
      (favorites.blocked && button.classList.contains("favorite-remove"));
    if (!button.classList.contains("favorite-open")) continue;
    const active =
      button.dataset.kind === "file" &&
      current.path?.toLowerCase() === button.dataset.path?.toLowerCase();
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    button.querySelector("small")!.textContent = active ? t("当前") : "";
  }
}
async function refreshFavorites() {
  try {
    favorites = await invoke<FavoritesView>("favorites_state");
  } catch (e) {
    favorites.warning = t("收藏加载失败：") + String(e);
    favorites.blocked = true;
  }
  renderFavorites();
}
function renderFavorites() {
  el("favorites-warning").textContent = favorites.warning || "";
  el("favorites-warning").hidden = !favorites.warning;
  const list = el("favorites-list");
  list.replaceChildren();
  for (const entry of favorites.entries) {
    const row = document.createElement("div");
    row.className = "favorite-row";
    const open = document.createElement("button");
    open.className = "favorite-open";
    open.dataset.path = entry.path;
    open.dataset.kind = entry.kind;
    open.title = `${entry.kind === "folder" ? t("文件夹") : t("文件")}：${entry.path}`;
    const icon = document.createElement("span");
    icon.textContent = entry.kind === "folder" ? "▸" : "▤";
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "favorite-name";
    name.textContent =
      entry.path.split(/[\\/]/).filter(Boolean).pop() || entry.path;
    open.append(icon, name, document.createElement("small"));
    open.setAttribute(
      "aria-label",
      `${entry.kind === "folder" ? t("文件夹") : t("文件")}：${entry.path}`,
    );
    open.onclick = () =>
      entry.kind === "folder"
        ? void navigateFolder("favorite", entry.path)
        : void command("open-favorite", entry.path);
    const remove = document.createElement("button");
    remove.className = "favorite-remove";
    remove.textContent = "×";
    remove.title = t("取消收藏");
    remove.setAttribute("aria-label", t("取消收藏：{0}", [entry.path]));
    remove.onclick = () =>
      void changeFavorite("remove", entry.kind, entry.path);
    row.append(open, remove);
    list.append(row);
    if (entry.error) {
      const error = document.createElement("p");
      error.className = "favorite-error";
      error.textContent =
        t("无法打开，可恢复路径后重试或取消收藏：") + entry.error;
      list.append(error);
    }
  }
  if (!favorites.entries.length) {
    const empty = document.createElement("p");
    empty.className = "favorite-empty";
    empty.textContent = t(
      "暂无收藏，可在上方按钮或右键菜单收藏当前文件及目录。",
    );
    list.append(empty);
  }
  favoriteStatus();
}
async function changeFavorite(
  action: string,
  kind: FavoriteKind,
  entry?: string,
) {
  if (busy || !finishInline(true)) return;
  busy = true;
  status();
  editor.dispatch({
    effects: readonly.reconfigure(EditorState.readOnly.of(true)),
  });
  try {
    await flushEdits();
    favorites = await invoke<FavoritesView>("favorite_action", {
      id: current.id,
      revision: current.revision,
      action,
      kind,
      entry: entry ?? null,
    });
    el("error").hidden = true;
  } catch (e) {
    error(e);
  } finally {
    await refreshFavorites();
    busy = false;
    editor.dispatch({
      effects: readonly.reconfigure(EditorState.readOnly.of(current.readOnly)),
    });
    status();
    if (!el("favorites-panel").hidden)
      (
        el("favorites-list").querySelector<HTMLElement>(
          "button:not(:disabled)",
        ) || el("tab-favorites")
      ).focus();
  }
}
async function toggleFavorite(action: "file" | "folder" | "parent") {
  const path = favoritePath(action),
    kind = action === "file" ? "file" : "folder";
  const exists = favorites.entries.find(
    (e) => e.kind === kind && e.path.toLowerCase() === path?.toLowerCase(),
  );
  await changeFavorite(exists ? "remove" : action, kind, exists?.path);
}
function initFavoriteMenu() {
  const menu = el("favorite-menu");
  let action: "parent" | "folder" = "parent";
  let returnFocus: HTMLElement | null = null;
  let editTarget: {
    id: string;
    source: string | null;
    line?: string;
    end?: string;
  } | null = null;
  for (const target of [
    el("preview"),
    document.querySelector<HTMLElement>(".doc-title")!,
    el("folder-panel"),
  ]) {
    target.addEventListener("contextmenu", (event) => {
      if (
        busy ||
        homeVisible ||
        (event.target as Element).closest(".inline-editor")
      )
        return;
      event.preventDefault();
      const editItem = el<HTMLButtonElement>("menu-inline");
      editItem.hidden =
        target !== preview ||
        !!(event.target as Element).closest(".embedded-body, .footnotes");
      editItem.disabled = current.readOnly || !!inline;
      const tableItem = el<HTMLButtonElement>("menu-table");
      tableItem.hidden =
        target !== preview ||
        sourceBlock(event.target as Element)?.tagName !== "TABLE";
      tableItem.disabled = current.readOnly || !!inline;
      if (target === preview) {
        inlineTarget = sourceBlock(event.target as Element);
        rememberInlinePoint(inlineTarget);
      }
      editTarget =
        target === preview
          ? {
              id: current.id,
              source: renderedSource,
              line: inlineTarget?.dataset.line,
              end: inlineTarget?.dataset.endLine,
            }
          : null;
      returnFocus = document.activeElement as HTMLElement;
      action = target.id === "folder-panel" ? "folder" : "parent";
      for (const [id, key] of [
        ["menu-favorite-file", "file"],
        ["menu-favorite-folder", action],
      ] as const) {
        const button = el<HTMLButtonElement>(id),
          path = favoritePath(key),
          kind = key === "file" ? "file" : "folder";
        const exists = favorites.entries.some(
          (e) =>
            e.kind === kind && e.path.toLowerCase() === path?.toLowerCase(),
        );
        button.disabled = favorites.blocked || !path;
        const label =
          key === "file"
            ? t("当前文件")
            : key === "parent"
              ? t("所在目录")
              : t("当前目录");
        button.textContent = exists
          ? t("取消{0}收藏", [label])
          : t("收藏{0}", [label]);
        button.title = path || t("暂无可收藏路径");
      }
      menu.style.left = `${Math.min(event.clientX, Math.max(8, innerWidth - 246))}px`;
      menu.showPopover();
      menu.style.top = `${Math.min(event.clientY, Math.max(8, innerHeight - menu.getBoundingClientRect().height - 8))}px`;
      menu
        .querySelector<HTMLElement>("button:not(:disabled):not([hidden])")
        ?.focus();
    });
  }
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.hidePopover();
      returnFocus?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...menu.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled):not([hidden])",
      ),
    ];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (i + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
    ].focus();
  });
  const editFromMenu = (tableMode: "edit" | null) => {
    menu.hidePopover();
    // A queued preview render can replace the DOM while the menu is open.
    // Rebind only against the identical source, never fall back to another block.
    const selection = editTarget;
    const target =
      selection?.line === undefined
        ? null
        : [...preview.querySelectorAll<HTMLElement>("[data-end-line]")].find(
            (node) =>
              node.dataset.line === selection.line &&
              node.dataset.endLine === selection.end,
          );
    if (
      !selection ||
      selection.id !== current.id ||
      selection.source !== current.content ||
      (selection.line !== undefined && !target)
    ) {
      error(t("预览映射已过期，请刷新预览后重新选择编辑块。"));
      return;
    }
    startInline(target || null, tableMode);
  };
  el("menu-inline").onclick = () => editFromMenu(null);
  el("menu-table").onclick = () => editFromMenu("edit");
  el("menu-favorite-file").onclick = () => {
    menu.hidePopover();
    void toggleFavorite("file");
  };
  el("menu-favorite-folder").onclick = () => {
    menu.hidePopover();
    void toggleFavorite(action);
  };
}
function renderFolder() {
  el<HTMLButtonElement>("tab-files").disabled = !folder && !current.path;
  el("folder-files").replaceChildren();
  el("folder-directories").replaceChildren();
  el("folder-root").textContent = folder
    ? folder.canGoUp
      ? t("根目录：{0}", [
          folder.displayRoot.split(/[\\/]/).filter(Boolean).pop() ||
            folder.displayRoot,
        ])
      : t("已到导航根目录")
    : "";
  el("folder-root").title = folder?.displayRoot || "";
  el("folder-up").title = folder?.canGoUp
    ? t("返回父目录")
    : t("不能超出导航根目录");
  if (!folder) {
    el("folder-name").textContent = t("文件");
    el("folder-path").textContent = t("点击定位当前文件以查看所在目录。");
    el("folder-path").title = "";
    el("folder-empty").hidden = true;
    return;
  }
  el("folder-name").textContent =
    folder.displayPath.split(/[\\/]/).filter(Boolean).pop() ||
    folder.displayPath;
  el("folder-path").textContent = folder.displayPath;
  el("folder-path").title = folder.displayPath;
  for (const name of folder.directories) {
    const button = document.createElement("button");
    button.dataset.name = name;
    button.title = name;
    button.textContent = `▸ ${name}`;
    button.onclick = () => void navigateFolder("child", name);
    el("folder-directories").append(button);
  }
  for (const name of folder.files) {
    const button = document.createElement("button");
    button.dataset.name = name;
    button.title = name;
    const label = document.createElement("span");
    label.className = "file-name";
    label.textContent = name;
    button.append(label, document.createElement("small"));
    button.onclick = () => void command("open-entry", name);
    el("folder-files").append(button);
  }
  const empty = folder.empty
    ? t("此文件夹为空")
    : t("此文件夹中没有 Markdown 文件");
  el("folder-empty").hidden = folder.files.length > 0;
  el("folder-empty").textContent = empty;
  el("folder-welcome-title").textContent =
    folder.files.length || folder.directories.length
      ? t("请选择文件或子目录")
      : empty;
  el("folder-welcome-detail").textContent =
    folder.files.length || folder.directories.length
      ? t("从左侧选择文档阅读，或进入子目录浏览。")
      : t("可以返回首页选择其他文件夹或打开文件。");
}
async function navigateFolder(
  action: "child" | "up" | "locate" | "favorite",
  entry?: string,
) {
  if (busy || homeVisible || el<HTMLDialogElement>("settings-dialog").open)
    return;
  if (!requireFiles() || !finishInline(true)) return;
  const previousFocus = document.activeElement as HTMLElement;
  const previousName = folder?.displayPath.split(/[\\/]/).filter(Boolean).pop();
  let succeeded = false;
  busy = true;
  editor.dispatch({
    effects: readonly.reconfigure(EditorState.readOnly.of(true)),
  });
  status();
  try {
    await flushEdits();
    const next = await invoke<Folder>("navigate_folder", {
      id: current.id,
      revision: current.revision,
      action,
      entry: entry ?? null,
    });
    folder = next;
    renderFolder();
    showSidebar(true);
    succeeded = true;
    el("error").hidden = true;
  } catch (e) {
    error(e);
  } finally {
    await refreshFavorites();
    busy = false;
    editor.dispatch({
      effects: readonly.reconfigure(EditorState.readOnly.of(current.readOnly)),
    });
    status();
    if (!succeeded) {
      (action === "favorite"
        ? Array.from(
            el("favorites-list").querySelectorAll<HTMLButtonElement>(
              ".favorite-open",
            ),
          ).find((b) => b.dataset.path === entry)
        : previousFocus
      )?.focus();
    } else {
      const target =
        action === "locate"
          ? el("folder-files").querySelector<HTMLElement>("[aria-current=page]")
          : action === "up"
            ? [
                ...el("folder-directories").querySelectorAll<HTMLElement>(
                  "button",
                ),
              ].find((button) => button.dataset.name === previousName)
            : el("folder-up");
      (target || el("tab-files")).focus();
      target?.scrollIntoView({ block: "nearest" });
    }
  }
}
async function openFolder() {
  if (busy || !homeVisible || el<HTMLDialogElement>("settings-dialog").open)
    return;
  if (!requireFiles()) return;
  busy = true;
  status();
  try {
    const selected = await invoke<Folder | null>("select_folder", {
      id: current.id,
      revision: current.revision,
    });
    if (selected) {
      showHome(false);
      folder = selected;
      folderWaiting = true;
      renderFolder();
      showSidebar(true);
    }
    el("error").hidden = true;
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    status();
    if (homeVisible) el("home-folder").focus();
    else
      (
        el("folder-directories").querySelector<HTMLButtonElement>("button") ||
        el("folder-files").querySelector<HTMLButtonElement>("button") ||
        el("folder-home")
      ).focus();
  }
}
const inlineTheme = new Compartment();
function sourceBlock(target: Element | null) {
  // Fences carry token attributes on code as well as pre; edit the whole block.
  const block =
    target?.closest<HTMLElement>("pre[data-end-line]") ||
    target?.closest<HTMLElement>("[data-end-line]");
  return block && preview.contains(block) ? block : null;
}
function updatePreviewEditControls() {
  for (const button of preview.querySelectorAll<HTMLButtonElement>(
    "[data-document-edit]",
  )) {
    button.disabled =
      busy ||
      current.readOnly ||
      !!inline ||
      renderedSource !== current.content;
    button.title = current.readOnly
      ? current.readOnlyReason
      : inline
        ? t("请先应用或取消当前块草稿。")
        : "";
  }
}
function startInline(
  target = inlineTarget,
  tableMode: "edit" | "insert" | "flow" | null = null,
) {
  if (current.readOnly) {
    error(current.readOnlyReason);
    return;
  }
  if (
    busy ||
    homeVisible ||
    folderWaiting ||
    document.querySelector("dialog[open]")
  )
    return;
  let tablePosition: number | null = null;
  const sourceCaret =
    tableMode === "insert" &&
    !inline &&
    !reading &&
    !(inlinePoint?.id === current.id && inlinePoint.source === current.content)
      ? editor.state.selection.main.head
      : null;
  let tableDraftLength = 0;
  if (inline) {
    if (tableMode === "insert") {
      if (inline.rich?.active && !inline.rich.sync()) return;
      tableDraftLength = blockReplacement(
        inline.original,
        inline.view.state.doc.toString(),
      ).length;
      tablePosition = inline.from + tableDraftLength;
    }
    if (!finishInline(true) || !tableMode) return;
  }
  if (renderedSource !== current.content) {
    if (
      tableMode === "insert" &&
      (sourceCaret !== null || tablePosition !== null)
    )
      renderPreview();
    else {
      error(t("预览映射已过期，请刷新预览后重新选择编辑块。"));
      return;
    }
  }
  if (!mode(true, true)) return;
  if (
    (!tableMode || tableMode === "insert") &&
    (!target?.isConnected || !preview.contains(target))
  ) {
    const top = previewScroll.getBoundingClientRect().top;
    target =
      (inlinePoint?.id === current.id && inlinePoint.source === current.content
        ? preview.querySelector<HTMLElement>(
            `[data-line="${inlinePoint.line}"][data-end-line]`,
          )
        : null) ||
      [...preview.querySelectorAll<HTMLElement>("[data-end-line]")].find(
        (node) => node.getBoundingClientRect().bottom >= top + 24,
      ) ||
      null;
  }
  const source = current.content;
  let range = { from: 0, to: source.length };
  let inserted = "";
  try {
    if (tableMode === "insert") {
      let position = 0;
      if (tablePosition !== null)
        position = tableDraftLength
          ? tableInsertionPosition(source, tablePosition - 1)
          : tablePosition;
      else if (sourceCaret !== null)
        position = tableInsertionPosition(source, sourceCaret);
      else if (target)
        position = tableInsertionPosition(
          source,
          blockRange(
            source,
            Number(target.dataset.line),
            Number(target.dataset.endLine),
          ).from,
        );
      inserted = newTable(source.slice(0, position));
      if (position < source.length && source[position] !== "\n")
        inserted += "\n";
      range = { from: position, to: position };
    } else if (target)
      range = blockRange(
        source,
        Number(target.dataset.line),
        Number(target.dataset.endLine),
      );
    if (tableMode === "edit") parseTable(source.slice(range.from, range.to));
  } catch {
    error(
      tableMode
        ? t(
            "表格无法安全编辑或插入。请先用源码修正规则表格、闭合末尾代码块，并刷新预览。",
          )
        : t("预览映射已过期，请刷新预览后重新选择编辑块。"),
    );
    return;
  }
  const original = source.slice(range.from, range.to);
  const richOffset =
    inlinePoint?.id === current.id &&
    inlinePoint.source === source &&
    inlinePoint.line === target?.dataset.line
      ? inlinePoint.offset
      : 0;
  const richAnchor =
    inlinePoint?.id === current.id &&
    inlinePoint.source === source &&
    inlinePoint.line === target?.dataset.line
      ? (inlinePoint.anchor ?? richOffset)
      : richOffset;
  const codeOffset =
    inlinePoint?.id === current.id &&
    inlinePoint.source === source &&
    inlinePoint.line === target?.dataset.line &&
    inlinePoint.codeOffset !== null
      ? codeSourcePosition(
          original,
          target?.querySelector("code")?.textContent || "",
          inlinePoint.codeOffset,
        )
      : null;
  const codeAnchor =
    codeOffset !== null && inlinePoint?.codeAnchor != null
      ? codeSourcePosition(
          original,
          target?.querySelector("code")?.textContent || "",
          inlinePoint.codeAnchor,
        )
      : codeOffset;
  const host = document.createElement("section");
  host.className = "inline-editor";
  host.setAttribute(
    "aria-label",
    tableMode === "flow"
      ? t("Mermaid 可视化编辑")
      : tableMode
        ? t("编辑表格")
        : t("就地编辑"),
  );
  const tools = document.createElement("div");
  tools.className = "inline-tools";
  const title = document.createElement("strong");
  title.textContent =
    tableMode === "flow"
      ? t("Mermaid 可视化编辑")
      : tableMode
        ? t("编辑表格")
        : t("就地编辑");
  const apply = document.createElement("button");
  apply.id = "inline-apply";
  apply.textContent = t("应用并预览");
  const cancel = document.createElement("button");
  cancel.id = "inline-cancel";
  cancel.textContent = t("取消本次编辑");
  const hint = document.createElement("p");
  hint.className = "inline-hint";
  hint.textContent = t(
    "块草稿尚未写回文档。Ctrl+Enter 应用，Esc 取消；保存或离开会先应用，再执行保存保护。",
  );
  const mount = document.createElement("div");
  mount.id = "inline-source";
  tools.append(title, apply, cancel);
  host.append(tools, hint, mount);
  const container = target?.closest<HTMLElement>(".table-scroll") || target;
  if (tableMode === "insert") {
    const next = [
      ...preview.querySelectorAll<HTMLElement>("[data-line][data-end-line]"),
    ].find(
      (node) =>
        blockRange(
          source,
          Number(node.dataset.line),
          Number(node.dataset.endLine),
        ).from >= range.from,
    );
    if (next) (next.closest(".table-scroll") || next).before(host);
    else preview.append(host);
  } else if (container) {
    container.before(host);
    container.hidden = true;
  } else {
    preview.replaceChildren(host);
  }
  const view = new EditorView({
    parent: mount,
    state: EditorState.create({
      doc: inserted || original,
      selection: {
        anchor: !tableMode ? (codeAnchor ?? 0) : 0,
        head: !tableMode ? (codeOffset ?? 0) : 0,
      },
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        keymap.of([indentWithTab]),
        inlineTheme.of(editorTheme()),
        readonly.of(EditorState.readOnly.of(false)),
        editorLanguageExtensions(),
        EditorView.contentAttributes.of({ "aria-label": t("就地源码") }),
        EditorView.updateListener.of((update) => {
          maybeSlash(update);
          if (
            update.docChanged ||
            update.transactions.some((tr) => tr.effects.length)
          )
            inline?.rich?.refresh();
          if (update.docChanged || update.selectionSet) status();
        }),
      ],
    }),
  });
  previewSearch.close();
  inline = { view, host, source, id: current.id, ...range, original };
  apply.onclick = () => finishInline(true);
  cancel.onclick = () => finishInline(false);
  host.addEventListener("keydown", (event) => {
    if (
      event.isComposing ||
      view.compositionStarted ||
      inline?.table?.composing ||
      inline?.rich?.composing ||
      event.keyCode === 229
    )
      return;
    if (event.key === "Escape" && view.dom.querySelector(".cm-search")) return;
    if (event.key === "Escape" || (event.key === "Enter" && event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      finishInline(event.key !== "Escape");
    }
  });
  el("inline-mode").setAttribute("aria-pressed", "true");
  el("read-mode").setAttribute("aria-pressed", "false");
  el("split-mode").setAttribute("aria-pressed", "false");
  linkPreview.hide();
  view.focus();
  if (!tableMode && target && canEditRich(target)) {
    inline.rich = setupRichEditor(
      host,
      target,
      view,
      error,
      richOffset,
      richAnchor,
    );
    const toggle = document.createElement("button");
    toggle.id = "inline-source-toggle";
    toggle.textContent = t("源码编辑");
    toggle.onclick = () => {
      if (inline?.rich?.source()) toggle.hidden = true;
    };
    tools.append(toggle);
  }
  if (tableMode)
    inline.table =
      tableMode === "flow"
        ? setupFlowEditor(host, view)
        : setupTableEditor(host, view);
  host.scrollIntoView({ block: "nearest" });
  status();
}
function finishInline(commit: boolean) {
  if (busy && inline) return false;
  if (!inline) return true;
  if (
    inline.view.compositionStarted ||
    inline.table?.composing ||
    inline.rich?.composing
  ) {
    error(t("请先完成输入法组合，再应用或离开就地编辑。"));
    return false;
  }
  if (commit && inline.rich?.active && !inline.rich.sync()) return false;
  const draft = inline;
  if (commit && draft.table && !draft.table.valid()) {
    error(
      draft.host.querySelector(".flow-editor")
        ? t("流程图输入无效，请修正后应用，或取消草稿。")
        : t(
            "表格无法安全编辑或插入。请先用源码修正规则表格、闭合末尾代码块，并刷新预览。",
          ),
    );
    return false;
  }
  if (
    commit &&
    (draft.id !== current.id ||
      draft.source !== current.content ||
      editor.state.doc.toString() !== draft.source)
  ) {
    error(t("文档已变化，无法应用旧块。请复制草稿后取消，再重新选择编辑块。"));
    return false;
  }
  const text = blockReplacement(
    draft.original,
    draft.view.state.doc.toString(),
  );
  const scroll = previewScroll.scrollTop;
  inline = null;
  draft.rich?.destroy();
  draft.view.destroy();
  draft.host.remove();
  reflectModes();
  if (commit && text !== draft.original)
    editor.dispatch({
      changes: { from: draft.from, to: draft.to, insert: text },
      selection: { anchor: draft.from },
      annotations: isolateHistory.of("full"),
    });
  renderPreview();
  previewScroll.scrollTop = scroll;
  status();
  el("inline-mode").focus();
  return true;
}
function reflectModes() {
  const editing = !!inline || inlineSelected;
  el("inline-mode").setAttribute("aria-pressed", String(editing));
  el("read-mode").setAttribute("aria-pressed", String(reading && !editing));
  el("split-mode").setAttribute("aria-pressed", String(!reading && !editing));
}
function selectInlineMode() {
  if (!inline) startInline();
  if (inline) {
    inlineSelected = true;
    reflectModes();
    if (inline.rich?.active) inline.rich.focus();
    else inline.view.focus();
  }
}
function mode(read: boolean, keepInlineSelection = false) {
  if (!finishInline(true)) return false;
  if (!keepInlineSelection) inlineSelected = false;
  reflectModes();
  if (!read) previewSearch.close();
  // A mode change can precede the debounced source preview. Refresh its mapping
  // before the user selects an editing block in the newly visible reading pane.
  if (
    read &&
    renderedSource !== current.content &&
    current.content.length <= 1024 * 1024
  )
    renderPreview();
  if (reading === read) {
    if (!read) editor.focus();
    return true;
  }
  const top = previewScroll.getBoundingClientRect().top;
  const anchor = [...preview.querySelectorAll<HTMLElement>("[data-line]")].find(
    (node) => node.getBoundingClientRect().bottom >= top + 24,
  );
  const offset = anchor ? anchor.getBoundingClientRect().top - top : 0;
  const id = current.id;
  scrollLock = performance.now() + 200;
  reading = read;
  scheduleStatistics();
  followOutline();
  document.body.classList.toggle("reading", read);
  reflectModes();
  requestAnimationFrame(() => {
    if (current.id !== id || reading !== read || !anchor?.isConnected) return;
    previewScroll.scrollTop +=
      anchor.getBoundingClientRect().top -
      previewScroll.getBoundingClientRect().top -
      offset;
  });
  if (!read) {
    editor.requestMeasure();
    editor.focus();
  }
  return true;
}
function sourceLine(line: number, select = false) {
  const from = editor.state.doc.line(
    Math.min(Math.max(1, line), editor.state.doc.lines),
  ).from;
  editor.dispatch({
    ...(select ? { selection: { anchor: from } } : {}),
    effects: EditorView.scrollIntoView(from, { y: "start" }),
  });
}
async function init() {
  loadSettings();
  try {
    setLocale(await invoke<Locale>("set_ui_language", { language }));
  } catch (error) {
    settingsMessage(
      t("语言未应用：{0}。请重新选择或重启重试。", [String(error)]),
      true,
    );
  }
  applyStaticLanguage();
  el("settings-message").textContent = t(
    el("settings-message").textContent || "",
  );
  reflectSettings();
  try {
    await invoke("set_title_format", { format: titleFormat });
  } catch (error) {
    settingsMessage(
      t("标题栏格式未应用：{0}。请重新选择或重启重试。", [String(error)]),
      true,
    );
  }
  current = await invoke<Snapshot>("document_state");
  acknowledgedRevision = current.revision;
  editor = new EditorView({
    state: makeState(current.content),
    parent: el("editor"),
  });
  // Clicking the source pane supersedes the last preview caret (also in split mode).
  editor.dom.addEventListener("focusin", () => {
    inlinePoint = null;
  });
  document.addEventListener("selectionchange", scheduleStatistics);
  document.addEventListener("focusin", scheduleStatistics);
  document.addEventListener("focusout", scheduleStatistics);
  if (current.content.length <= 1024 * 1024) renderPreview();
  else schedulePreview();
  await refreshHistory();
  await refreshFavorites();
  status();
  showHome(!current.path && !current.dirty && !current.content);
  if (!homeVisible) mode(true);
  void getVersion()
    .then((version) => {
      el("home-version").textContent = `v${version}`;
      el("release-version").textContent = `v${version}`;
    })
    .catch(() => {
      el("home-version").textContent = t("版本不可用");
      el("release-version").textContent = t("版本不可用");
    });
  el("home-open").onclick = () => void command("open");
  el("home-new").onclick = () => void command("new-file");
  el("home-folder").onclick = () => void openFolder();
  el("home-history").onclick = () => openHomeHistory();
  el("home-favorites").onclick = () => openHomeHistory(true);
  el("tab-favorites").onclick = () => showSidebar("favorites");
  el("favorite-file").onclick = () => void toggleFavorite("file");
  el("favorite-folder").onclick = () => void toggleFavorite("folder");
  initFavoriteMenu();
  setupSnippets();
  setupAttachments();
  let diagramStyle = "";
  new MutationObserver(() => {
    const style = getComputedStyle(document.documentElement);
    const key = [
      document.documentElement.dataset.theme,
      style.getPropertyValue("--surface"),
      style.getPropertyValue("--text"),
    ].join("|");
    if (key === diagramStyle) return;
    diagramStyle = key;
    if (!inline && preview.querySelector(".diagram, [data-diagram-status]")) {
      const scroll = previewScroll.scrollTop;
      renderPreview();
      previewScroll.scrollTop = scroll;
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style"],
  });
  window.addEventListener("mdmd-engines-changed", () => {
    resetSyntax();
    resetMath();
    resetDiagrams();
    if (!inline) renderPreview();
  });
  el<HTMLSelectElement>("format-action").onchange = (event) => {
    const select = event.target as HTMLSelectElement;
    const action = select.value;
    select.value = "";
    if (Object.hasOwn(formatActions, action)) runFormat(action as FormatAction);
  };
  el("format-action").addEventListener("pointerdown", rememberFormatSelection);
  el("tab-history").onclick = () => showSidebar("history");
  el("history-retry").onclick = async () => {
    if (busy) return;
    busy = true;
    status();
    await refreshHistory(true);
    busy = false;
    status();
  };
  el("folder-home").onclick = () => void command("home");
  el("tab-files").onclick = () => showSidebar(true);
  el("tab-outline").onclick = () => showSidebar(false);
  el("folder-up").onclick = () => void navigateFolder("up");
  el("folder-locate").onclick = () => void navigateFolder("locate");
  el("focus-toggle").onclick = () => {
    if (!busy && !folderWaiting) setFocusMode(!focusMode);
  };
  el("focus-exit").onclick = () => setFocusMode(false);
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        focusMode &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !document.querySelector("dialog[open], :popover-open, .cm-search")
      ) {
        event.preventDefault();
        event.stopPropagation();
        setFocusMode(false);
      }
    },
    true,
  );
  for (const key of Object.keys(
    toolbarDefaults,
  ) as (keyof typeof toolbarDefaults)[]) {
    el<HTMLInputElement>(`setting-tools-${key}`).onchange = (event) =>
      saveSettings(
        theme,
        showWordCount,
        typography,
        navigation,
        shortcuts,
        appearance,
        customCss,
        titleFormat,
        language,
        showLinkPreview,
        autoSave,
        {
          ...toolbarVisibility,
          [key]: (event.target as HTMLInputElement).checked,
        },
      );
  }
  el("home-settings").onclick = openSettings;
  el("document-settings").onclick = openSettings;
  const settings = el<HTMLDialogElement>("settings-dialog");
  el("settings-close").onclick = () => settings.close();
  settings.addEventListener("close", () => {
    cancelRecording();
    const target = settingsReturnFocus?.getClientRects().length
      ? settingsReturnFocus
      : el(homeVisible ? "home-settings" : "document-settings");
    target.focus();
  });
  const fontDialog = el<HTMLDialogElement>("font-dialog");
  const paletteDialog = el<HTMLDialogElement>("palette-dialog");
  const cssDialog = el<HTMLDialogElement>("css-dialog");
  setupIntegration(() => linkPreview.hide());
  setupAppIcon();
  setupFeedback();
  setupVersions(
    async () => {
      if (busy || homeVisible || folderWaiting || !finishInline(true))
        return null;
      await flushEdits();
      return {
        id: current.id,
        revision: current.revision,
        content: current.content,
        name: current.name,
      };
    },
    (snapshot, content) => {
      if (
        busy ||
        inline ||
        current.readOnly ||
        current.id !== snapshot.id ||
        current.revision !== snapshot.revision ||
        current.content !== snapshot.content
      )
        return false;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
        annotations: isolateHistory.of("full"),
      });
      autoPaused = true;
      autoDue = 0;
      renderPreview();
      status();
      return true;
    },
  );
  setupOutput(async () => {
    if (busy || homeVisible || folderWaiting || !finishInline(true))
      return null;
    await flushEdits();
    if (renderedSource !== current.content) renderPreview();
    return {
      id: current.id,
      revision: current.revision,
      content: current.content,
      name: current.name,
    };
  }, preview);
  setupEngines(() => linkPreview.hide());
  for (const dialog of [
    settings,
    fontDialog,
    paletteDialog,
    cssDialog,
    el<HTMLDialogElement>("integration-dialog"),
    el<HTMLDialogElement>("engines-dialog"),
  ])
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const stops = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        ),
      ].filter(
        (element) =>
          element.getClientRects().length > 0 &&
          (!(element instanceof HTMLInputElement) ||
            element.type !== "radio" ||
            element.checked),
      );
      const first = stops[0],
        last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  for (const section of [
    "appearance",
    "typography",
    "general",
    "shortcuts",
    "feedback",
  ]) {
    el(`settings-${section}`).onclick = () => {
      cancelRecording();
      for (const name of [
        "appearance",
        "typography",
        "general",
        "shortcuts",
        "feedback",
      ]) {
        el(`settings-${name}-content`).hidden = name !== section;
        el(`settings-${name}`).toggleAttribute(
          "aria-current",
          name === section,
        );
        if (name === section)
          el(`settings-${name}`).setAttribute("aria-current", "page");
      }
      el("settings-section-title").textContent =
        section === "appearance"
          ? t("外观")
          : section === "typography"
            ? t("排版")
            : section === "general"
              ? t("通用")
              : section === "shortcuts"
                ? t("快捷键")
                : t("问题反馈");
      el("settings-autosave-note").hidden = section === "feedback";
      el("settings-message").hidden = section === "feedback";
      if (section === "feedback") reflectFeedback();
      el("settings-content").scrollTop = 0;
      el("settings-content").focus();
    };
  }
  el<HTMLSelectElement>("setting-palette").onchange = (event) =>
    saveSettings(theme, showWordCount, typography, navigation, shortcuts, {
      ...appearance,
      palette: (event.target as HTMLSelectElement).value,
    });
  el<HTMLSelectElement>("setting-corners").onchange = (event) =>
    saveSettings(theme, showWordCount, typography, navigation, shortcuts, {
      ...appearance,
      corners: (event.target as HTMLSelectElement)
        .value as Appearance["corners"],
    });
  el("palette-manage").onclick = () => {
    if (settingsBlocked) return;
    paletteDraft = structuredClone(appearance);
    showPaletteDraft();
    paletteDialog.showModal();
    el("palette-select").focus();
  };
  el<HTMLSelectElement>("palette-select").onchange = (event) => {
    paletteDraft.palette = (event.target as HTMLSelectElement).value;
    showPaletteDraft();
  };
  el<HTMLInputElement>("palette-name").oninput = (event) => {
    const selected = paletteDraft.custom.find(
      (p) => p.id === paletteDraft.palette,
    );
    if (selected) {
      selected.name = (event.target as HTMLInputElement).value;
      el<HTMLSelectElement>("palette-select").selectedOptions[0].textContent =
        selected.name || t("未命名");
    }
  };
  el("palette-copy").onclick = () => {
    if (paletteDraft.custom.length >= 20) return;
    const source =
      paletteDraft.custom.find((p) => p.id === paletteDraft.palette) ||
      defaultColors;
    let n = 1;
    while (paletteDraft.custom.some((p) => p.name === t("自定义配色 {0}", [n])))
      n++;
    const id = crypto.randomUUID();
    paletteDraft.custom.push({
      id,
      name: t("自定义配色 {0}", [n]),
      light: { ...source.light },
      dark: { ...source.dark },
    });
    paletteDraft.palette = id;
    showPaletteDraft();
    el("palette-name").focus();
  };
  el("palette-delete").onclick = () => {
    paletteDraft.custom = paletteDraft.custom.filter(
      (p) => p.id !== paletteDraft.palette,
    );
    paletteDraft.palette = "default";
    showPaletteDraft();
    el("palette-select").focus();
  };
  el("palette-apply").onclick = () => {
    const error = appearanceError(paletteDraft);
    if (error) {
      el("palette-message").textContent = error;
      return;
    }
    if (
      saveSettings(
        theme,
        showWordCount,
        typography,
        navigation,
        shortcuts,
        paletteDraft,
      )
    )
      paletteDialog.close();
    else
      el("palette-message").textContent = t(
        "保存失败，当前配色未变；草稿保留，可重试或取消。",
      );
  };
  el("palette-cancel").onclick = () => paletteDialog.close();
  paletteDialog.addEventListener("close", () => el("palette-manage").focus());
  el<HTMLInputElement>("setting-custom-css").onchange = (event) =>
    saveSettings(
      theme,
      showWordCount,
      typography,
      navigation,
      shortcuts,
      appearance,
      { ...customCss, enabled: (event.target as HTMLInputElement).checked },
    );
  el("css-edit").onclick = () => {
    if (settingsBlocked) return;
    el<HTMLTextAreaElement>("css-source").value = customCss.source;
    el<HTMLInputElement>("css-enabled").checked = customCss.enabled;
    el("css-message").textContent = "";
    cssDialog.showModal();
    el("css-source").focus();
    cssDialog.scrollTop = 0;
  };
  el("css-default").onclick = () => {
    el<HTMLTextAreaElement>("css-source").value = "";
    el<HTMLInputElement>("css-enabled").checked = false;
    el("css-message").textContent = t(
      "已清空草稿并关闭启用；点击应用后保存，取消可保留原设置。",
    );
  };
  el("css-apply").onclick = () => {
    const draft: CustomCss = {
      enabled: el<HTMLInputElement>("css-enabled").checked,
      source: el<HTMLTextAreaElement>("css-source").value,
    };
    if (
      saveSettings(
        theme,
        showWordCount,
        typography,
        navigation,
        shortcuts,
        appearance,
        draft,
      )
    )
      cssDialog.close();
    else el("css-message").textContent = el("settings-message").textContent;
  };
  el("css-cancel").onclick = () => cssDialog.close();
  cssDialog.addEventListener("close", () => el("css-edit").focus());
  systemTheme.addEventListener("change", () => {
    if (theme === "system") applyTheme();
  });
  el<HTMLSelectElement>("setting-language").onchange = async (event) => {
    const next = (event.target as HTMLSelectElement).value;
    if (settingsBlocked || languagePending || !validLanguage(next)) return;
    const previous = language;
    languagePending = true;
    reflectSettings();
    try {
      const locale = await invoke<Locale>("set_ui_language", {
        language: next,
      });
      if (
        saveSettings(
          theme,
          showWordCount,
          typography,
          navigation,
          shortcuts,
          appearance,
          customCss,
          titleFormat,
          next,
        )
      ) {
        setLocale(locale);
        refreshLanguage();
        settingsMessage(t("已保存"));
      } else {
        await invoke("set_ui_language", { language: previous });
      }
    } catch (error) {
      settingsMessage(
        t("语言未应用：{0}。请重新选择或重启重试。", [String(error)]),
        true,
      );
    } finally {
      languagePending = false;
      reflectSettings();
    }
  };
  window.addEventListener("focus", async () => {
    if (language !== "system" || languagePending || busy) return;
    languagePending = true;
    reflectSettings();
    try {
      const locale = await invoke<Locale>("set_ui_language", {
        language: "system",
      });
      if (locale !== getLocale()) {
        setLocale(locale);
        refreshLanguage();
      }
    } catch (error) {
      settingsMessage(
        t("语言未应用：{0}。请重新选择或重启重试。", [String(error)]),
        true,
      );
    } finally {
      languagePending = false;
      reflectSettings();
    }
  });
  el<HTMLSelectElement>("setting-title-format").onchange = async (event) => {
    const next = (event.target as HTMLSelectElement).value as TitleFormat;
    if (
      settingsBlocked ||
      titleFormatPending ||
      !["path", "name"].includes(next)
    )
      return;
    const previous = titleFormat;
    titleFormatPending = true;
    reflectSettings();
    try {
      await invoke("set_title_format", { format: next });
      if (
        !saveSettings(
          theme,
          showWordCount,
          typography,
          navigation,
          shortcuts,
          appearance,
          customCss,
          next,
        )
      ) {
        await invoke("set_title_format", { format: previous });
      }
    } catch (error) {
      settingsMessage(
        t("标题栏格式未完成：{0}。设置原值保留，请重新选择或重启重试。", [
          String(error),
        ]),
        true,
      );
    } finally {
      titleFormatPending = false;
      reflectSettings();
    }
  };
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    'input[name="theme"]',
  )) {
    radio.onchange = () => saveSettings(radio.value as Theme, showWordCount);
  }
  el<HTMLInputElement>("setting-link-preview").onchange = (event) => {
    saveSettings(
      theme,
      showWordCount,
      typography,
      navigation,
      shortcuts,
      appearance,
      customCss,
      titleFormat,
      language,
      (event.target as HTMLInputElement).checked,
    );
  };
  el<HTMLInputElement>("setting-autosave").onchange = (event) => {
    saveSettings(
      theme,
      showWordCount,
      typography,
      navigation,
      shortcuts,
      appearance,
      customCss,
      titleFormat,
      language,
      showLinkPreview,
      (event.target as HTMLInputElement).checked,
    );
  };
  el<HTMLInputElement>("setting-double-click-edit").onchange = (event) => {
    saveSettings(
      theme,
      showWordCount,
      typography,
      navigation,
      shortcuts,
      appearance,
      customCss,
      titleFormat,
      language,
      showLinkPreview,
      autoSave,
      toolbarVisibility,
      (event.target as HTMLInputElement).checked,
    );
  };
  el<HTMLInputElement>("setting-task-strike").onchange = (event) =>
    saveSettings(
      theme,
      showWordCount,
      typography,
      navigation,
      shortcuts,
      appearance,
      customCss,
      titleFormat,
      language,
      showLinkPreview,
      autoSave,
      toolbarVisibility,
      doubleClickEdit,
      (event.target as HTMLInputElement).checked,
    );
  el<HTMLInputElement>("setting-wordcount").onchange = (event) => {
    const checkbox = event.target as HTMLInputElement;
    saveSettings(theme, checkbox.checked);
  };
  for (const key of ["history", "favorites", "files"] as const) {
    el<HTMLInputElement>(`setting-${key}`).onchange = (event) => {
      saveSettings(theme, showWordCount, typography, {
        ...navigation,
        [key]: (event.target as HTMLInputElement).checked,
      });
    };
  }
  for (const key of typographyStepKeys) {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      `[data-step="${key}"]`,
    )) {
      button.onclick = () => {
        const { min, max, step } = typographySteps[key];
        const value = Math.max(
          min,
          Math.min(
            max,
            typography[key] + Number(button.dataset.direction) * step,
          ),
        );
        saveSettings(theme, showWordCount, { ...typography, [key]: value });
      };
    }
    el(`reset-${key}`).onclick = () =>
      saveSettings(theme, showWordCount, {
        ...typography,
        [key]: typographyDefaults[key],
      });
  }
  for (const key of [
    "codeLineNumbers",
    "codeWrap",
    "swapPanes",
    "softBreaks",
  ] as const)
    el<HTMLInputElement>(`setting-${key}`).onchange = (event) =>
      saveSettings(theme, showWordCount, {
        ...typography,
        [key]: (event.target as HTMLInputElement).checked,
      });
  let fontTarget: "bodyFont" | "codeFont" = "bodyFont";
  const fontInput = el<HTMLInputElement>("font-name");
  function fontSample() {
    const name = fontInput.value.trim();
    el("font-preview").style.fontFamily = fontFamily(
      validFont(name) ? name : "",
      fontTarget === "bodyFont" ? bodyFallback : codeFallback,
    );
  }
  for (const key of ["bodyFont", "codeFont"] as const) {
    el(`choose-${key}`).onclick = () => {
      if (settingsBlocked) return;
      fontTarget = key;
      el("font-title").textContent =
        key === "bodyFont" ? t("选择正文字体") : t("选择代码字体");
      fontInput.value = typography[key];
      el("font-message").textContent = "";
      fontSample();
      fontDialog.showModal();
      fontInput.focus();
    };
  }
  fontInput.oninput = fontSample;
  const applyFont = (name: string) => {
    if (!validFont(name)) {
      el("font-message").textContent = t(
        "请输入不超过 80 个字符的单个字体名，不含控制字符、引号、反斜杠、逗号或 CSS 分隔符。",
      );
      return;
    }
    if (
      saveSettings(theme, showWordCount, { ...typography, [fontTarget]: name })
    )
      fontDialog.close();
    else el("font-message").textContent = el("settings-message").textContent;
  };
  el("font-apply").onclick = () => applyFont(fontInput.value.trim());
  el("font-default").onclick = () => applyFont("");
  el("font-cancel").onclick = () => fontDialog.close();
  fontDialog.addEventListener("close", () => {
    if (settings.open) el(`choose-${fontTarget}`).focus();
  });
  el("home-back").onclick = () => void command("home");
  for (const id of ["open", "new", "save", "save-as", "reload"])
    el(id).onclick = () => void command(id);
  el("notice-copy").onclick = () =>
    void command(current.readOnly ? "editable-copy" : "save-as");
  el("notice-normalize").onclick = () => void command("normalize-newlines");
  el("dismiss-error").onclick = () => {
    el("error").hidden = true;
  };
  el("external-edit").onclick = () => void command("external-edit");
  const externalDialog = el<HTMLDialogElement>("external-dialog");
  let externalPending = false;
  async function configureExternal(action: string) {
    if (externalPending) return;
    externalPending = true;
    for (const id of ["external-choose", "external-default", "external-close"])
      el<HTMLButtonElement>(id).disabled = true;
    try {
      const state = await invoke<{
        executable: string;
        custom: boolean;
        warning: string | null;
      }>("configure_external_editor", { action });
      el("external-path").textContent = state.executable;
      el("external-message").textContent =
        state.warning || t("外部编辑器配置已就绪");
    } catch (e) {
      el("external-message").textContent = String(e);
    } finally {
      externalPending = false;
      for (const id of [
        "external-choose",
        "external-default",
        "external-close",
      ])
        el<HTMLButtonElement>(id).disabled = false;
    }
  }
  el("external-options").onclick = () => {
    if (busy) return;
    externalDialog.showModal();
    void configureExternal("state");
  };
  el("external-choose").onclick = () => void configureExternal("choose");
  el("external-default").onclick = () => void configureExternal("default");
  el("external-close").onclick = () => externalDialog.close();
  externalDialog.addEventListener("cancel", (event) => {
    if (externalPending) event.preventDefault();
  });
  externalDialog.addEventListener("close", () =>
    el("external-options").focus(),
  );
  el("inline-mode").onclick = () => selectInlineMode();
  el("insert-table").onclick = () => startInline(null, "insert");
  el("read-mode").onclick = () => mode(true);
  el("split-mode").onclick = () => mode(false);
  el("preview-find").onclick = () => {
    if (!inline) previewSearch.open();
  };
  el("find").onclick = () => {
    if (inline) {
      if (inline.rich?.active) inline.rich.source();
      openSearchPanel(inline.view);
    } else if (reading) previewSearch.open();
    else openSearchPanel(editor);
  };
  el("refresh").onclick = () => {
    resetSyntax();
    resetMath();
    resetDiagrams();
    if (finishInline(true)) renderPreview();
  };
  await listen("request-close", () => void command("close"));
  initShortcuts();
  document.addEventListener("keydown", handleShortcut, true);
  preview.addEventListener("click", (event) => {
    const task = (event.target as Element).closest<HTMLInputElement>(
      "input[data-task-offset]",
    );
    if (task) {
      event.preventDefault();
      if (
        busy ||
        inline ||
        current.readOnly ||
        renderedSource !== current.content ||
        document.querySelector("dialog[open]")
      )
        return;
      try {
        editor.dispatch({
          changes: taskChange(current.content, Number(task.dataset.taskOffset)),
          annotations: isolateHistory.of("full"),
        });
        renderPreview();
        el("inline-mode").focus();
      } catch {
        error(t("任务位置已变化，请刷新后重试。"));
      }
      return;
    }
    // Diagram buttons own their actions. Bubbling into block navigation would
    // immediately replace a newly opened visual editor with a source editor.
    if (
      (event.target as Element).closest(
        ".inline-editor, .diagram-controls, [data-preview-tool]",
      )
    )
      return;
    inlineTarget = sourceBlock(event.target as Element);
    rememberInlinePoint(inlineTarget);
    if (
      !inline &&
      inlineSelected &&
      inlineTarget &&
      !(event.target as Element).closest("a, .embedded-body, .footnotes")
    ) {
      event.preventDefault();
      startInline(inlineTarget);
      return;
    }
    if (
      inline &&
      inlineTarget &&
      !(event.target as Element).closest("a, .embedded-body, .footnotes")
    ) {
      event.preventDefault();
      const line = Number(inlineTarget.dataset.line),
        end = Number(inlineTarget.dataset.endLine);
      const offset = richCaretOffset(inlineTarget) ?? 0;
      const anchor = richCaretOffset(inlineTarget, "anchor");
      const codeAnchor = inlinePoint?.codeAnchor;
      const codeOffset =
        inlinePoint &&
        inlinePoint.line === inlineTarget.dataset.line &&
        inlinePoint.source === inline.source
          ? inlinePoint.codeOffset
          : null;
      const from = blockRange(inline.source, line, end).from;
      if (inline.rich?.active && !inline.rich.sync()) return;
      const replacement = blockReplacement(
        inline.original,
        inline.view.state.doc.toString(),
      );
      const shift =
        from >= inline.to
          ? replacement.split("\n").length - inline.original.split("\n").length
          : 0;
      if (replacement !== inline.original) {
        const proposed =
          inline.source.slice(0, inline.from) +
          replacement +
          inline.source.slice(inline.to);
        const targetStillExists = parser
          .parse(proposed, {})
          .some(
            (token) =>
              token.level === 0 &&
              token.nesting !== -1 &&
              !token.hidden &&
              token.map?.[0] === line + shift - 1 &&
              token.map?.[1] === end + shift - 1,
          );
        if (!targetStillExists) {
          error(
            t(
              "草稿改变了目标块边界，请先修正、应用或取消当前草稿，再选择编辑位置。",
            ),
          );
          return;
        }
      }
      if (!finishInline(true)) return;
      const next = preview.querySelector<HTMLElement>(
        `[data-line="${line + shift}"][data-end-line="${end + shift}"]`,
      );
      if (next) {
        inlinePoint = {
          id: current.id,
          source: current.content,
          line: next.dataset.line,
          offset,
          anchor,
          codeOffset,
          codeAnchor,
        };
        startInline(next);
      }
      return;
    }
    const link = (event.target as Element).closest<HTMLAnchorElement>("a");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") || "";
    void openLink(href);
  });
  preview.addEventListener("dblclick", (event) => {
    if (!doubleClickEdit || current.readOnly) return;
    if (
      (event.target as Element).closest(
        "a, input.task-check, .inline-editor, .diagram-controls, [data-preview-tool]",
      )
    )
      return;
    const target = (event.target as Element).closest<HTMLElement>(
      "[data-line]",
    );
    if (target) {
      if (inline) return;
      const block = sourceBlock(target);
      if (block && canEditRich(block)) {
        rememberInlinePoint(block);
        startInline(block);
      } else if (mode(false)) sourceLine(Number(target.dataset.line), true);
    }
  });
  const synced = () =>
    !reading &&
    !el<HTMLDialogElement>("settings-dialog").open &&
    el<HTMLInputElement>("sync-scroll").checked &&
    performance.now() > scrollLock;
  editor.scrollDOM.addEventListener("scroll", () => {
    if (!synced()) return;
    scrollLock = performance.now() + 140;
    const line = editor.state.doc.lineAt(
      editor.lineBlockAtHeight(editor.scrollDOM.scrollTop).from,
    ).number;
    const blocks = [...preview.querySelectorAll<HTMLElement>("[data-line]")];
    const target = blocks.reverse().find((b) => Number(b.dataset.line) <= line);
    if (target)
      previewScroll.scrollTop +=
        target.getBoundingClientRect().top -
        previewScroll.getBoundingClientRect().top -
        24;
  });
  previewScroll.addEventListener("scroll", () => {
    if (!synced()) return;
    scrollLock = performance.now() + 140;
    const top = previewScroll.getBoundingClientRect().top;
    const target = [
      ...preview.querySelectorAll<HTMLElement>("[data-line]"),
    ].find((b) => b.getBoundingClientRect().bottom >= top + 24);
    if (target) sourceLine(Number(target.dataset.line));
  });
  const divider = el("divider");
  const resize = (value: number) => {
    const width = Math.max(25, Math.min(75, value));
    el("panes").style.setProperty("--split", `${width}%`);
    divider.setAttribute("aria-valuenow", String(Math.round(width)));
    reflectSplit();
  };
  let dragStart = 50;
  let dragPointer: number | null = null;
  divider.ondblclick = () => resize(50);
  divider.onpointerdown = (event) => {
    if (event.button !== 0) return;
    dragStart = Number(divider.getAttribute("aria-valuenow"));
    dragPointer = event.pointerId;
    divider.focus();
    divider.setPointerCapture(event.pointerId);
  };
  divider.onpointermove = (event) => {
    if (divider.hasPointerCapture(event.pointerId)) {
      const box = el("panes").getBoundingClientRect();
      const left = ((event.clientX - box.left) / box.width) * 100;
      resize(typography.swapPanes ? 100 - left : left);
    }
  };
  divider.onpointerup = (event) => {
    if (divider.hasPointerCapture(event.pointerId))
      divider.releasePointerCapture(event.pointerId);
    dragPointer = null;
  };
  divider.onpointercancel = () => {
    resize(dragStart);
    dragPointer = null;
  };
  divider.onkeydown = (event) => {
    if (event.key === "Escape" && dragPointer !== null) {
      event.preventDefault();
      resize(dragStart);
      if (divider.hasPointerCapture(dragPointer))
        divider.releasePointerCapture(dragPointer);
      dragPointer = null;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      resize(event.key === "Home" ? 25 : 75);
    }
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      resize(
        Number(divider.getAttribute("aria-valuenow")) +
          (event.key === "ArrowLeft" ? -2 : 2) *
            (typography.swapPanes ? -1 : 1),
      );
    }
  };
  // Enable interaction only after state loading and all handlers are ready.
  setupSidebarResize();
  busy = false;
  editor.dispatch({
    effects: readonly.reconfigure(EditorState.readOnly.of(current.readOnly)),
  });
  status();
  if (homeVisible) el("home-open").focus();
  const checkDisk = async () => {
    if (busy || checkingDisk || !current.path || syncError) return;
    const id = current.id,
      epoch = diskEpoch;
    const relevant = () => current.id === id && diskEpoch === epoch && !busy;
    checkingDisk = true;
    try {
      const external = await invoke<boolean | null>("check_disk", { id });
      if (relevant() && external !== null) {
        current.external = external;
        diskError = "";
        status();
      }
    } catch (e) {
      if (relevant()) {
        diskError = String(e);
        status();
      }
    } finally {
      checkingDisk = false;
    }
  };
  deferAutoSave();
  window.setInterval(tryAutoSave, 250);
  // A completed IME composition gets a fresh quiet interval, including no-text changes.
  document.addEventListener("compositionend", deferAutoSave);
  window.setInterval(checkDisk, 2000);
  window.addEventListener("focus", () => void checkDisk());
}
void init().catch(error);

function editorLanguageExtensions() {
  return [
    EditorView.contentAttributes.of({ "aria-label": t("Markdown 源码") }),
    EditorState.phrases.of(
      getLocale() === "en"
        ? {}
        : {
            Find: "查找",
            Replace: "替换",
            next: "下一个",
            previous: "上一个",
            all: "全部",
            "match case": "区分大小写",
            regexp: "正则表达式",
            "by word": "全词匹配",
            replace: "替换",
            "replace all": "全部替换",
            close: "关闭",
            "Go to line": "跳转到行",
            go: "跳转",
            "current match": "当前匹配",
            "on line": "所在行",
            "replaced match on line $": "已替换第 $ 行匹配",
            "replaced $ matches": "已替换 $ 个匹配",
          },
    ),
  ];
}
function refreshLanguage() {
  linkPreview.hide();
  applyStaticLanguage();
  reflectIntegration();
  reflectEngines();
  reflectFeedback();
  reflectAppIcon();
  const section = document.querySelector<HTMLElement>(
    ".settings-nav [aria-current=page]",
  );
  if (section) el("settings-section-title").textContent = section.textContent;
  initShortcuts();
  reflectSettings();
  renderFolder();
  renderHistory();
  renderFavorites();
  el("refresh").textContent = t(
    current.content.length > 1024 * 1024 && fullCount === null
      ? "内容较大 · 点击刷新"
      : "刷新",
  );
  if (folderWaiting && !folder) {
    el("folder-welcome-title").textContent = t("从{0}选择文档", [
      t(collectionTitle),
    ]);
    el("folder-welcome-detail").textContent = t(
      "点击左侧文件重新打开，也可返回首页选择其他文件。",
    );
  }
  editor.dispatch({
    effects: editorLanguage.reconfigure(editorLanguageExtensions()),
  });
  if (!current.content) renderPreview();
  else {
    refreshOutlineLanguage();
    for (const table of preview.querySelectorAll(".table-scroll"))
      table.setAttribute("aria-label", t("表格，可横向滚动"));
  }
  status();
}
