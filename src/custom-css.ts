import { t } from "./i18n.ts";
export interface CustomCss {
  enabled: boolean;
  source: string;
}
export const defaultCustomCss = (): CustomCss => ({
  enabled: false,
  source: "",
});
export function validCustomCss(value: unknown): value is CustomCss {
  const v = value as CustomCss | null;
  return (
    !!v &&
    typeof v.enabled === "boolean" &&
    typeof v.source === "string" &&
    v.source.length <= 32768
  );
}

// Restrict declarations to local visual formatting. No resources, generated
// content, positioning, animations or custom property definitions are accepted.
const properties = new Set(
  `color background-color font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing text-align text-indent text-transform text-decoration text-decoration-color text-decoration-line text-decoration-style text-decoration-thickness text-underline-offset text-shadow white-space overflow-wrap word-break hyphens vertical-align display width min-width max-width height min-height max-height box-sizing overflow overflow-x overflow-y opacity margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-width border-style border-color border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-top-color border-right-color border-bottom-color border-left-color border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius border-collapse border-spacing table-layout caption-side list-style-type list-style-position`.split(
    " ",
  ),
);

export function compileCustomCss(source: string): string {
  if (source.length > 32768) throw new Error(t("CSS 最多 32,768 个字符。"));
  if (!source.trim()) return "";
  if (/\\|@import\b|url\s*\(|image-set\s*\(/i.test(source))
    throw new Error(
      t("不支持外部资源、@import 或 CSS 转义。请使用本地文字与排版样式。"),
    );
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(source);
  if (!sheet.cssRules.length && source.replace(/\/\*[\s\S]*?\*\//g, "").trim())
    throw new Error(t("未识别到有效 CSS 规则，请检查选择器和大括号。"));
  let count = 0;
  function compile(rules: CSSRuleList, depth: number): string {
    if (depth > 4) throw new Error(t("@media 最多嵌套 4 层。"));
    return Array.from(rules, (rule) => {
      if (++count > 200)
        throw new Error(t("CSS 最多 200 条规则（含 @media）。"));
      if (rule instanceof CSSMediaRule)
        return `@media ${rule.conditionText} {${compile(rule.cssRules, depth + 1)}}`;
      if (!(rule instanceof CSSStyleRule))
        throw new Error(t("仅支持普通样式规则和 @media。"));
      if (
        rule.cssRules.length ||
        rule.selectorText.includes("&") ||
        rule.selectorText.includes("::") ||
        rule.selectorText.length > 1024
      )
        throw new Error(
          t("不支持嵌套选择器、&、伪元素或超过 1,024 字符的选择器。"),
        );
      if (!rule.style.length)
        throw new Error(t("规则 {0} 没有可识别的声明。", [rule.selectorText]));
      for (const name of rule.style) {
        // CSSOM expands `border` into these resource-free initial resets.
        const borderReset: Record<string, string> = {
          "border-image-source": "none",
          "border-image-slice": "100%",
          "border-image-width": "1",
          "border-image-outset": "0",
          "border-image-repeat": "stretch",
        };
        if (borderReset[name] === rule.style.getPropertyValue(name)) continue;
        if (!properties.has(name))
          throw new Error(
            t("本轮不支持属性 {0}，请使用文字、边框或常规排版属性。", [name]),
          );
      }
      // Wrap the entire selector list in :is(), so commas and combinators can
      // never select an element outside the preview. Root styling uses .markdown-body.
      return `#preview:is(${rule.selectorText}), #preview :is(${rule.selectorText}):not(.inline-editor, .inline-editor *) {${rule.style.cssText}}`;
    }).join("\n");
  }
  return compile(sheet.cssRules, 0);
}
