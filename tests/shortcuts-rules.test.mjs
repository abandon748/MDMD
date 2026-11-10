import assert from "node:assert/strict";
import {
  presets,
  bindings,
  defaultShortcuts,
  validShortcuts,
  bindingError,
  combinationError,
  eventCombination,
} from "../src/shortcuts.ts";
const config = defaultShortcuts();
assert(validShortcuts(config));
for (const scheme of Object.keys(presets)) {
  const active = bindings({ ...config, scheme });
  assert.equal(Object.keys(active).length, 22);
  const assigned = Object.values(active).filter(Boolean);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.equal(assigned.length, scheme === "mdmd" ? 20 : 22);
  for (const key of Object.values(active))
    assert.equal(combinationError(key), null);
}
assert.equal(presets.mdmd.redo, "Ctrl+Y");
assert.equal(presets.typora.redo, "Ctrl+Shift+Z");
assert.equal(presets.obsidian.inline, "Ctrl+E");
for (const scheme of Object.keys(presets)) {
  assert.equal(presets[scheme].split, "F3");
  assert.equal(presets[scheme].external, "F4");
  assert.equal(presets[scheme].quote, scheme === "mdmd" ? "" : "Ctrl+Shift+Q");
  assert.equal(presets[scheme].code, scheme === "mdmd" ? "" : "Ctrl+Shift+`");
}
assert.equal(
  bindings(config).quote,
  "",
  "unbound default must not receive an automatic fallback",
);
assert.equal(bindingError(config, "quote", ""), null);
const migrated = defaultShortcuts();
migrated.scheme = "obsidian";
migrated.overrides.obsidian.open = "F3";
migrated.overrides.obsidian.find = "Ctrl+E";
assert(
  validShortcuts(migrated),
  "old custom keys survive new preset collisions",
);
assert.equal(bindings(migrated).open, "F3");
assert.equal(bindings(migrated).find, "Ctrl+E");
assert.notEqual(bindings(migrated).split, "F3");
assert.notEqual(bindings(migrated).inline, "Ctrl+E");
const customQuote = defaultShortcuts();
customQuote.overrides.mdmd.quote = "Ctrl+Shift+Q";
assert(validShortcuts(customQuote));
assert.equal(bindings(customQuote).quote, "Ctrl+Shift+Q");
assert.match(bindingError(config, "open", "Ctrl+S"), /保存/);
assert.equal(bindingError(config, "open", "Ctrl+Shift+O"), null);
for (const key of [
  "A",
  "Ctrl+A",
  "Ctrl+C",
  "Ctrl+Shift+C",
  "Ctrl+D",
  "Ctrl+Tab",
  "Alt+F4",
  "Win+L",
  "Ctrl+W",
  "F5",
  "F11",
  "F12",
  "Ctrl+Shift+K",
])
  assert(combinationError(key), key);
for (const bad of [
  null,
  [],
  {},
  { ...config, scheme: "unknown" },
  { ...config, overrides: { mdmd: {}, typora: {} } },
  {
    ...config,
    overrides: { ...config.overrides, obsidian: { open: "Ctrl+S" } },
  },
  { ...config, overrides: { ...config.overrides, mdmd: { unknown: "F6" } } },
  { ...config, overrides: { ...config.overrides, typora: { open: 3 } } },
  { ...config, overrides: { ...config.overrides, mdmd: { open: "Ctrl+A" } } },
])
  assert.equal(validShortcuts(bad), false);
const event = {
  key: "O",
  code: "KeyO",
  ctrlKey: true,
  shiftKey: true,
  getModifierState: () => false,
};
assert.equal(eventCombination(event), "Ctrl+Shift+O");
assert.equal(
  eventCombination({ ...event, key: "<", code: "Comma" }),
  "Ctrl+Shift+,",
);
assert.equal(eventCombination({ ...event, isComposing: true }), null);
assert.equal(eventCombination({ ...event, keyCode: 229 }), null);
assert.equal(
  eventCombination({ ...event, getModifierState: () => true }),
  null,
);
const independent = defaultShortcuts();
independent.overrides.mdmd.open = "F6";
assert.equal(bindings(independent).open, "F6");
assert.equal(bindings({ ...independent, scheme: "typora" }).open, "Ctrl+O");
assert(validShortcuts(independent));
console.log(
  "PASS: 3 presets, 22 actions, independent overrides, canonical combinations, conflicts/reserved keys, strict stored record validation, IME/AltGraph guards.",
);

const legacyF4 = defaultShortcuts();
legacyF4.overrides.mdmd.new = "F4";
assert(validShortcuts(legacyF4));
assert.equal(bindings(legacyF4).new, "F4");
assert.equal(bindings(legacyF4).external, "F6");
assert.match(bindingError(defaultShortcuts(), "new", "F4"), /外部编辑/);

const oldF2 = defaultShortcuts();
oldF2.overrides.mdmd.new = "F2";
assert(validShortcuts(oldF2));
assert.equal(bindings(oldF2).new, "F2");
assert.equal(bindings(oldF2).inline, "F6");
assert.equal(presets.typora.inline, "Ctrl+/");
assert.equal(combinationError("Ctrl+/"), null);
assert.match(bindingError(config, "open", "F2"), /就地编辑/);
