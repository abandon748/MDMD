import { t } from "./i18n.ts";
// MDMD semantic colors; native chrome, warning colors and syntax tokens follow theme.
export const colorLabels = {
  text: "正文",
  heading: "标题",
  muted: "次要文字",
  border: "边框",
  accent: "强调色／链接",
  "accent-hover": "主按钮悬停",
  surface: "主背景",
  canvas: "页面背景",
  soft: "代码／辅助背景",
  hover: "悬停背景",
  selection: "选区背景",
  "code-text": "代码文字",
  scroll: "滚动条",
} as const;
export type ColorKey = keyof typeof colorLabels;
export const colorKeys = Object.keys(colorLabels) as ColorKey[];
export type Colors = Record<ColorKey, string>;
export const defaultColors: Record<"light" | "dark", Colors> = {
  light: {
    text: "#303740",
    heading: "#24292f",
    muted: "#656e7a",
    border: "#dce1e8",
    accent: "#2e61da",
    "accent-hover": "#244db3",
    surface: "#ffffff",
    canvas: "#fafbfc",
    soft: "#f3f5f7",
    hover: "#eaf0fc",
    selection: "#d3e1ff",
    "code-text": "#405978",
    scroll: "#c2cbd7",
  },
  dark: {
    text: "#d4dbe5",
    heading: "#edf1f7",
    muted: "#a5afbd",
    border: "#3b4554",
    accent: "#94b8ff",
    "accent-hover": "#2f55ae",
    surface: "#202630",
    canvas: "#191f28",
    soft: "#2a323e",
    hover: "#303f56",
    selection: "#3d557e",
    "code-text": "#b5cbea",
    scroll: "#5b687c",
  },
};
export interface Palette {
  id: string;
  name: string;
  light: Colors;
  dark: Colors;
}
export interface Appearance {
  palette: string;
  corners: "rounded" | "square";
  custom: Palette[];
}
export const defaultAppearance = (): Appearance => ({
  palette: "default",
  corners: "rounded",
  custom: [],
});
export function appearanceError(value: unknown): string {
  if (!value || typeof value !== "object") return t("配色记录无效");
  const a = value as Appearance;
  if (
    !["rounded", "square"].includes(a.corners) ||
    !Array.isArray(a.custom) ||
    a.custom.length > 20
  )
    return t("圆角值无效或自定义方案超过 20 个");
  const ids = new Set(["default"]),
    names = new Set(["默认"]);
  for (const p of a.custom) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(p.id) ||
      ids.has(p.id)
    )
      return t("配色标识无效或重复");
    if (
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name !== p.name.trim() ||
      p.name.length > 40 ||
      /[\x00-\x1f\x7f]/.test(p.name)
    )
      return t("方案名称须为 1–40 个字符，不能包含首尾空格或控制字符");
    if (names.has(p.name.toLocaleLowerCase()))
      return t("方案名称重复，请更换名称");
    for (const mode of ["light", "dark"] as const)
      if (
        !p[mode] ||
        colorKeys.some(
          (k) =>
            typeof p[mode][k] !== "string" ||
            !/^#[0-9a-f]{6}$/i.test(p[mode][k]),
        )
      )
        return t("颜色须为六位十六进制色值");
    ids.add(p.id);
    names.add(p.name.toLocaleLowerCase());
  }
  return typeof a.palette === "string" && ids.has(a.palette)
    ? ""
    : t("所选方案不存在");
}
