/* Loaded-fact browsing only. No retrieval, persistence, or event history. GPLv3. */
export interface BrowserFact {
  fact_id: number; content: string; category?: string | null;
  created_at?: string | null; updated_at?: string | null;
}
export type TimeAxis = "created_at" | "updated_at";
export type CategoryKey = { kind: "missing" } | { kind: "value"; value: string };
export type TimeBranch = string | null; // null = All, unknown, or UTC YYYY[-MM[-DD]]
export interface Filters { query: string; category: CategoryKey | null; branch: TimeBranch; axis: TimeAxis }
export const PAGE_SIZE = 100;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function categoryKey(value: unknown): CategoryKey {
  return typeof value === "string" ? { kind: "value", value } : { kind: "missing" };
}
export function categoryToken(key: CategoryKey): string {
  return key.kind === "missing" ? "missing" : "value:" + key.value;
}
export function categoryLabel(key: CategoryKey): string {
  return key.kind === "missing" ? "Missing category" : key.value === "" ? "Blank category (empty string)" : key.value;
}
/** Naive timestamps are UTC under the provider/retriever contract, not local time. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const zone = m[8];
  let offset = 0;
  if (zone && zone !== "Z") {
    const h = Number(zone.slice(1, 3)), min = Number(zone.slice(4));
    if (zone === "-00:00" || h > 14 || min > 59 || (h === 14 && min !== 0)) return null;
    offset = (h * 60 + min) * (zone[0] === "-" ? -1 : 1);
  }
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, Number((m[7] || "").padEnd(3, "0").slice(0, 3)));
  const result = d.getTime() - offset * 60000;
  const utcYear = new Date(result).getUTCFullYear();
  return utcYear < 1 || utcYear > 9999 ? null : result;
}
export interface IndexedFact { fact: BrowserFact; category: CategoryKey; token: string; search: string; created_at: string | null; updated_at: string | null }
export function indexFacts(facts: Iterable<BrowserFact>): IndexedFact[] {
  const date = (value: unknown) => { const n = parseTimestamp(value); return n === null ? null : new Date(n).toISOString().slice(0, 10); };
  return Array.from(facts, fact => {
    const category = categoryKey(fact.category);
    return { fact, category, token: categoryToken(category), search: (fact.content + "\n" + fact.fact_id + "\nf#" + String(fact.fact_id).padStart(4, "0")).toLowerCase(), created_at: date(fact.created_at), updated_at: date(fact.updated_at) };
  }).sort((a, b) => a.fact.fact_id - b.fact.fact_id);
}
export function factDateLabel(row: IndexedFact, axis: TimeAxis): string {
  return `${axis === "created_at" ? "Stored" : "Last updated"}: ${row[axis] || "Unknown"} UTC`;
}
export function filterFacts(index: IndexedFact[], filters: Filters): IndexedFact[] {
  const q = filters.query.toLowerCase(), cat = filters.category && categoryToken(filters.category);
  return index.filter(row => (!q || row.search.includes(q)) && (cat === null || row.token === cat) &&
    (filters.branch === null || (filters.branch === "unknown" ? row[filters.axis] === null : row[filters.axis]?.startsWith(filters.branch))));
}
export interface CategoryGroup { key: CategoryKey; token: string; count: number }
export function categoryGroups(rows: IndexedFact[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const row of rows) { const group = groups.get(row.token); if (group) group.count++; else groups.set(row.token, { key: row.category, token: row.token, count: 1 }); }
  return [...groups.values()].sort((a, b) => b.count - a.count || compare(a.token, b.token));
}
export interface TimeGroup { branch: string; count: number }
export function timeGroups(rows: IndexedFact[], axis: TimeAxis, branch: TimeBranch): TimeGroup[] {
  if (branch === "unknown" || branch?.length === 10) return [];
  const length = branch === null ? 4 : branch.length === 4 ? 7 : 10;
  const groups = new Map<string, number>();
  for (const row of rows) {
    const date = row[axis];
    if (branch !== null && !date?.startsWith(branch)) continue;
    const key = date === null ? "unknown" : date.slice(0, length);
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups].map(([branch, count]) => ({ branch, count })).sort((a, b) => a.branch === "unknown" ? 1 : b.branch === "unknown" ? -1 : compare(b.branch, a.branch));
}
export function paginate<T>(rows: readonly T[], requested: number) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages - 1, Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0));
  return { items: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), page, pages, total: rows.length };
}
