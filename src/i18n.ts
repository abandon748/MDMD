import { english } from "./messages.ts";

export type Language = "system" | "zh-CN" | "en";
export type Locale = Exclude<Language, "system">;
let locale: Locale = "zh-CN";
export const validLanguage = (value: unknown): value is Language =>
  value === "system" || value === "zh-CN" || value === "en";
export const getLocale = () => locale;
export function setLocale(value: Locale) {
  locale = value;
}
export function t(key: string, args: unknown[] = []): string {
  const text = locale === "en" ? (english[key] ?? key) : key;
  return text.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < args.length ? String(args[Number(index)]) : match,
  );
}

// Capture only application-owned initial markup. Never scan a loaded document,
// filenames, CSS or editor text, even when they happen to match a message key.
export function bindStaticTranslations(root: HTMLElement): () => void {
  const excluded =
    "script,style,textarea,#preview,#editor,#outline,#filename,#filepath,#folder-name,#folder-path,#folder-root,#history-list,#favorites-list,#folder-files,#folder-directories";
  const bindings: (() => void)[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest(excluded)) continue;
    const original = node.data;
    const key = original.trim().replace(/\s+/g, " ");
    if (!Object.hasOwn(english, key)) continue;
    let last = original;
    bindings.push(() => {
      if (!node.isConnected || node.data !== last) return;
      node.data = original.replace(original.trim(), t(key));
      last = node.data;
    });
  }
  for (const node of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    if (node.closest(excluded)) continue;
    for (const attribute of ["title", "aria-label", "placeholder"]) {
      const key = node.getAttribute(attribute);
      if (!key || !Object.hasOwn(english, key)) continue;
      let last = key;
      bindings.push(() => {
        if (!node.isConnected || node.getAttribute(attribute) !== last) return;
        node.setAttribute(attribute, t(key));
        last = t(key);
      });
    }
  }
  return () => {
    document.documentElement.lang = locale;
    bindings.forEach((apply) => apply());
  };
}
