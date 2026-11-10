import { EditorView } from "@codemirror/view";
import { undo, redo, isolateHistory } from "@codemirror/commands";
import { t } from "./i18n.ts";
import {
  parseTable,
  writeTable,
  maxRows,
  maxColumns,
  type TableModel,
  type Alignment,
} from "./table-model";

export function setupTableEditor(host: HTMLElement, view: EditorView) {
  const panel = document.createElement("section");
  panel.className = "table-editor";
  const controls = document.createElement("div");
  controls.className = "table-controls";
  const message = document.createElement("p");
  message.className = "inline-hint";
  message.id = "table-message";
  message.setAttribute("role", "status");
  const grid = document.createElement("div");
  grid.id = "table-grid";
  const source = host.querySelector<HTMLElement>("#inline-source")!;
  panel.append(controls, message, grid);
  source.before(panel);
  let model: TableModel,
    row = 0,
    col = 0,
    composing = false,
    raw = false;
  let dragColumn: number | null = null;
  const buttons: Record<string, HTMLButtonElement> = {};
  const fail = () => {
    message.textContent = t(
      "此源码不能安全转换为网格：仅支持规则的顶层管道表格，最多 200 个数据行、50 列、10000 个单元格。请在源码中修正；原文仍保留。",
    );
  };
  function focusCell() {
    grid
      .querySelector<HTMLInputElement>(`[data-row="${row}"][data-col="${col}"]`)
      ?.focus();
  }
  function commit(next: TableModel, redraw = true) {
    try {
      const text = writeTable(next);
      if (text !== view.state.doc.toString())
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          annotations: isolateHistory.of("full"),
        });
      model = next;
      if (redraw) render();
      return true;
    } catch {
      fail();
      return false;
    }
  }
  function change(action: (next: TableModel) => void) {
    if (composing || raw) return;
    const next = structuredClone(model);
    action(next);
    commit(next);
  }
  function button(id: string, label: string, action: () => void) {
    const b = document.createElement("button");
    b.id = `table-${id}`;
    b.textContent = t(label);
    b.onclick = () => {
      if (!composing && !view.compositionStarted) action();
    };
    controls.append(b);
    buttons[id] = b;
    return b;
  }
  function moveColumn(to: number) {
    if (to < 0 || to >= model.align.length || to === col) return;
    change((next) => {
      for (const cells of next.cells)
        cells.splice(to, 0, cells.splice(col, 1)[0]);
      next.align.splice(to, 0, next.align.splice(col, 1)[0]);
      col = to;
    });
  }
  button("row-before", "上方插入行", () =>
    change((next) => {
      row = Math.max(1, row);
      next.cells.splice(
        row,
        0,
        next.align.map(() => ""),
      );
    }),
  );
  button("row-after", "下方插入行", () =>
    change((next) => {
      row++;
      next.cells.splice(
        row,
        0,
        next.align.map(() => ""),
      );
    }),
  );
  button("row-delete", "删除当前行", () =>
    change((next) => {
      next.cells.splice(row, 1);
      row = Math.min(row, next.cells.length - 1);
    }),
  );
  for (const [id, label, delta] of [
    ["row-up", "上移行", -1],
    ["row-down", "下移行", 1],
  ] as const)
    button(id, label, () =>
      change((next) => {
        const to = row + delta;
        [next.cells[row], next.cells[to]] = [next.cells[to], next.cells[row]];
        row = to;
      }),
    );
  button("col-before", "左侧插入列", () =>
    change((next) => {
      next.align.splice(col, 0, "default");
      for (const cells of next.cells) cells.splice(col, 0, "");
    }),
  );
  button("col-after", "右侧插入列", () =>
    change((next) => {
      col++;
      next.align.splice(col, 0, "default");
      for (const cells of next.cells) cells.splice(col, 0, "");
    }),
  );
  button("col-delete", "删除当前列", () =>
    change((next) => {
      next.align.splice(col, 1);
      for (const cells of next.cells) cells.splice(col, 1);
      col = Math.min(col, next.align.length - 1);
    }),
  );
  button("col-left", "左移列", () => moveColumn(col - 1));
  button("col-right", "右移列", () => moveColumn(col + 1));
  for (const [id, label, direction] of [
    ["sort-up", "按当前列升序", 1],
    ["sort-down", "按当前列降序", -1],
  ] as const)
    button(id, label, () =>
      change((next) => {
        const body = next.cells.slice(1);
        body.sort((a, b) =>
          a[col] < b[col] ? -direction : a[col] > b[col] ? direction : 0,
        );
        next.cells = [next.cells[0], ...body];
      }),
    );
  const alignment = document.createElement("select");
  alignment.id = "table-align";
  alignment.setAttribute("aria-label", t("当前列对齐"));
  for (const [value, label] of [
    ["default", "默认对齐"],
    ["left", "左对齐"],
    ["center", "居中对齐"],
    ["right", "右对齐"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(label);
    alignment.append(option);
  }
  alignment.onchange = () =>
    change((next) => {
      next.align[col] = alignment.value as Alignment;
    });
  controls.append(alignment);
  button("undo", "撤销表格修改", () => {
    undo(view);
    reload();
  });
  button("redo", "重做表格修改", () => {
    redo(view);
    reload();
  });
  button("source", "表格源码", () => {
    if (view.compositionStarted) return;
    if (raw) {
      reload();
      if (raw) return;
    } else {
      raw = true;
      grid.hidden = true;
      source.hidden = false;
      view.focus();
    }
    reflect();
  });
  button("expand", "展开／还原表格", () => {
    const expanded = host.classList.toggle("table-expanded");
    buttons.expand.setAttribute("aria-pressed", String(expanded));
  });
  function reflect() {
    buttons.source.textContent = raw ? t("返回网格") : t("表格源码");
    for (const [id, b] of Object.entries(buttons))
      b.disabled = !["source", "expand", "undo", "redo"].includes(id) && raw;
    alignment.disabled = raw;
    if (raw) return;
    buttons["row-before"].disabled = buttons["row-after"].disabled =
      model.cells.length >= maxRows ||
      (model.cells.length + 1) * model.align.length > 10000;
    buttons["col-before"].disabled = buttons["col-after"].disabled =
      model.align.length >= maxColumns ||
      model.cells.length * (model.align.length + 1) > 10000;
    buttons["row-delete"].disabled = row === 0;
    buttons["row-up"].disabled = row <= 1;
    buttons["row-down"].disabled = row === 0 || row === model.cells.length - 1;
    buttons["col-delete"].disabled = model.align.length === 1;
    buttons["col-left"].disabled = col === 0;
    buttons["col-right"].disabled = col === model.align.length - 1;
    alignment.value = model.align[col];
  }
  function render() {
    row = Math.max(0, Math.min(row, model.cells.length - 1));
    col = Math.max(0, Math.min(col, model.align.length - 1));
    grid.replaceChildren();
    const table = document.createElement("table");
    model.cells.forEach((cells, r) => {
      const tr = document.createElement("tr");
      cells.forEach((value, c) => {
        const td = document.createElement(r === 0 ? "th" : "td");
        const input = document.createElement("input");
        input.value = value;
        input.maxLength = 4096;
        input.dataset.row = String(r);
        input.dataset.col = String(c);
        input.setAttribute(
          "aria-label",
          t("第 {0} 行，第 {1} 列源码", [r + 1, c + 1]),
        );
        input.onfocus = () => {
          row = r;
          col = c;
          reflect();
        };
        input.oninput = () => {
          const next = structuredClone(model);
          next.cells[r][c] = input.value;
          if (!commit(next, false)) input.value = model.cells[r][c];
        };
        input.onkeydown = (event) => {
          if (event.key !== "Tab" || event.isComposing || composing) return;
          const index = r * cells.length + c + (event.shiftKey ? -1 : 1);
          if (index < 0 || index >= model.cells.length * cells.length) return; // Leave grid at either edge.
          event.preventDefault();
          row = Math.floor(index / cells.length);
          col = index % cells.length;
          focusCell();
        };
        if (r === 0) {
          const handle = document.createElement("button");
          handle.textContent = "↔";
          handle.draggable = true;
          handle.setAttribute("aria-label", t("拖动第 {0} 列", [c + 1]));
          handle.ondragstart = (event) => {
            if (composing) {
              event.preventDefault();
              return;
            }
            dragColumn = c;
            event.dataTransfer?.setData("text/plain", String(c));
          };
          handle.ondragend = () => {
            dragColumn = null;
          };
          td.ondragover = (event) => {
            if (dragColumn !== null) event.preventDefault();
          };
          td.ondrop = (event) => {
            event.preventDefault();
            if (dragColumn !== null) {
              col = dragColumn;
              dragColumn = null;
              moveColumn(c);
            }
          };
          td.append(handle);
        }
        td.append(input);
        tr.append(td);
      });
      table.append(tr);
    });
    grid.append(table);
    source.hidden = true;
    grid.hidden = false;
    raw = false;
    message.textContent = t(
      "单元格填写 Markdown 源码；竖线自动转义。表头不参与排序，Tab 在格间移动，边缘退出。应用后仍需保存。",
    );
    reflect();
    focusCell();
  }
  function reload() {
    try {
      model = parseTable(view.state.doc.toString());
      render();
    } catch {
      raw = true;
      grid.hidden = true;
      source.hidden = false;
      fail();
      reflect();
    }
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
      try {
        parseTable(view.state.doc.toString());
        return true;
      } catch {
        fail();
        return false;
      }
    },
    get composing() {
      return composing;
    },
  };
}
