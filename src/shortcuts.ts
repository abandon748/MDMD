import { formatActions } from "./format-edit.ts";
import { t } from "./i18n.ts";
export const actions = {
  inline: "就地编辑",
  split: "阅读／分屏切换",
  external: "外部编辑",
  strike: formatActions.strike,
  quote: formatActions.quote,
  code: formatActions.code,
  link: formatActions.link,
  table: "插入表格",
  listCycle: formatActions.listCycle,
  settings: "设置",
  clear: formatActions.clear,
  highlight: formatActions.highlight,
  bold: formatActions.bold,
  italic: formatActions.italic,
  open: "打开文件",
  new: "新建文件",
  save: "保存",
  saveAs: "另存为",
  undo: "撤销",
  redo: "重做",
  find: "查找",
  refresh: "刷新预览",
};
export type Action = keyof typeof actions;
export const schemes = {
  mdmd: "MDMD 默认",
  typora: "Typora",
  obsidian: "Obsidian",
};
export type Scheme = keyof typeof schemes;
const base = {
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  strike: "Ctrl+Shift+X",
  quote: "Ctrl+Shift+Q",
  code: "Ctrl+Shift+`",
  link: "Ctrl+K",
  listCycle: "Ctrl+L",
  highlight: "Ctrl+Shift+H",
  clear: "Ctrl+\\",
  open: "Ctrl+O",
  new: "Ctrl+N",
  save: "Ctrl+S",
  saveAs: "Ctrl+Shift+S",
  undo: "Ctrl+Z",
  redo: "Ctrl+Y",
  find: "Ctrl+F",
  split: "F3",
  external: "F4",
  inline: "F2",
  table: "Ctrl+T",
  refresh: "Ctrl+R",
  settings: "Ctrl+,",
};
export const presets: Record<Scheme, Record<Action, string>> = {
  mdmd: { ...base, quote: "", code: "" },
  typora: { ...base, redo: "Ctrl+Shift+Z", inline: "Ctrl+/" },
  obsidian: { ...base, redo: "Ctrl+Shift+Z", inline: "Ctrl+E" },
};
export interface Shortcuts {
  scheme: Scheme;
  overrides: Record<Scheme, Partial<Record<Action, string>>>;
}
export function defaultShortcuts(): Shortcuts {
  return { scheme: "mdmd", overrides: { mdmd: {}, typora: {}, obsidian: {} } };
}
export function bindings(config: Shortcuts) {
  const active = {
    ...presets[config.scheme],
    ...config.overrides[config.scheme],
  };
  // Explicit bindings win; resolve existing defaults before newer actions.
  const added: Action[] = [
    "external",
    "inline",
    "table",
    ...(Object.keys(formatActions) as Action[]),
    // Obsidian used Ctrl+E for split before its preset was corrected to F3.
    "split",
  ];
  for (const action of added) {
    if (
      Object.hasOwn(config.overrides[config.scheme], action) ||
      !presets[config.scheme][action]
    )
      continue;
    const used = Object.entries(active)
      .filter(
        ([other]) =>
          other !== action &&
          !(
            added.indexOf(other as typeof action) > added.indexOf(action) &&
            !config.overrides[config.scheme][other as Action]
          ),
      )
      .map(([, key]) => key);
    active[action] = [
      presets[config.scheme][action],
      "F4",
      "F6",
      "F7",
      "F8",
      "F9",
      "F10",
      "F2",
      "Ctrl+Shift+E",
      "Ctrl+Shift+N",
      "Ctrl+Shift+O",
      "Ctrl+Shift+R",
      "Ctrl+Shift+B",
      "Ctrl+Shift+F",
      ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789"]
        .map((k) => `Ctrl+Shift+${k}`)
        .filter((k) => !combinationError(k)),
    ].find((key) => !used.includes(key))!;
  }
  return active;
}
export function combinationError(key: string): string | null {
  if (key === "") return null;
  if (!/^(F[2346789]|F10|Ctrl\+(Shift\+)?[A-Z0-9,./\\\[\]`;'=\-])$/.test(key))
    return t(
      "仅支持 Ctrl（可加 Shift）组合，或 F2–F4、F6–F10；普通字符及系统组合不可用。",
    );
  const tail = key.split("+").at(-1)!;
  if (
    ("ACVXDGHIUMWPTL0/[]=-".includes(tail) &&
      ![
        "Ctrl+/",
        "Ctrl+T",
        "Ctrl+I",
        "Ctrl+Shift+X",
        "Ctrl+L",
        "Ctrl+Shift+H",
      ].includes(key)) ||
    ["Ctrl+Shift+K", "Ctrl+Shift+\\"].includes(key)
  )
    return t(
      "此组合保留给系统、浏览器或编辑器（选择、剪贴板、导航等），不能分配。",
    );
  return null;
}
export function bindingError(config: Shortcuts, action: Action, key: string) {
  if (key === "") return null;
  const invalid = combinationError(key);
  if (invalid) return invalid;
  const conflict = (Object.keys(actions) as Action[]).find(
    (other) => other !== action && bindings(config)[other] === key,
  );
  return conflict
    ? t("与“{0}”冲突，请选择其他组合或先修改该动作。", [t(actions[conflict])])
    : null;
}
export function validShortcuts(value: unknown): value is Shortcuts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Shortcuts;
  if (
    !Object.hasOwn(schemes, config.scheme) ||
    !config.overrides ||
    typeof config.overrides !== "object" ||
    Array.isArray(config.overrides) ||
    Object.keys(config.overrides).length !== 3
  )
    return false;
  for (const scheme of Object.keys(schemes) as Scheme[]) {
    const custom = config.overrides[scheme];
    if (!custom || typeof custom !== "object" || Array.isArray(custom))
      return false;
    for (const [action, key] of Object.entries(custom)) {
      if (
        !Object.hasOwn(actions, action) ||
        typeof key !== "string" ||
        bindingError({ ...config, scheme }, action as Action, key)
      )
        return false;
    }
  }
  return true;
}
const punctuation: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
};
export function eventCombination(event: KeyboardEvent): string | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState("AltGraph")
  )
    return null;
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return null;
  const code = event.code;
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3)
    : /^Digit\d$/.test(code)
      ? code.slice(5)
      : punctuation[code] || event.key.toUpperCase();
  return [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.metaKey ? "Win" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
// Suppress managed CodeMirror/browser defaults after reassignment, not ordinary editing keys.
export const managedDefaults = new Set(
  Object.values(presets).flatMap(Object.values).filter(Boolean),
);
