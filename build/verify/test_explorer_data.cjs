/* Pure model checks. Synthetic data only. Run: node build/verify/test_explorer_data.cjs */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('../eye_frontend/node_modules/esbuild');
const built = buildSync({ entryPoints: [path.join(__dirname, '../eye_frontend/src/explorer-data.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
const moduleObject = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: moduleObject, exports: moduleObject.exports, Date, Map, Set });
const d = moduleObject.exports;
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const iso = value => { const n = d.parseTimestamp(value); return n === null ? null : new Date(n).toISOString(); };
check('naive source contract is UTC, space or T separator', () => {
  assert.equal(iso('2026-09-05 12:34:56'), '2026-09-05T12:34:56.000Z');
  assert.equal(iso('2026-09-05T12:34:56'), iso('2026-09-05T12:34:56Z'));
});
check('timestamp surrounding whitespace is ignored without altering raw source', () => {
  const raw = ' \t2026-01-01T00:00:00Z\n';
  assert.equal(iso(raw), '2026-01-01T00:00:00.000Z');
  const indexed = d.indexFacts([{ fact_id: 1, content: 'x', created_at: raw }]);
  assert.equal(indexed[0].fact.created_at, raw);
  assert.equal(indexed[0].created_at, '2026-01-01');
});
check('fractional source timestamps accept one through six digits', () => {
  assert.equal(iso('2026-09-05 12:34:56.1'), '2026-09-05T12:34:56.100Z');
  assert.equal(iso('2026-09-05 12:34:56.123456'), '2026-09-05T12:34:56.123Z');
});
check('UTC offsets cross day month and year', () => {
  assert.equal(iso('2026-01-01T00:30:00+01:00'), '2025-12-31T23:30:00.000Z');
  assert.equal(iso('2024-02-29T23:30:00-01:00'), '2024-03-01T00:30:00.000Z');
  assert.equal(iso('2026-09-05T14:00:00+14:00'), '2026-09-05T00:00:00.000Z');
  assert.equal(iso('2026-09-05T00:00:00-14:00'), '2026-09-05T14:00:00.000Z');
  assert.equal(iso('2026-09-05T00:00:00+00:00'), '2026-09-05T00:00:00.000Z');
});
check('strict invalid timestamp forms go to Unknown', () => {
  for (const value of [null, undefined, '', 12345, '2026-09-05', '9/5/2026', '2026-09-05T00:00:00-00:00',
    '2026-09-05T00:00:00+14:01', '2026-09-05T00:00:00+15:00', '2026-09-05T00:00:00+01:60',
    '2026-09-05T24:00:00Z', '2026-09-05T23:60:00Z', '2026-09-05T23:59:60Z',
    '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z',
    '0000-01-01T00:00:00Z', '10000-01-01T00:00:00Z', '2026-01-01T00:00:00.1234567Z',
    '2026-01-01t00:00:00z',
    '0001-01-01T00:00:00+01:00', '9999-12-31T23:00:00-02:00']) assert.equal(iso(value), null, String(value));
});
check('Gregorian leap years and years 0001–0099', () => {
  assert.equal(iso('2000-02-29T00:00:00Z'), '2000-02-29T00:00:00.000Z');
  assert.equal(iso('0001-01-01T00:00:00Z'), '0001-01-01T00:00:00.000Z');
  assert.equal(iso('0099-01-01T00:00:00Z'), '0099-01-01T00:00:00.000Z');
  assert.equal(iso('9999-12-31T23:59:59Z'), '9999-12-31T23:59:59.000Z');
});
const cats = ['__proto__', 'constructor', '🌸', 'é', 'é', '', ' ', null, undefined, 'missing', 'value:', 'Missing category'];
const rows = d.indexFacts(cats.map((category, i) => ({ fact_id: i + 1, category, content: 'Original <img> '+i, created_at: '2026-01-01 00:00:00', updated_at: i % 2 ? 'invalid' : '2026-02-02 00:00:00' })));
const all = { query: '', category: null, branch: null, axis: 'created_at' };
check('typed exact categories resist prototype keys, Unicode and sentinel collisions', () => {
  const groups = d.categoryGroups(rows);
  assert.equal(groups.length, cats.length - 1);
  assert.equal(groups[0].key.kind, 'missing'); assert.equal(groups[0].count, 2);
  for (const category of cats.filter(x => typeof x === 'string')) {
    const found = d.filterFacts(rows, { ...all, category: d.categoryKey(category) });
    assert.equal(found.length, 1); assert.equal(found[0].fact.category, category);
  }
  assert.equal(d.filterFacts(rows, { ...all, category: d.categoryKey(null) }).length, 2);
  assert.equal(d.categoryGroups(rows).reduce((n, g) => n + g.count, 0), rows.length);
});
check('query content and ID combine with exact category and time branch', () => {
  assert.equal(d.filterFacts(rows, { ...all, query: 'ORIGINAL' }).length, rows.length);
  assert.equal(d.filterFacts(rows, { ...all, query: 'f#0001', category: d.categoryKey('__proto__'), branch: '2026-01-01' }).length, 1);
  assert.equal(d.filterFacts(rows, { ...all, category: d.categoryKey('__proto__'), branch: 'unknown', axis: 'updated_at' }).length, 0);
  assert.equal(d.filterFacts(rows, { ...all, branch: 'unknown', axis: 'updated_at' }).length, 6);
  assert.equal(rows[0].fact.content, 'Original <img> 0');
});
check('fact date labels name their axis even outside Timeline', () => {
  assert.equal(d.factDateLabel(rows[0], 'created_at'), 'Stored: 2026-01-01 UTC');
  assert.equal(d.factDateLabel(rows[0], 'updated_at'), 'Last updated: 2026-02-02 UTC');
  assert.equal(d.factDateLabel(rows[1], 'updated_at'), 'Last updated: Unknown UTC');
});
check('timeline hierarchy and axis do not fall back to creation date', () => {
  assert.equal(d.timeGroups(rows, 'created_at', null)[0].branch, '2026');
  assert.equal(d.timeGroups(rows, 'created_at', '2026')[0].branch, '2026-01');
  assert.equal(d.timeGroups(rows, 'created_at', '2026-01')[0].branch, '2026-01-01');
  assert.equal(d.timeGroups(rows, 'created_at', '2026-01-01').length, 0);
  const groups = d.timeGroups(rows, 'updated_at', null);
  assert.equal(groups.length, 2); assert.equal(groups[1].branch, 'unknown');
  assert.equal(groups.reduce((n, g) => n + g.count, 0), rows.length);
});
check('paging handles empty, invalid, boundary and refresh-shrunken pages', () => {
  assert.equal(d.paginate([], 99).page, 0); assert.equal(d.paginate([], 99).pages, 1);
  const a = Array.from({ length: 201 }, (_, i) => i);
  assert.equal(d.paginate(a, 0).items.length, 100); assert.equal(d.paginate(a, 1).items[0], 100);
  assert.equal(d.paginate(a, 99).items.length, 1); assert.equal(d.paginate(a, -1).page, 0);
  assert.equal(d.paginate(a, NaN).page, 0); assert.equal(d.paginate(a.slice(0, 3), 2).page, 0);
});
check('20k distinct categories and broad timeline have bounded pages and exact counts', () => {
  const started = performance.now();
  const large = d.indexFacts(Array.from({ length: 20000 }, (_, i) => ({ fact_id: i, content: 'Fact '+i, category: 'category-'+i, created_at: String(1 + i % 9999).padStart(4, '0') + '-01-01 00:00:00' })));
  const categories = d.categoryGroups(large), years = d.timeGroups(large, 'created_at', null);
  assert.equal(categories.length, 20000); assert.equal(years.length, 9999);
  assert.equal(d.paginate(categories, 199).items.length, 100); assert.equal(d.paginate(years, 99).items.length, 99);
  assert.equal(categories.reduce((n, g) => n + g.count, 0), 20000);
  assert.equal(years.reduce((n, g) => n + g.count, 0), 20000);
  assert.equal(d.paginate(large, 0).items.length, 100);
  console.log('20k model build/group ms: '+(performance.now()-started).toFixed(1));
});
// Controller unit checks use an inert DOM double. Browser behavior is covered by responsive QA.
class Element {
  constructor() { this.listeners = new Map(); this.children = []; this.classList = { add() {} }; this.scrollTop = 0; this.value = ''; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
  getAttribute(name) { return this.attributes?.[name]; }
}
const controllerBuild = buildSync({ entryPoints: [path.join(__dirname, '../eye_frontend/src/explorer.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
const controllerModule = { exports: {} };
vm.runInNewContext(controllerBuild.outputFiles[0].text, { module: controllerModule, exports: controllerModule.exports, Date, Map, Set, document: { createElement: () => new Element() } });
check('inactive mode changes preserve saved scroll instead of hidden host zero', () => {
  const host = new Element(), browser = new controllerModule.exports.MemoryExplorer(host);
  browser.active = true; host.scrollTop = 432; browser.setActive(false);
  host.scrollTop = 0; browser.setMode('timeline'); browser.setMode('categories');
  assert.equal(browser.pages.categories.scroll, 432);
  assert.equal(host.scrollTop, 432);
});
check('changing time axis clears only time branch and resets result pages', () => {
  const browser = new controllerModule.exports.MemoryExplorer(new Element());
  browser.filters.branch = '2026-01'; browser.filters.query = 'keep me';
  browser.filters.category = d.categoryKey('exact'); browser.pages.timeline.facts = 4;
  browser.axis.value = 'updated_at'; browser.axis.listeners.get('change')();
  assert.equal(browser.status().axis, 'updated_at'); assert.equal(browser.status().branch, null);
  assert.equal(browser.status().query, 'keep me'); assert.equal(browser.status().category.value, 'exact');
  assert.equal(browser.pages.timeline.facts, 0);
});
check('extra filters start collapsed and preserve mounted controls when toggled', () => {
  const browser = new controllerModule.exports.MemoryExplorer(new Element());
  const query = browser.query, category = browser.category, extra = browser.extraFilters;
  assert.equal(extra.hidden, true);
  assert.equal(browser.filtersToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(browser.filtersToggle.getAttribute('aria-controls'), 'browser-extra-filters');
  browser.filtersToggle.listeners.get('click')();
  assert.equal(extra.hidden, false); assert.equal(browser.filtersToggle.getAttribute('aria-expanded'), 'true');
  browser.filtersToggle.listeners.get('click')();
  assert.equal(extra.hidden, true); assert.equal(browser.query, query); assert.equal(browser.category, category);
});
console.log(JSON.stringify({ status: 'ok', checks }));
