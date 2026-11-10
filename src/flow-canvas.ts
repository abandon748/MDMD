import type { Flow } from "./flow-model";
import { t } from "./i18n";

// Mermaid has no portable free-position syntax. Drag positions belong only to
// this editing session; semantic edits use the existing source/history channel.
export function setupFlowCanvas(
  host: HTMLElement,
  change: (action: (next: Flow) => void) => void,
) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.id = "flow-canvas";
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", t("流程图编辑画布"));
  const toolbar = document.createElement("div"),
    note = document.createElement("p");
  toolbar.className = "table-controls";
  note.textContent = t(
    "拖动节点调整本次画布；Alt 拖到另一节点添加连线。双击节点改字。位置不写入 Mermaid，应用后由引擎自动排版。",
  );
  const label = document.createElement("input"),
    shape = document.createElement("select");
  label.setAttribute("aria-label", t("选中节点文字"));
  label.maxLength = 200;
  shape.setAttribute("aria-label", t("选中节点形状"));
  for (const value of ["box", "round", "diamond"])
    shape.add(new Option(value, value));
  toolbar.append(shape);
  const stage = document.createElement("div");
  stage.className = "flow-stage";
  label.className = "flow-node-input";
  label.hidden = true;
  stage.append(svg, label);
  host.append(note, toolbar, stage);
  const positions = new Map<string, { x: number; y: number }>();
  let model: Flow,
    selected = "",
    zoom = 1,
    composing = false;
  label.addEventListener("compositionstart", () => (composing = true));
  label.addEventListener("compositionend", () => {
    composing = false;
    // Let the parent composition guard finish before committing the final text.
    queueMicrotask(() => {
      if (host.isConnected) commitLabel();
    });
  });
  const mutate = (action: (next: Flow) => void) => {
    if (!composing) change(action);
  };
  function button(name: string, action: () => void) {
    const b = document.createElement("button");
    b.textContent = t(name);
    b.onclick = action;
    toolbar.append(b);
    return b;
  }
  const duplicate = button("复制节点", () =>
    mutate((next) => {
      const node = next.nodes.find((n) => n.id === selected);
      if (!node || next.nodes.length >= 100) return;
      let n = 1;
      while (next.nodes.some((x) => x.id === `N${n}`)) n++;
      selected = `N${n}`;
      next.nodes.push({ ...node, id: selected });
    }),
  );
  const remove = button("删除选中节点", () =>
    mutate((next) => {
      if (next.nodes.length < 2) return;
      next.nodes = next.nodes.filter((n) => n.id !== selected);
      next.edges = next.edges.filter(
        (e) => e.from !== selected && e.to !== selected,
      );
      selected = next.nodes[0].id;
    }),
  );
  button("缩小画布", () => {
    zoom = Math.max(0.5, zoom - 0.25);
    draw();
  });
  button("放大画布", () => {
    zoom = Math.min(2, zoom + 0.25);
    draw();
  });
  button("重置布局", () => {
    positions.clear();
    zoom = 1;
    draw();
  });
  const commitLabel = () =>
    mutate((next) => {
      const n = next.nodes.find((n) => n.id === selected);
      if (n) n.label = label.value;
    });
  // Canvas pointer capture does not blur this field. Commit input before a node
  // selection can replace its value, while preserving IME composition as a unit.
  label.oninput = commitLabel;
  label.onblur = () => {
    if (!composing) label.hidden = true;
  };
  label.onkeydown = (e) => {
    if (e.key === "Enter" && !e.ctrlKey && !composing && !e.isComposing) {
      e.preventDefault();
      label.blur();
    }
  };
  function placeLabel() {
    const node = svg.querySelector(`[data-node="${selected}"]`);
    if (!node || label.hidden) return;
    const box = node.getBoundingClientRect(),
      area = stage.getBoundingClientRect();
    label.style.left = box.left - area.left + box.width / 2 + "px";
    label.style.top = box.top - area.top + box.height / 2 + "px";
    label.style.width = Math.max(24, box.width * 0.85) + "px";
  }
  function editLabel(id: string) {
    choose(id);
    label.hidden = false;
    placeLabel();
    label.focus();
    label.select();
  }
  shape.onchange = () => {
    if (composing) return;
    label.blur();
    label.hidden = true;
    mutate((next) => {
      const n = next.nodes.find((n) => n.id === selected);
      if (n) n.shape = shape.value;
    });
  };
  function choose(id: string) {
    if (composing) return;
    if (id !== selected) label.hidden = true;
    selected = id;
    const node = model.nodes.find((n) => n.id === id)!;
    if (label.value !== node.label) label.value = node.label;
    placeLabel();
    shape.value = node.shape;
    for (const item of svg.querySelectorAll("[data-node]"))
      item.setAttribute(
        "aria-pressed",
        String(item.getAttribute("data-node") === selected),
      );
  }
  function element(name: string, attrs: Record<string, string | number>) {
    const e = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs))
      e.setAttribute(key, String(value));
    return e;
  }
  function draw() {
    const width = 800,
      height = Math.max(300, Math.ceil(model.nodes.length / 4) * 130 + 40);
    svg.setAttribute("viewBox", `0 0 ${width / zoom} ${height / zoom}`);
    svg.style.height = `${Math.min(520, height)}px`;
    svg.replaceChildren();
    model.nodes.forEach((n, i) => {
      if (!positions.has(n.id))
        positions.set(n.id, {
          x: 110 + (i % 4) * 190,
          y: 80 + Math.floor(i / 4) * 130,
        });
    });
    const defs = element("defs", {}),
      marker = element("marker", {
        id: "flow-canvas-arrow",
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse",
      });
    marker.append(
      element("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "currentColor" }),
    );
    defs.append(marker);
    svg.append(defs);
    model.edges.forEach((e, i) => {
      const a = positions.get(e.from)!,
        b = positions.get(e.to)!;
      const g = element("g", {
        "data-edge": i,
        tabindex: 0,
        role: "button",
        "aria-label": `${e.from} → ${e.to}`,
      });
      const dx = b.x - a.x,
        dy = b.y - a.y,
        scale = Math.max(Math.abs(dx) / 80, Math.abs(dy) / 32, 1);
      const line = element("path", {
        d:
          e.from === e.to
            ? `M ${a.x} ${a.y - 32} c -80 -80 80 -80 0 0`
            : `M ${a.x + dx / scale} ${a.y + dy / scale} L ${b.x - dx / scale} ${b.y - dy / scale}`,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
        "marker-end": "url(#flow-canvas-arrow)",
      });
      const text = element("text", {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2 - 8,
        "text-anchor": "middle",
      });
      text.textContent = e.label;
      const title = element("title", {});
      title.textContent = t("双击连线删除；也可在下方表单修改。");
      g.append(title, line, text);
      g.addEventListener("dblclick", () =>
        mutate((next) => {
          next.edges.splice(i, 1);
        }),
      );
      g.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Delete") {
          event.preventDefault();
          mutate((next) => {
            next.edges.splice(i, 1);
          });
        }
      });
      svg.append(g);
    });
    model.nodes.forEach((n) => {
      const p = positions.get(n.id)!;
      const g = element("g", {
        "data-node": n.id,
        transform: `translate(${p.x} ${p.y})`,
        tabindex: 0,
        role: "button",
        "aria-label": n.label,
        "aria-pressed": String(n.id === selected),
      });
      const border =
        n.shape === "diamond"
          ? element("polygon", { points: "0,-42 85,0 0,42 -85,0" })
          : element("rect", {
              x: -80,
              y: -32,
              width: 160,
              height: 64,
              rx: n.shape === "round" ? 16 : 0,
            });
      const text = element("text", {
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      text.textContent =
        n.label.length > 15 ? n.label.slice(0, 14) + "…" : n.label;
      const title = element("title", {});
      title.textContent = n.label;
      g.append(title, border, text);
      g.addEventListener("click", () => choose(n.id));
      g.addEventListener("dblclick", () => {
        editLabel(n.id);
      });
      g.addEventListener("keydown", (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === "Enter") {
          event.preventDefault();
          editLabel(n.id);
        }
      });
      g.addEventListener("pointerdown", (event) => {
        const ev = event as PointerEvent;
        if (ev.button !== 0 || composing) return;
        ev.preventDefault();
        const start = { x: ev.clientX, y: ev.clientY },
          original = { ...p };
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        g.setPointerCapture(ev.pointerId);
        const move = (event: Event) => {
          const e = event as PointerEvent;
          if (ev.altKey) return;
          p.x = Math.max(
            90,
            Math.min(width - 90, original.x + (e.clientX - start.x) / ctm.a),
          );
          p.y = Math.max(
            45,
            Math.min(height - 45, original.y + (e.clientY - start.y) / ctm.d),
          );
          g.setAttribute("transform", `translate(${p.x} ${p.y})`);
        };
        const end = (event: Event) => {
          const e = event as PointerEvent;
          g.removeEventListener("pointermove", move);
          g.removeEventListener("pointerup", end);
          g.removeEventListener("pointercancel", cancel);
          if (g.hasPointerCapture(ev.pointerId))
            g.releasePointerCapture(ev.pointerId);
          if (ev.altKey && e.type !== "pointercancel") {
            const target = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest("[data-node]")
              ?.getAttribute("data-node");
            if (
              target &&
              target !== n.id &&
              model.edges.length < 200 &&
              !model.edges.some((x) => x.from === n.id && x.to === target)
            )
              mutate((next) => {
                next.edges.push({ from: n.id, to: target, label: "" });
              });
          }
          if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 2)
            draw();
          choose(n.id);
        };
        const cancel = (event: Event) => {
          Object.assign(p, original);
          end(event);
        };
        g.addEventListener("pointermove", move);
        g.addEventListener("pointerup", end);
        g.addEventListener("pointercancel", cancel);
      });
      svg.append(g);
    });
  }
  return {
    update(next: Flow) {
      model = next;
      if (!next.nodes.some((n) => n.id === selected))
        selected = next.nodes[0].id;
      duplicate.disabled = next.nodes.length >= 100;
      remove.disabled = next.nodes.length < 2;
      draw();
      choose(selected);
    },
    get composing() {
      return composing;
    },
  };
}
