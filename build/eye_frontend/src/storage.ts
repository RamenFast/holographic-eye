/* Best-effort browser storage. Denied persistence must not block the cockpit. GPLv3. */
const memory = new Map<string, string | null>();

export function getStored(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function setStored(key: string, value: string): void {
  memory.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* this page keeps its value */ }
}

export function removeStored(key: string): void {
  memory.set(key, null);
  try { localStorage.removeItem(key); } catch { /* memory still forgets it */ }
}
