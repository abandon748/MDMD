import { t } from "./i18n";
import type { GraphInfo, DiagramLabel } from "./diagrams";
import type { GraphEdit } from "./graph-structure";

export function graphTools(
  surface: HTMLElement,
  hits: DiagramLabel[],
  graph: GraphInfo,
  change: (edit: GraphEdit) => Promise<void>,
) {
  const bar = document.createElement("div"),
    options = document.createElement("div"),
    status = document.createElement("span");
  bar.className = options.className = "table-controls";
  bar.dataset.graphTools = "";
  status.setAttribute("role", "status");
  surface.before(bar, options);
  function button(parent: HTMLElement, name: string, action: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t(name);
    b.onclick = action;
    parent.append(b);
    return b;
  }
  const clearHits = () => {
    surface.querySelectorAll(".graph-pick").forEach((e) => e.remove());
    surface.classList.remove("picking");
  };
  function reset() {
    delete options.dataset.graphStyleForm;
    surface.querySelector(".graph-name-editor")?.remove();
    clearHits();
    options.replaceChildren();
    status.textContent = "";
  }
  async function submit(edit: GraphEdit) {
    bar.inert = options.inert = surface.inert = true;
    status.textContent = t("正在核对图表…");
    try {
      await change(edit);
      reset();
    } catch {
      status.textContent = t(
        "无法安全修改这段源码。草稿已保留，可切换到源码编辑。",
      );
    } finally {
      bar.inert = options.inert = surface.inert = false;
    }
  }
  function pick(kind: string, action: (id: string) => void) {
    clearHits();
    surface.classList.add("picking");
    for (const h of hits.filter(
      (h) =>
        h.kind === "graph-" + kind &&
        Number.isFinite(h.x) &&
        Number.isFinite(h.y),
    )) {
      const b = button(surface, "◎", () => {
        clearHits();
        action(h.text);
      });
      b.className = "graph-pick";
      b.dataset.graphId = h.text;
      if (kind === "node")
        b.dataset.parent = graph.nodes.find((n) => n.id === h.text)?.parent;
      const edge = graph.edges.find((e) => e.id === h.text);
      b.title = b.ariaLabel =
        kind === "edge" && edge
          ? edge.from + " → " + edge.to + " (" + h.text + ")"
          : h.text;
      b.style.left = h.x * 100 + "%";
      b.style.top = h.y * 100 + "%";
    }
  }
  function title(kind: "create" | "rename", id: string, value: string) {
    reset();
    const editor = document.createElement("div");
    editor.className = "graph-name-editor";
    const hit = hits.find((h) => h.kind === "graph-group" && h.text === id);
    editor.style.left =
      "clamp(90px," + (hit?.x ?? 0.5) * 100 + "%,calc(100% - 90px))";
    editor.style.top =
      "clamp(0px," + (hit?.y ?? 0.15) * 100 + "%,calc(100% - 58px))";
    surface.append(editor);
    const input = document.createElement("input");
    input.maxLength = 200;
    input.value = value;
    input.ariaLabel = t("子图名称");
    editor.append(input);
    const apply = button(editor, "应用到草稿", () => {
      if (input.value.trim())
        void submit({ kind, id, title: input.value.trim() });
    });
    button(editor, "取消", reset);
    input.onkeydown = (e) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        reset();
        return;
      }
      if (!e.isComposing && e.key === "Enter" && !e.ctrlKey) {
        e.preventDefault();
        apply.click();
      }
    };
    input.focus();
    input.select();
  }
  for (const hit of hits.filter((h) => h.kind === "graph-group")) {
    const group = graph.nodes.find((n) => n.group && n.id === hit.text);
    if (!group) continue;
    const b = button(surface, "", () => title("rename", group.id, group.label));
    b.className = "diagram-hit graph-title-hit";
    b.ariaLabel = b.title = t("重命名子图") + " " + group.id;
    b.style.left = hit.x * 100 + "%";
    b.style.top = hit.y * 100 + "%";
    b.style.width = Math.max(4, Math.min(14, group.label.length * 1.8)) + "%";
  }
  button(bar, "新建子图", () => {
    reset();
    let n = 1;
    while (graph.nodes.some((v) => v.id === "MDGroup" + n)) n++;
    title("create", "MDGroup" + n, t("新子图"));
  });
  button(bar, "重命名子图", () => {
    reset();
    status.textContent = t("点选图中的子图标题");
    pick("group", (id) =>
      title("rename", id, graph.nodes.find((g) => g.id === id)!.label),
    );
  });
  button(bar, "移动节点", () => {
    reset();
    status.textContent = t("点选要移动的节点");
    pick("node", (id) => {
      status.textContent = t("点选目标子图，或移至顶层");
      button(
        options,
        "移至顶层",
        () => void submit({ kind: "move", id, parent: "" }),
      );
      pick("group", (parent) => void submit({ kind: "move", id, parent }));
    });
  });
  function styles(edge: boolean) {
    reset();
    status.textContent = edge ? t("点选要修改的连线") : t("点选要修改的节点");
    pick(edge ? "edge" : "node", (id) => {
      options.replaceChildren();
      options.dataset.graphStyleForm = "";
      status.textContent = id;
      const prop = document.createElement("select");
      prop.ariaLabel = t("样式属性");
      if (!edge) prop.add(new Option(t("填充颜色"), "fill"));
      for (const [key, name] of [
        ["stroke", "线条颜色"],
        ["stroke-width", "线宽"],
        ["stroke-dasharray", "线型"],
      ])
        prop.add(new Option(t(name), key));
      const color = document.createElement("input");
      color.type = "color";
      color.value = "#3366cc";
      color.ariaLabel = t("颜色值");
      const value = document.createElement("select");
      value.ariaLabel = t("样式值");
      function refresh() {
        const isColor = ["fill", "stroke"].includes(prop.value);
        color.hidden = !isColor;
        value.hidden = isColor;
        value.replaceChildren();
        if (prop.value === "stroke-width")
          for (let n = 1; n <= 6; n++)
            value.add(new Option(n + " px", n + "px"));
        if (prop.value === "stroke-dasharray")
          for (const [label, key] of [
            ["实线", "none"],
            ["虚线", "5 3"],
            ["点线", "2 3"],
          ])
            value.add(new Option(t(label), key));
      }
      prop.onchange = refresh;
      refresh();
      options.append(prop, color, value);
      button(
        options,
        "应用到草稿",
        () =>
          void submit({
            kind: edge ? "edgeStyle" : "nodeStyle",
            id,
            props: { [prop.value]: color.hidden ? value.value : color.value },
          }),
      );
    });
  }
  button(bar, "节点样式", () => styles(false));
  button(bar, "连线样式", () => styles(true));
  button(bar, "结束选择", reset);
  bar.append(status);
}
