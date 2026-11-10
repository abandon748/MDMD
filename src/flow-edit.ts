import { EditorView } from "@codemirror/view";
import { undo, redo, isolateHistory } from "@codemirror/commands";
import { parseFlow, writeFlow, type Flow } from "./flow-model";
import { renderDiagrams, inspectGraph } from "./diagrams";
import { editGraph, graphBody, matchesEdit } from "./graph-structure";
import { graphTools } from "./graph-tools";
import { t } from "./i18n";
import { setupFlowCanvas } from "./flow-canvas";
import { diagramFields, mountDiagramLabels } from "./diagram-labels";

export function setupFlowEditor(host: HTMLElement, view: EditorView) {
  const panel = document.createElement("section");
  panel.className = "flow-editor";
  const controls = document.createElement("div"),
    grid = document.createElement("div"),
    image = document.createElement("div"),
    message = document.createElement("p");
  controls.className = "table-controls";
  grid.id = "flow-grid";
  image.id = "flow-preview";
  message.setAttribute("role", "status");
  const source = host.querySelector<HTMLElement>("#inline-source")!;
  const canvasHost = document.createElement("div");
  panel.append(controls, message, canvasHost, grid, image);
  source.before(panel);
  let model: Flow,
    composing = false,
    raw = false,
    invalid = false,
    generation = 0;
  const buttons: HTMLButtonElement[] = [];
  const canvas = setupFlowCanvas(canvasHost, change);
  let mapped: ReturnType<typeof mountDiagramLabels> | undefined;
  let verified = "";
  let structureMode = false,
    checking = false;
  const fail = () => {
    invalid = true;
    message.textContent = t(
      "无法安全定位可编辑标签。请检查图表语法，或使用编辑源码。",
    );
  };
  function button(
    parent: HTMLElement,
    name: string,
    action: () => void,
    key?: string,
  ) {
    const b = document.createElement("button");
    b.textContent = t(name);
    if (key) b.id = `flow-${key}`;
    b.onclick = () => {
      if (checking || hasUnsubmittedForm()) {
        message.textContent = t("请先应用到草稿或结束当前选择。");
        return;
      }
      if (!composing && !view.compositionStarted) action();
    };
    parent.append(b);
    return b;
  }
  function change(action: (next: Flow) => void) {
    if (composing || raw || view.state.readOnly) return;
    const next = structuredClone(model);
    action(next);
    try {
      const text = writeFlow(next);
      if (text !== view.state.doc.toString())
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          annotations: isolateHistory.of("full"),
        });
      reload();
    } catch {
      fail();
    }
  }
  function select(
    values: string[],
    value: string,
    name: string,
    action: (value: string) => void,
  ) {
    const s = document.createElement("select");
    s.setAttribute("aria-label", t(name));
    for (const v of values) s.add(new Option(v, v));
    s.value = value;
    s.onchange = () => change(() => action(s.value));
    return s;
  }
  buttons.push(
    button(
      controls,
      "添加节点",
      () =>
        change((next) => {
          let index = 1;
          while (next.nodes.some((n) => n.id === `N${index}`)) index++;
          next.nodes.push({
            id: `N${index}`,
            label: `N${index}`,
            shape: "box",
          });
        }),
      "add-node",
    ),
  );
  buttons.push(
    button(
      controls,
      "添加连线",
      () =>
        change((next) =>
          next.edges.push({
            from: next.nodes[0].id,
            to: next.nodes.at(-1)!.id,
            label: "",
          }),
        ),
      "add-edge",
    ),
  );
  button(
    controls,
    "撤销",
    () => {
      undo(view);
      reload();
    },
    "undo",
  );
  button(
    controls,
    "重做",
    () => {
      redo(view);
      reload();
    },
    "redo",
  );
  button(
    controls,
    "源码／可视化",
    () => {
      if (raw) reload();
      else {
        raw = true;
        generation++;
        canvasHost.hidden = grid.hidden = image.hidden = true;
        source.hidden = false;
        buttons.forEach((b) => (b.disabled = true));
        view.focus();
      }
    },
    "source",
  );
  function input(
    value: string,
    name: string,
    apply: (next: Flow, value: string) => void,
  ) {
    const i = document.createElement("input");
    i.value = value;
    i.maxLength = 200;
    i.setAttribute("aria-label", name);
    i.onchange = () => change((next) => apply(next, i.value));
    return i;
  }
  function hasUnsubmittedForm() {
    return (
      !image.hidden &&
      !!image.querySelector(".graph-name-editor,[data-graph-style-form]")
    );
  }
  const advanced = button(controls, "子图与样式", () => {
    structureMode = true;
    reload();
  });
  function reload() {
    const run = ++generation;
    mapped = undefined;
    invalid = false;
    const draft = view.state.doc.toString();
    let simple: Flow | undefined;
    if (!structureMode) {
      try {
        simple = parseFlow(draft);
      } catch {
        /* Use the rendered diagram. */
      }
    }
    advanced.hidden = !simple;
    if (!simple) {
      const fields = diagramFields(draft);
      if (
        fields.length ||
        /^\s*(?:%%[^\n]*\n\s*)*(?:graph|flowchart)\s/.test(graphBody(draft))
      ) {
        raw = false;
        canvasHost.hidden = grid.hidden = source.hidden = true;
        image.hidden = false;
        buttons.forEach((b) => (b.hidden = true));
        const pre = document.createElement("pre"),
          code = document.createElement("code");
        code.className = "language-mermaid";
        code.textContent = draft.slice(
          draft.indexOf("\n") + 1,
          draft.trimEnd().lastIndexOf("\n"),
        );
        pre.append(code);
        image.replaceChildren(pre);
        message.textContent = t(
          "点击图中文字直接编辑，回车确认，Esc 放弃当前输入。",
        );
        const current = () => run === generation && panel.isConnected;
        void renderDiagrams(
          image,
          current,
          () => {},
          () => {},
          undefined,
          false,
          (surface, hits, graph) => {
            mapped = mountDiagramLabels(
              surface,
              hits,
              fields,
              draft,
              (from, to, insert) => {
                if (
                  !current() ||
                  view.state.readOnly ||
                  view.state.doc.toString() !== draft
                )
                  return;
                view.dispatch({
                  changes: {
                    from,
                    to,
                    insert,
                  },
                  annotations: isolateHistory.of("full"),
                });
                verified = view.state.doc.toString();
                reload();
              },
            );
            if (graph)
              graphTools(surface, hits, graph, async (edit) => {
                if (
                  checking ||
                  !current() ||
                  view.state.readOnly ||
                  !mapped?.commit() ||
                  !current()
                )
                  throw Error();
                const next = editGraph(draft, graph, edit);
                if (next === draft) return;
                checking = true;
                try {
                  const after = await inspectGraph(graphBody(next));
                  if (
                    !current() ||
                    view.state.readOnly ||
                    view.state.doc.toString() !== draft ||
                    !matchesEdit(graph, after, edit)
                  )
                    throw Error();
                  view.dispatch({
                    changes: { from: 0, to: draft.length, insert: next },
                    annotations: isolateHistory.of("full"),
                  });
                  structureMode = true;
                  verified = next;
                  reload();
                } finally {
                  checking = false;
                }
              });
            if (graph || surface.querySelector(".diagram-hit"))
              verified = draft;
            else fail();
          },
        ).then(() => {
          if (current() && !mapped) {
            verified = "";
            fail();
          }
        });
        return;
      }
      raw = true;
      canvasHost.hidden = grid.hidden = image.hidden = true;
      source.hidden = false;
      buttons.forEach((b) => (b.disabled = true));
      fail();
      return;
    }
    model = simple;
    buttons.forEach((b) => (b.hidden = false));
    raw = false;
    source.hidden = true;
    canvasHost.hidden = grid.hidden = image.hidden = false;
    canvas.update(model);
    buttons[0].disabled = model.nodes.length >= 100;
    buttons[1].disabled = model.edges.length >= 200;
    grid.replaceChildren();
    const direction = select(
      ["LR", "RL", "TB", "TD", "BT"],
      model.direction,
      "流程方向",
      () => {},
    );
    direction.onchange = () =>
      change((next) => {
        next.direction = direction.value;
      });
    direction.id = "flow-direction";
    grid.append(direction);
    model.nodes.forEach((n, index) => {
      const row = document.createElement("div");
      row.className = "flow-row";
      row.append(document.createTextNode(n.id));
      row.append(
        input(n.label, t("节点文字") + " " + n.id, (next, value) => {
          next.nodes[index].label = value;
        }),
      );
      const shape = select(
        ["box", "round", "diamond"],
        n.shape,
        "节点形状",
        () => {},
      );
      shape.onchange = () =>
        change((next) => {
          next.nodes[index].shape = shape.value;
        });
      row.append(shape);
      const remove = button(row, "删除节点", () =>
        change((next) => {
          next.nodes.splice(index, 1);
          next.edges = next.edges.filter(
            (e) => e.from !== n.id && e.to !== n.id,
          );
        }),
      );
      remove.disabled = model.nodes.length === 1;
      grid.append(row);
    });
    model.edges.forEach((e, index) => {
      const row = document.createElement("div");
      row.className = "flow-row";
      for (const key of ["from", "to"] as const) {
        const s = select(
          model.nodes.map((n) => n.id),
          e[key],
          key === "from" ? "起点" : "终点",
          () => {},
        );
        s.onchange = () =>
          change((next) => {
            next.edges[index][key] = s.value;
          });
        row.append(s);
      }
      row.append(
        input(e.label, t("连线文字"), (next, value) => {
          next.edges[index].label = value;
        }),
      );
      button(row, "删除连线", () =>
        change((next) => {
          next.edges.splice(index, 1);
        }),
      );
      grid.append(row);
    });
    message.textContent = t(
      "编辑节点和连线后预览更新；应用才写回正文，取消保留原文。删除节点同时删除关联连线。",
    );
    const pre = document.createElement("pre"),
      code = document.createElement("code");
    code.className = "language-mermaid";
    const text = view.state.doc.toString();
    code.textContent = text.slice(
      model.header.length,
      text.length - model.footer.length,
    );
    pre.append(code);
    image.replaceChildren(pre);
    void renderDiagrams(
      image,
      () => run === generation && panel.isConnected,
      () => {},
      () => {},
      undefined,
      false,
    );
  }
  panel.addEventListener("compositionstart", () => {
    composing = true;
  });
  panel.addEventListener("compositionend", () => {
    composing = false;
  });
  reload();
  return {
    valid() {
      if (checking || hasUnsubmittedForm()) {
        message.textContent = t("请先应用到草稿或结束当前选择。");
        return false;
      }
      if (mapped && !mapped.commit()) return false;
      if (invalid && !raw) return false;
      if (verified && verified === view.state.doc.toString()) return true;
      try {
        parseFlow(view.state.doc.toString());
        return true;
      } catch {
        fail();
        return false;
      }
    },
    get composing() {
      return composing || canvas.composing || !!mapped?.composing;
    },
  };
}
