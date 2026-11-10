import MarkdownIt from "markdown-it";
export function wikiTarget(value: string) {
  const [raw, alias] = value.split("|");
  let target = raw.trim();
  if (
    !target ||
    target.length > 4096 ||
    /[:\\\x00-\x1f]/.test(target) ||
    target.startsWith("/")
  )
    return null;
  try {
    if (decodeURIComponent(target).split(/[\\/]/).includes("..")) return null;
  } catch {
    return null;
  }
  const [file, fragment] = target.split("#");
  if (file && !/\.[^/]+$/.test(file))
    target = file + ".md" + (fragment ? "#" + fragment : "");
  return { target, label: alias?.trim() || raw };
}
export function installExtensions(md: InstanceType<typeof MarkdownIt>) {
  md.inline.ruler.before("emphasis", "mdmd-underline", (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== "++") return false;
    const end = state.src.indexOf("++", state.pos + 2),
      inner = state.src.slice(state.pos + 2, end);
    if (end < 0 || !inner || /^\s|\s$|\n/.test(inner)) return false;
    if (!silent) {
      state.push("underline_open", "u", 1);
      state.push("text", "", 0).content = inner;
      state.push("underline_close", "u", -1);
    }
    state.pos = end + 2;
    return true;
  });
  md.core.ruler.before("block", "mdmd-notes-init", (state) => {
    (state.env.mdmdNotes as Record<string, string>) = Object.create(null);
    (state.env.mdmdRefs as string[]) = [];
    state.env.mdmdRefCounts = Object.create(null);
  });
  md.block.ruler.before(
    "reference",
    "mdmd-note",
    (state, start, end, silent) => {
      if (state.env.mdmdNoteBody || state.blkIndent || state.sCount[start] >= 4)
        return false;
      const line = state.src.slice(
        state.bMarks[start] + state.tShift[start],
        state.eMarks[start],
      );
      const match = /^\[\^([\p{L}\p{N}_-]{1,64})\]:[ \t]*(.*)$/u.exec(line);
      if (!match) return false;
      if (silent) return true;
      if (
        Object.keys(state.env.mdmdNotes as Record<string, string>).length >=
          100 ||
        Object.hasOwn(state.env.mdmdNotes as Record<string, string>, match[1])
      ) {
        const open = state.push("paragraph_open", "p", 1);
        open.map = [start, start + 1];
        const text = state.push("inline", "", 0);
        text.content = "\\" + line;
        text.children = [];
        state.push("paragraph_close", "p", -1);
        state.line = start + 1;
        return true;
      }
      const body = [match[2]];
      let next = start + 1;
      // Continuation paragraphs must be indented four spaces (or a tab).
      while (next < end) {
        const raw = state.src.slice(state.bMarks[next], state.eMarks[next]);
        if (/^(?: {4}|\t)/.test(raw)) {
          body.push(raw.replace(/^(?: {4}|\t)/, ""));
          next++;
        } else if (
          !raw.trim() &&
          next + 1 < end &&
          /^(?: {4}|\t)/.test(
            state.src.slice(state.bMarks[next + 1], state.eMarks[next + 1]),
          )
        ) {
          body.push("");
          next++;
        } else break;
      }
      (state.env.mdmdNotes as Record<string, string>)[match[1]] =
        body.join("\n");
      state.line = next;
      return true;
    },
    { alt: ["paragraph", "reference"] },
  );
  md.inline.ruler.before("link", "mdmd-note-ref", (state, silent) => {
    const match = /^\[\^([\p{L}\p{N}_-]{1,64})\]/u.exec(
      state.src.slice(state.pos),
    );
    if (
      !match ||
      state.env.mdmdNoteBody ||
      !Object.hasOwn(
        (state.env.mdmdNotes as Record<string, string>) || {},
        match[1],
      )
    )
      return false;
    if (!silent) {
      const refs: string[] = state.env.mdmdRefs as string[];
      let index = refs.indexOf(match[1]);
      if (index < 0) {
        index = refs.length;
        refs.push(match[1]);
      }
      const counts = state.env.mdmdRefCounts as Record<string, number>;
      const occurrence = (counts[match[1]] = (counts[match[1]] || 0) + 1);
      state.push("html_inline", "", 0).content =
        `<sup class="footnote-ref" id="fnref-${index + 1}-${occurrence}"><a href="#fn-${index + 1}">${index + 1}</a></sup>`;
    }
    state.pos += match[0].length;
    return true;
  });
  md.inline.ruler.before("link", "mdmd-wiki", (state, silent) => {
    const image = state.src.slice(state.pos, state.pos + 3) === "![[";
    const start = state.pos + (image ? 3 : 2);
    if (!image && state.src.slice(state.pos, state.pos + 2) !== "[[")
      return false;
    const end = state.src.indexOf("]]", start);
    if (end < 0) return false;
    const wiki = wikiTarget(state.src.slice(start, end));
    if (!wiki) return false;
    if (image && !/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(wiki.target))
      return false;
    if (!silent) {
      if (image) {
        const token = state.push("image", "img", 0);
        token.attrs = [
          ["src", md.normalizeLink(wiki.target)],
          ["alt", wiki.label],
        ];
        token.content = wiki.label;
        token.children = [];
      } else {
        state
          .push("link_open", "a", 1)
          .attrSet("href", md.normalizeLink(wiki.target));
        state.push("text", "", 0).content = wiki.label;
        state.push("link_close", "a", -1);
      }
    }
    state.pos = end + 2;
    return true;
  });
  md.block.ruler.before(
    "paragraph",
    "mdmd-embed",
    (state, start, _end, silent) => {
      if (state.env.mdmdEmbedded || state.sCount[start] - state.blkIndent >= 4)
        return false;
      const line = state.src.slice(
        state.bMarks[start] + state.tShift[start],
        state.eMarks[start],
      );
      const match = /^!\[\[([^\]\n]+)\]\]$/.exec(line);
      const wiki = match && wikiTarget(match[1]);
      if (!wiki || !/\.(md|markdown|mdown)$/i.test(wiki.target)) return false;
      if (silent) return true;
      const token = state.push("mdmd-embed", "section", 0);
      token.block = true;
      token.map = [start, start + 1];
      token.content = line;
      token.attrSet("data-embed", wiki.target);
      token.attrSet("class", "wiki-embed");
      state.line = start + 1;
      return true;
    },
  );
  md.renderer.rules["mdmd-embed"] = (tokens, i, _o, _e, r) =>
    "<section" +
    r.renderAttrs(tokens[i]) +
    ">" +
    md.utils.escapeHtml(tokens[i].content) +
    "</section>";
  md.core.ruler.after("inline", "mdmd-extensions", (state) => {
    state.tokens.forEach((token, i) => {
      if (token.type !== "blockquote_open") return;
      const inline = state.tokens[i + 2];
      if (inline?.type !== "inline") return;
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/.exec(
        inline.content,
      );
      if (!match) return;
      token.attrJoin("class", "markdown-alert alert-" + match[1].toLowerCase());
      inline.content = inline.content.slice(match[0].length);
      // Keep already parsed references; re-parsing would register them twice.
      if (inline.children?.[0]?.type === "text") {
        inline.children[0].content = inline.children[0].content.replace(
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/,
          "",
        );
        if (!inline.children[0].content) inline.children.shift();
        if (String(inline.children[0]?.type) === "softbreak")
          inline.children.shift();
      }
      inline.children ||= [];
      const title = new state.Token("html_inline", "", 0);
      const icons: Record<string, string> = {
        NOTE: "ⓘ",
        TIP: "♧",
        IMPORTANT: "◆",
        WARNING: "⚠",
        CAUTION: "⊗",
      };
      title.content =
        '<strong class="alert-title"><span aria-hidden="true">' +
        icons[match[1]] +
        "</span> " +
        match[1][0] +
        match[1].slice(1).toLowerCase() +
        "</strong><br>";
      inline.children.unshift(title);
    });
    const refs: string[] = state.env.mdmdRefs as string[];
    if (!refs.length) return;
    const token = new state.Token("html_block", "", 0);
    token.content =
      '<section class="footnotes"><ol>' +
      refs
        .map((label, i) => {
          const env = { mdmdNoteBody: true, mdmdEmbedded: true };
          const children = md.parse(
            (state.env.mdmdNotes as Record<string, string>)[label],
            env,
          );
          // Generated footnotes have no top-level editable source range.
          for (const child of children) {
            child.map = null;
            child.attrs =
              child.attrs?.filter(
                ([name]) =>
                  !["id", "data-line", "data-end-line"].includes(name),
              ) || null;
          }
          const count = (state.env.mdmdRefCounts as Record<string, number>)[
            label
          ];
          const back = Array.from(
            { length: count },
            (_, n) =>
              `<a class="footnote-back" href="#fnref-${i + 1}-${n + 1}" aria-label="↩ ${i + 1}.${n + 1}">↩${count > 1 ? n + 1 : ""}</a>`,
          ).join(" ");
          return `<li id="fn-${i + 1}">${md.renderer.render(children, md.options, env)} ${back}</li>`;
        })
        .join("") +
      "</ol></section>";
    state.tokens.push(token);
  });
  return md;
}
