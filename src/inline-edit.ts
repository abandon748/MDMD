// markdown-it maps are zero-based, end-exclusive lines; DOM metadata is one-based.
export function blockRange(source: string, start: number, end: number) {
  const offsets = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") offsets.push(i + 1);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end <= start ||
    start > offsets.length ||
    end > offsets.length + 1
  )
    throw new Error("Invalid source block");
  return { from: offsets[start - 1], to: offsets[end - 1] ?? source.length };
}

export function blockReplacement(original: string, draft: string) {
  // Lists may include separator blank lines in their source map. Keep the full
  // separator so applying a block cannot absorb its following paragraph/table.
  const before = original.match(/\n*$/)![0].length;
  const after = draft.match(/\n*$/)![0].length;
  return draft && after < before ? draft + "\n".repeat(before - after) : draft;
}

// Rendered code omits fences/indentation. Map by line and verify the literal
// text before using the position; never search for a repeated word globally.
export function codeSourcePosition(
  source: string,
  code: string,
  offset: number,
) {
  if (!Number.isInteger(offset) || offset < 0 || offset > code.length)
    return null;
  const raw = source.split("\n");
  const visible = code.split("\n");
  const start = /^ {0,3}(?:`{3,}|~{3,})/.test(raw[0]) ? 1 : 0;
  let base = start ? raw[0].length + 1 : 0;
  for (let row = 0; row < visible.length; row++) {
    const line = raw[start + row];
    const text = visible[row];
    if (line === undefined || !line.endsWith(text)) return null;
    const indent = line.length - text.length;
    if (!/^[ \t]*$/.test(line.slice(0, indent))) return null;
    if (offset <= text.length) return base + indent + offset;
    offset -= text.length + 1;
    base += line.length + 1;
  }
  return null;
}
