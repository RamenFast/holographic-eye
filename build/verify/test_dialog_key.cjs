#!/usr/bin/env node
"use strict";
// Source-only synthetic VM checks. No socket, provider, browser, or shared dist build.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("../eye_frontend/node_modules/esbuild");
const root = path.resolve(__dirname, "../eye_frontend/src");
const source = fs.readFileSync(path.join(root, "modals.ts"), "utf8");
// Expose pure private render helpers to this test bundle only.
const bundle = buildSync({ stdin: { contents: source +
  '\nexport { keyCategories, categoryRows, legendHtml }; export { store, catColor, applyTheme, THEMES } from "./state";',
  resolveDir: root, loader: "ts" }, bundle: true, platform: "browser", format: "iife",
  globalName: "subject", write: false, target: "es2022" }).outputFiles[0].text;
let document;
class Element extends EventTarget {
  constructor(kind = "div") { super(); this.kind = kind; this.children = []; this.style = {}; this.dataset = {}; }
  set innerHTML(value) {
    this.html = value;
    if (value.includes('class="modal"')) {
      this.dialog = new Element("dialog"); this.close = new Element("button");
      this.dialog.parent = this; this.close.parent = this; this.children = [this.dialog, this.close];
    }
  }
  get innerHTML() { return this.html; }
  appendChild(child) { child.parent = this; this.children.push(child); }
  contains(child) { return child === this || this.children.some(x => x.contains(child)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  querySelector(selector) { return selector === ".m-close" ? this.close : selector === ".modal" ? this.dialog : null; }
  querySelectorAll() { return this.close ? [this.close] : []; }
  closest() { return null; }
  matches() { return false; }
  getClientRects() { return [{}]; }
  focus() { document.activeElement = this; }
}
const body = new Element(); const prior = new Element("button"); body.appendChild(prior);
document = { body, activeElement: prior, documentElement: new Element(),
  createElement: () => new Element(), contains: el => body.contains(el),
  querySelectorAll: () => [], getElementById: () => prior };
const listeners = new Set(); const microtasks = [];
const context = vm.createContext({ console, document, HTMLElement: Element, Event, EventTarget,
  matchMedia: () => ({ matches: false }),
  getComputedStyle: () => ({ visibility: "visible", getPropertyValue: () => "" }),
  localStorage: { getItem: () => null, setItem() {} },
  addEventListener: (name, fn) => { if (name === "keydown") listeners.add(fn); },
  removeEventListener: (name, fn) => { if (name === "keydown") listeners.delete(fn); },
  queueMicrotask: fn => microtasks.push(fn),
  fetch: () => { throw Error("Unexpected network request"); },
});
context.window = context;
vm.runInContext(bundle, context);
const api = context.subject;
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function flush() { while (microtasks.length) microtasks.shift()(); }
function key(name) {
  const event = { key: name, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  [...listeners].forEach(fn => fn(event)); return event;
}
api.applyTheme("blossom_dark");
let permit = false, closes = 0;
const halo = { entities: ["fixture"], factIds: new Set([1]) };
api.store.reasonHalo = halo; api.store.selection.add(1);
const back = api.modal("draft", "synthetic", 720, { beforeClose: () => permit, preserveReasonHalo: true });
back.addEventListener("eye:close", () => closes++);
flush();
check("close guard refuses every close path", () => {
  assert.equal(api.closeModal(back), false);
  back.close.onclick(); back.onclick({ target: back });
  const event = key("Escape");
  assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.equal(api.modalIsOpen(back), true); assert.equal(closes, 0); assert.equal(listeners.size, 1);
});
check("refused replacement returns null and retains original", () => {
  assert.equal(api.modal("replacement", "none"), null);
  assert.equal(body.children.length, 2); assert.equal(api.store.reasonHalo, halo);
});
check("existing callers stop before new modal handlers", () => {
  api.openDeleteModal(1, { content: "fixture", category: "tool", trust_score: 0.5 });
  api.openAskAgent([]); api.openSettings(); api.openHelp(); api.openFieldKey();
  assert.equal(body.children.length, 2); assert.equal(closes, 0);
});
check("accepted close emits once, removes listener and restores focus", () => {
  permit = true; assert.equal(api.closeModal(back), true); assert.equal(api.closeModal(back), false);
  assert.equal(closes, 1); assert.equal(listeners.size, 0); assert.equal(document.activeElement, prior);
  assert.equal(api.store.reasonHalo, halo); assert.equal(api.store.selection.has(1), true);
});
check("preserving replacement retains existing Reason", () => {
  const first = api.modal("workbench", "fixture"); flush();
  const second = api.modal("key", "fixture", 700, { preserveReasonHalo: true }); flush();
  assert.equal(api.modalIsOpen(first), false); assert.equal(api.store.reasonHalo, halo);
  api.closeModal(second); assert.equal(api.store.reasonHalo, halo);
});
check("legacy modal close still clears Reason", () => {
  const ordinary = api.modal("legacy", "fixture"); api.closeModal(ordinary);
  assert.equal(api.store.reasonHalo, null); flush(); assert.equal(document.activeElement, prior);
});
check("closed modal microtask cannot steal focus", () => {
  const first = api.modal("first", "fixture"); api.closeModal(first);
  const second = api.modal("second", "fixture"); flush();
  assert.equal(document.activeElement, second.close); api.closeModal(second);
});
for (let i = 0; i < 80; i++) api.store.facts.set(i, { category: `custom-${i}` });
api.store.facts.set(99, { category: '<img src=x onerror="bad">' });
check("category union includes canonical and loaded with 24-row bound", () => {
  const categories = api.keyCategories(); assert.equal(categories.length, 88);
  assert.equal(new Set(categories).size, categories.length);
  assert.equal((api.categoryRows(categories, 0).match(/<tr>/g) || []).length, 24);
  assert.equal((api.categoryRows(categories, 3).match(/<tr>/g) || []).length, 16);
  assert.ok(api.categoryRows(categories, 3).includes("&lt;img"));
  assert.ok(!api.categoryRows(categories, 3).includes("<img"));
});
check("key colors equal renderer samples in all ten themes", () => {
  assert.equal(api.THEMES.length, 10);
  for (const theme of api.THEMES) {
    api.applyTheme(theme.id);
    for (const category of ["tool", "general", "user_pref", "custom-name"]) {
      const rows = api.categoryRows([category], 0);
      for (const trust of [0, 0.5, 1]) assert.ok(rows.includes(api.catColor(category, trust, 0.55 + trust * 0.45)));
    }
  }
});
check("key explains truthful size, rings, context and Reason limits", () => {
  const html = api.legendHtml();
  for (const text of ["journal-observed", "higher stored count", "limit 20", "×0.12", "×0.35", "×0.07", "does not encode age", "not causal links"])
    assert.ok(html.includes(text), text);
  for (const count of [0, 5, 50]) {
    const size = 2 * Math.max(2, Math.min(8, 2 + Math.log(1 + count) * 1.5));
    assert.ok(html.includes(`width:${size}px;height:${size}px`));
  }
  assert.ok(!source.includes("recall accuracy degrades"));
});
console.log(JSON.stringify({ status: "ok", checks, scope: "synthetic VM lifecycle and key model; no browser proof" }));
