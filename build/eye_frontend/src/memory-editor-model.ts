/* Staged memory edits. Existing RPC only. GPLv3, see LICENSE. */
export type DetailKey = "content" | "category" | "tags";
export const DETAIL_KEYS: DetailKey[] = ["content", "category", "tags"];
export type Fact = { fact_id: number; content: string; category: string; tags: string;
  trust_score: number; [key: string]: any };
export type Call = (method: string, params?: any) => Promise<any>;
export type Receipt = { event_id: number; action: string };

export function checkedFact(value: any, id: number): Fact {
  if (!value || value.fact_id !== id || DETAIL_KEYS.some(key => typeof value[key] !== "string") ||
      typeof value.trust_score !== "number" || !Number.isFinite(value.trust_score)) {
    throw new Error("The saved fact response is incomplete. Reload the fact before editing.");
  }
  return { ...value };
}

export class MemoryDraft {
  base: Fact;
  values: Record<DetailKey, string>;
  trustText: string;
  current: Fact;
  evidenceStale = false;
  preview: any = null;
  private previewKey = "";
  busy = false;
  writing = false;
  unknown = false;
  status = "Changes stay here until you save.";
  conflicts: string[] = [];
  receipts: Receipt[] = [];

  constructor(fact: Fact) {
    this.base = checkedFact(fact, fact.fact_id);
    this.current = { ...this.base };
    this.values = { content: fact.content, category: fact.category, tags: fact.tags };
    this.trustText = String(fact.trust_score);
  }
  get id(): number { return this.base.fact_id; }
  get patch(): Partial<Record<DetailKey, string>> {
    return Object.fromEntries(DETAIL_KEYS.filter(key => this.values[key] !== this.base[key])
      .map(key => [key, this.values[key]]));
  }
  get detailsDirty(): boolean { return Object.keys(this.patch).length > 0; }
  get trustDirty(): boolean { return this.trustText.trim() === "" || Number(this.trustText) !== this.base.trust_score; }
  get dirty(): boolean { return this.detailsDirty || this.trustDirty; }
  get exitRisk(): boolean { return this.dirty || this.writing || this.unknown; }
  get previewReady(): boolean {
    return !!this.preview && this.previewKey === JSON.stringify(this.patch);
  }
  get errors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!this.values.content.trim()) errors.content = "Memory text is empty. Add text, or use Delete memory in Inspect.";
    if (!this.values.category.trim()) errors.category = "Category is empty. Enter a category.";
    const trust = Number(this.trustText);
    if (!this.trustText.trim() || !Number.isFinite(trust) || trust < 0 || trust > 1)
      errors.trust = "Enter a trust value from 0 to 1.";
    return errors;
  }
  change(key: DetailKey, value: string): void {
    this.values[key] = value;
    this.preview = null;
    this.previewKey = "";
    if (!this.unknown) this.status = "Detail draft changed. Preview it before saving.";
  }
  private begin(message: string, writing = false): void {
    if (this.busy) throw new Error("An editor request is still running. Wait for its result.");
    if (this.unknown) throw new Error("Save outcome unknown. Inspect current state and journal before retrying.");
    this.busy = true;
    this.writing = writing;
    this.status = message;
    this.conflicts = [];
  }
  private fail(error: any): void {
    if (error?.outcome === "unknown") this.unknown = true;
    this.status = String(error?.message ?? error);
  }
  private async preflight(call: Call, keys: string[]): Promise<void> {
    this.current = checkedFact((await call("fact.get", { fact_id: this.id })).fact, this.id);
    this.evidenceStale = false;
    this.conflicts = keys.filter(key => this.current[key] !== this.base[key]);
    if (this.conflicts.length) {
      this.preview = null;
      throw new Error(`Saved ${this.conflicts.join(", ")} changed since this draft opened. Compare the saved values below.`);
    }
  }
  async loadPreview(call: Call): Promise<void> {
    this.begin("Checking saved details and previewing changes…");
    try {
      if (this.errors.content || this.errors.category) throw new Error("Check the marked detail fields.");
      if (!this.detailsDirty) throw new Error("There are no detail changes to preview.");
      await this.preflight(call, DETAIL_KEYS);
      const patch = this.patch;
      const result = await call("fact.preview_update", { fact_id: this.id, ...patch });
      if (!result?.before || !result?.after ||
          DETAIL_KEYS.some(key => typeof result.before[key] !== "string" || typeof result.after[key] !== "string") ||
          !Array.isArray(result.predicted_entities) || !Array.isArray(result.entities_removed) ||
          !Array.isArray(result.bank_impact)) throw new Error("The preview response is incomplete. Retry Preview changes.");
      if (DETAIL_KEYS.some(key => result.before[key] !== this.base[key]))
        throw new Error("Saved details changed during preview. Inspect current saved state before saving.");
      this.preview = result;
      this.previewKey = JSON.stringify(patch);
      this.status = "Preview ready. Save details applies only text, category, and tags.";
    } catch (error) { this.preview = null; this.fail(error); }
    finally { this.busy = false; this.writing = false; }
  }
  async saveDetails(call: Call): Promise<void> {
    this.begin("Checking saved details before saving…", true);
    try {
      if (!this.previewReady || !this.detailsDirty) throw new Error("Preview the current detail changes before saving.");
      if (this.errors.content || this.errors.category) throw new Error("Check the marked detail fields.");
      await this.preflight(call, DETAIL_KEYS);
      const result = await call("fact.update", { fact_id: this.id, ...this.patch });
      this.record(result, "Saved details");
      const saved = this.savedResponse(result);
      const trustWasDirty = this.trustDirty;
      for (const key of DETAIL_KEYS) { this.base[key] = saved[key]; this.values[key] = saved[key]; }
      if (!trustWasDirty) { this.base.trust_score = saved.trust_score; this.trustText = String(saved.trust_score); }
      this.current = { ...this.current, ...saved };
      this.evidenceStale = true;
      this.preview = null;
      this.status = `Details saved. Journal event #${result.event_id}. Fact trust uses its separate Set trust action.`;
      await this.refreshEvidence(call);
    } catch (error) { this.fail(error); }
    finally { this.busy = false; this.writing = false; }
  }
  async setTrust(call: Call): Promise<void> {
    this.begin("Checking saved trust before setting it…", true);
    try {
      if (this.errors.trust) throw new Error(this.errors.trust);
      if (!this.trustDirty) throw new Error("Fact trust has not changed.");
      await this.preflight(call, ["trust_score"]);
      const result = await call("fact.trust_set", { fact_id: this.id, trust: Number(this.trustText) });
      this.record(result, "Set fact trust");
      const saved = this.savedResponse(result);
      this.base.trust_score = saved.trust_score;
      this.trustText = String(saved.trust_score);
      this.current = { ...this.current, ...saved };
      this.evidenceStale = true;
      this.status = `Fact trust saved as ${saved.trust_score}. Journal event #${result.event_id}. Detail drafts are unchanged.`;
      await this.refreshEvidence(call);
    } catch (error) { this.fail(error); }
    finally { this.busy = false; this.writing = false; }
  }
  private async refreshEvidence(call: Call): Promise<void> {
    try {
      this.current = checkedFact((await call("fact.get", { fact_id: this.id })).fact, this.id);
      this.evidenceStale = false;
    } catch {
      this.status += " Technical evidence refresh failed. The previous measurements are marked stale. Inspect current saved state to refresh them.";
    }
  }
  private record(result: any, action: string): void {
    if (result?.ok !== true || result?.error || !Number.isSafeInteger(result.event_id) || result.event_id <= 0)
      throw Object.assign(new Error("Save acknowledgment is incomplete. Inspect current state and journal before retrying."), { outcome: "unknown" });
    this.receipts.push({ event_id: result.event_id, action });
  }
  private savedResponse(result: any): Fact {
    try { return checkedFact(result.fact, this.id); }
    catch { throw Object.assign(new Error(`Journal event #${result.event_id} acknowledged the write, but its saved fact is incomplete. Inspect current state and journal.`), { outcome: "unknown" }); }
  }
  async inspectCurrent(call: Call): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.current = checkedFact((await call("fact.get", { fact_id: this.id })).fact, this.id);
      this.evidenceStale = false;
      this.status = this.unknown
        ? "Current state loaded. The earlier outcome remains unresolved. This draft stays blocked against further writes."
        : "Current state loaded for comparison. Your draft has not changed.";
    } catch (error) { this.fail(error); }
    finally { this.busy = false; this.writing = false; }
  }
  useCurrentDetails(): void {
    if (this.busy || this.unknown) return;
    for (const key of DETAIL_KEYS) { this.base[key] = this.current[key]; this.values[key] = this.current[key]; }
    this.preview = null;
    this.conflicts = [];
    this.status = "Loaded the displayed saved details. The previous detail draft was discarded.";
  }
  useCurrentTrust(): void {
    if (this.busy || this.unknown) return;
    this.base.trust_score = this.current.trust_score;
    this.trustText = String(this.current.trust_score);
    this.conflicts = [];
    this.status = "Loaded the displayed saved trust. Detail drafts are unchanged.";
  }
}
