import type { DiagramLabel } from "./diagrams";
import { t } from "./i18n";

interface Field {
  kind: string;
  text: string;
  from: number;
  to: number;
  prefix?: string;
  actor?: string;
}

// Keep Mermaid's layout and original source. Only replace the text of a
// recognized declaration. Never rebuild a sequence or subgraph from its SVG.
export function diagramFields(source: string): Field[] {
  if (source.length > 32768) return [];
  const lines = source.split("\n");
  const fence = /^(\x60{3,}|~{3,})mermaid\s*$/.exec(lines[0]);
  if (!fence) return [];
  let last = lines.length - 1;
  if (lines[last] === "") last--;
  if (
    !new RegExp("^" + fence[1][0] + "{" + fence[1].length + ",}\\s*$").test(
      lines[last],
    )
  )
    return [];
  const fields: Field[] = [];
  let offset = lines[0].length + 1,
    kind = "";
  for (const line of lines.slice(1, last)) {
    const start = offset;
    offset += line.length + 1;
    if (!line.trim() || line.trimStart().startsWith("%%")) continue;
    if (!kind) {
      if (/^\s*sequenceDiagram\s*$/.test(line)) kind = "sequence";
      else if (/^\s*(graph|flowchart)\s+(LR|RL|TB|BT|TD)\s*;?\s*$/.test(line))
        kind = "flow";
      else return [];
      continue;
    }
    const add = (
      role: string,
      text: string,
      column: number,
      prefix = "",
      actor?: string,
    ) =>
      fields.push({
        kind: role,
        text,
        from: start + column,
        to: start + column + (prefix ? 0 : text.length),
        prefix,
        actor,
      });
    if (kind === "sequence") {
      const actor =
        /^(\s*(?:participant|actor)\s+)([\w-]+)(?:([ \t]+as[ \t]+)(.+?))?\s*$/.exec(
          line,
        );
      if (actor) {
        const column = actor[1].length + actor[2].length;
        if (actor[3])
          add("actor", actor[4], column + actor[3].length, "", actor[2]);
        else add("actor", actor[2], column, " as ", actor[2]);
        continue;
      }
      const row =
        /^(\s*(Note\s+(?:over|(?:left|right)\s+of)\s+[\w-]+(?:\s*,\s*[\w-]+)?|[\w-]+\s*(?:<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*[\w-]+)\s*:\s*)(.+?)\s*$/i.exec(
          line,
        );
      if (row && !row[3].includes(";"))
        add(
          /^Note\s/i.test(row[2]) ? "note" : "message",
          row[3],
          row[1].length,
        );
    } else if (/^\s*[\w-]+\s*(?:[[({]|--|==|-\.)/.test(line)) {
      for (const m of line.matchAll(
        /(?:^|[\s>])([\w-]+)\s*([[({])("([^"]+)"|([^"[\](){}<>|]+?))([\])}])/g,
      )) {
        const value = m[4] ?? m[5];
        add(
          "node",
          value,
          m.index! + m[0].indexOf(m[2]) + 1 + (m[4] === undefined ? 0 : 1),
        );
      }
      for (const m of line.matchAll(/(?:-->|==>|-\.->)\s*\|([^|]+)\|/g))
        add("edge", m[1], m.index! + m[0].indexOf("|") + 1);
    }
  }
  return fields;
}

export function mountDiagramLabels(
  container: HTMLElement,
  labels: DiagramLabel[],
  fields: Field[],
  draft: string,
  replace: (from: number, to: number, value: string) => void,
) {
  container.classList.add("diagram-edit-surface");
  let active: { input: HTMLInputElement; field: Field } | undefined;
  let composing = false;
  function commit() {
    if (!active) return true;
    const { input, field } = active;
    const value = input.value.trim();
    if (
      composing ||
      !value ||
      /[<>&;"\x60\r\n]/.test(value) ||
      ((field.kind === "node" || field.kind === "edge") &&
        /[[\](){}|]/.test(value))
    ) {
      input.setCustomValidity(t("请输入单行普通文字。"));
      input.reportValidity();
      return false;
    }
    active = undefined;
    input.remove();
    if (value !== field.text)
      replace(field.from, field.to, (field.prefix || "") + value);
    return true;
  }
  let pick: "message" | "note" | undefined,
    sender = "";
  const instructions = document.createElement("span");
  const appendLine = (line: string) => {
    const at = draft.trimEnd().lastIndexOf("\n") + 1;
    if (draft.length + line.length + 3 <= 32768)
      replace(at, at, "  " + line + "\n");
    else instructions.textContent = t("图表过大，已保留源码");
  };
  if (fields.some((f) => f.actor)) {
    const bar = document.createElement("div");
    bar.className = "table-controls";
    const tool = (name: string, action: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t(name);
      b.onclick = () => {
        if (!composing && commit() && b.isConnected) action();
      };
      bar.append(b);
      return b;
    };
    tool("添加参与者", () => {
      let n = 1;
      while (new RegExp("\\bP" + n + "\\b").test(draft)) n++;
      appendLine("participant P" + n + " as " + t("新参与者") + " " + n);
    });
    tool("添加消息", () => {
      pick = "message";
      sender = "";
      instructions.textContent = t("依次点击发送方和接收方。");
    });
    tool("添加备注", () => {
      pick = "note";
      instructions.textContent = t("点击要添加备注的参与者。");
    });
    const cancelPick = tool("取消", () => {
      pick = undefined;
      sender = "";
      instructions.textContent = "";
      cancelPick.hidden = true;
    });
    cancelPick.hidden = true;
    bar.addEventListener("click", () => {
      cancelPick.hidden = !pick;
    });
    bar.append(instructions);
    container.before(bar);
  }
  for (const hit of labels) {
    if (
      !hit ||
      typeof hit.text !== "string" ||
      ![hit.x, hit.y, hit.w, hit.h].every(Number.isFinite) ||
      hit.w <= 0 ||
      hit.h <= 0
    )
      continue;
    const matches = fields.filter(
      (f) => f.kind === hit.kind && f.text === hit.text,
    );
    const same = labels.filter(
      (h) => h.kind === hit.kind && h.text === hit.text,
    );
    const field =
      matches.length === 1 && (same.length === 1 || hit.kind === "actor")
        ? matches[0]
        : (hit.kind === "message" || hit.kind === "note") &&
            matches.length === same.length
          ? matches[same.indexOf(hit)]
          : undefined;
    if (!field) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "diagram-hit";
    b.dataset.labelKind = field.kind;
    b.setAttribute("aria-label", t("编辑图中文字：{0}", [field.text]));
    b.style.left = hit.x * 100 + "%";
    b.style.top = hit.y * 100 + "%";
    b.style.width = hit.w * 100 + "%";
    b.style.height = hit.h * 100 + "%";
    b.onclick = () => {
      if (!commit() || !b.isConnected) return;
      if (pick) {
        if (!field.actor) return;
        if (pick === "note")
          appendLine("Note over " + field.actor + ": " + t("新备注"));
        else if (sender)
          appendLine(sender + "->>" + field.actor + ": " + t("新消息"));
        else {
          sender = field.actor;
          instructions.textContent = t("点击接收方。");
        }
        return;
      }
      const input = document.createElement("input");
      input.style.cssText = b.style.cssText;
      input.style.minWidth = "6ch";
      input.style.minHeight = "1.5em";
      input.value = field.text;
      input.maxLength = 2000;
      input.setAttribute("aria-label", b.getAttribute("aria-label")!);
      active = { input, field };
      input.addEventListener("compositionstart", () => {
        composing = true;
      });
      input.addEventListener("compositionend", () => {
        composing = false;
      });
      input.oninput = () => input.setCustomValidity("");
      input.onblur = () => {
        if (!composing) commit();
      };
      input.onkeydown = (e) => {
        if (composing || e.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          active = undefined;
          input.remove();
          b.focus();
        }
        if (e.key === "Enter" && !e.ctrlKey) {
          e.stopPropagation();
          e.preventDefault();
          if (commit() && b.isConnected) b.focus();
        }
      };
      container.append(input);
      input.focus();
      input.select();
    };
    container.append(b);
  }
  return {
    commit,
    get composing() {
      return composing;
    },
  };
}
