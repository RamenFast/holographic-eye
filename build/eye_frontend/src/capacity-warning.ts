/* Local capacity explanation. No transport or memory mutation dependencies. GPL-3.0-only. */
export interface CapacitySnapshot {
  snr: number | null;
  hrr_dim: number | null;
  facts: number | null;
  null_vectors: number | null;
  min_trust: number | null;
}

export function capacitySnapshot(value: unknown): Readonly<CapacitySnapshot> {
  const s = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const number = (key: string, integer = false, min = 0, max = Infinity): number | null => {
    const n = s[key];
    return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max &&
      (!integer || Number.isSafeInteger(n)) ? n : null;
  };
  const facts = number("facts", true);
  const missing = number("null_vectors", true);
  return Object.freeze({ snr: number("snr"), hrr_dim: number("hrr_dim", true, 1), facts,
    null_vectors: missing !== null && facts !== null && missing > facts ? null : missing,
    min_trust: number("min_trust", false, 0, 1) });
}
const show = (n: number | null): string => n === null ? "Unavailable" : String(n);

export function capacityPrompt(s: Readonly<CapacitySnapshot>): string {
  return `Holographic Eye generated this review request for Ben to paste into Hermes.
Please help me understand the crowding estimate before we change memory.

Observed in the last loaded Eye snapshot:
- Reported SNR estimate: ${show(s.snr)}.
- HRR dimensions: ${show(s.hrr_dim)}.
- Total stored facts: ${show(s.facts)}.
- Facts without vectors: ${show(s.null_vectors)}. These are included in the total when present.
- Minimum trust reported by the provider: ${show(s.min_trust)}.
- Snapshot freshness is not verified.

The provider uses sqrt(dimensions / max(1, total facts)), rounded to three decimals.
The Eye warns when the reported estimate is below 2.0.
This is not measured recall accuracy, a duplicate finding, or evidence of damaged memory.
Fact trust is a separate weight. Changing trust or its visual filter does not change this count-based estimate.

Start with these supplied observations. Use read-only tools to check current memory and representative recall examples as needed.
Separate observations, possible causes, and guidance. Explain safe options without assuming a cause.
Do not change trust, delete or merge facts, rebuild vectors, or change provider settings automatically.
Do not contact another agent or disturb another session.

Give a short explanation, the evidence you found, and practical options.
If evidence is missing or a read fails, say what remains uncertain and name the next useful check.`;
}

let serial = 0;
export class CapacityWarning {
  private latest = capacitySnapshot(null);
  private snapshot = this.latest;
  private anchor: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private restoreAnchor = false;
  private suppressHover = false;
  private readonly id = `capacity-explanation-${++serial}`;
  private geometry: ResizeObserver | null = null;

  constructor(private readonly onLayoutChange: () => void = () => {}) {}

  update(stats: unknown): boolean {
    this.latest = capacitySnapshot(stats);
    const changed = this.panel?.querySelector<HTMLElement>(".capacity-newer");
    if (changed) changed.hidden = JSON.stringify(this.latest) === JSON.stringify(this.snapshot);
    return this.latest.snr !== null && this.latest.snr < 2;
  }

  beforeRender(): void {
    this.restoreAnchor = this.anchor !== null && document.activeElement === this.anchor;
  }

  bind(anchor: HTMLElement | null): void {
    this.anchor?.removeEventListener("pointerenter", this.enter);
    this.anchor?.removeEventListener("pointerleave", this.leave);
    this.anchor?.removeEventListener("click", this.activate);
    this.anchor = anchor;
    if (anchor) {
      anchor.setAttribute("aria-haspopup", "dialog");
      anchor.setAttribute("aria-controls", this.id);
      anchor.setAttribute("aria-expanded", String(this.isOpen()));
      anchor.addEventListener("pointerenter", this.enter);
      anchor.addEventListener("pointerleave", this.leave);
      anchor.addEventListener("click", this.activate);
      if (this.restoreAnchor) anchor.focus({ preventScroll: true });
    } else if (this.restoreAnchor && this.panel) {
      this.panel.querySelector<HTMLElement>(".capacity-close")?.focus({ preventScroll: true });
    }
    this.restoreAnchor = false;
    this.position();
  }

  isOpen(): boolean { return this.panel !== null; }

  close(): void { this.dismiss(true); }

  private enter = (): void => { if (!this.suppressHover) this.open(false); };
  private leave = (): void => { this.suppressHover = false; };
  private activate = (): void => { this.open(true); };
  private outside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.panel?.contains(target) && !this.anchor?.contains(target)) this.dismiss(false);
  };
  private foregroundOverlay(): boolean {
    return [...document.querySelectorAll<HTMLElement>(".modal-back, .find-overlay, .ctxmenu, .lens-pop")]
      .some(el => !el.closest("[hidden], [inert], [aria-hidden='true']") &&
        el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
  }
  private keys = (event: KeyboardEvent): void => {
    if (!this.panel || event.defaultPrevented || this.foregroundOverlay()) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); this.close(); return;
    }
    if (this.panel.contains(event.target as Node)) {
      // Preserve native editing and Tab, but do not let foreground keys reach Field or app shortcuts.
      if (((event.ctrlKey || event.metaKey) && ["r", "f", "e"].includes(event.key.toLowerCase())) ||
          (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key))) event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private position = (): void => {
    if (!this.panel) return;
    const rect = this.anchor?.getBoundingClientRect();
    const below = innerHeight - (rect?.bottom ?? 0) - 16;
    const above = (rect?.top ?? 0) - 16;
    const placeAbove = below < Math.min(300, above);
    this.panel.style.maxHeight = `${Math.max(80, placeAbove ? above : below)}px`;
    const w = this.panel.getBoundingClientRect().width;
    const h = this.panel.getBoundingClientRect().height;
    const left = Math.max(8, Math.min(rect?.left ?? 8, innerWidth - w - 8));
    const preferredTop = placeAbove ? (rect?.top ?? 0) - h - 8 : (rect?.bottom ?? 0) + 8;
    const top = Math.max(8, Math.min(preferredTop, innerHeight - h - 8));
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
    this.onLayoutChange();
  };

  private open(focus: boolean): void {
    if (this.foregroundOverlay()) return;
    if (!this.panel) {
      this.snapshot = this.latest;
      const panel = document.createElement("section");
      this.panel = panel;
      panel.id = this.id;
      panel.className = "capacity-pop";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-labelledby", `${this.id}-title`);
      panel.innerHTML = `<header class="capacity-head"><h2 id="${this.id}-title">Crowding estimate</h2>
        <button type="button" class="btn capacity-close" aria-label="Close crowding explanation">Close ×</button></header>
        <div class="capacity-body">
        <p>This estimate compares HRR dimensions with the total stored fact count.
        A lower value can suggest more interference in a bundled representation.
        It does not measure recall accuracy or show that memories are damaged.</p>
        <dl class="capacity-metrics"></dl>
        <p>Formula: <code>sqrt(hrr_dim / max(1, facts))</code>, rounded to three decimals by the provider.
        The Eye warns when the reported SNR is below 2.0.</p>
        <p>Fact trust is a separate stored weight. Changing trust or the visual trust filter does not change this count-based estimate.</p>
        <p><strong>Guidance, not a finding:</strong> Review representative recall examples before changing memory.
        Check possible duplicates or stale facts only if the evidence supports that work.
        Do not delete useful memories or raise trust just to remove this warning.</p>
        <p>Last loaded snapshot; freshness not verified.</p>
        <p class="capacity-newer" hidden>Newer data is available. Reopen to update.</p>
        <label for="${this.id}-prompt">Prompt for Hermes</label>
        <textarea id="${this.id}-prompt" class="capacity-prompt" readonly rows="9" spellcheck="false"></textarea>
        </div><footer class="capacity-actions"><button type="button" class="btn capacity-copy">Copy prompt</button>
        <span>Copies text only. Nothing is sent to Hermes.</span>
        <div class="capacity-status" role="status" aria-live="polite"></div></footer>`;
      const rows: [string, number | null][] = [["Reported SNR estimate", this.snapshot.snr],
        ["HRR dimensions", this.snapshot.hrr_dim], ["Stored facts", this.snapshot.facts],
        ["Facts without vectors (included in total)", this.snapshot.null_vectors],
        ["Minimum trust reported by provider", this.snapshot.min_trust]];
      const metrics = panel.querySelector("dl")!;
      for (const [label, value] of rows) {
        const term = document.createElement("dt"), detail = document.createElement("dd");
        term.textContent = label; detail.textContent = show(value); metrics.append(term, detail);
      }
      panel.querySelector<HTMLTextAreaElement>("textarea")!.value = capacityPrompt(this.snapshot);
      panel.querySelector<HTMLButtonElement>(".capacity-close")!.onclick = () => this.close();
      panel.querySelector<HTMLButtonElement>(".capacity-copy")!.onclick = () => void this.copy(panel);
      document.body.appendChild(panel);
      this.geometry = new ResizeObserver(this.position);
      this.geometry.observe(panel);
      this.anchor?.setAttribute("aria-expanded", "true");
      window.addEventListener("pointerdown", this.outside, true);
      window.addEventListener("keydown", this.keys, true);
      window.addEventListener("resize", this.position);
      window.addEventListener("scroll", this.position, true);
      this.position();
    }
    if (focus) this.panel?.querySelector<HTMLElement>(".capacity-close")?.focus({ preventScroll: true });
  }

  private dismiss(restore: boolean): void {
    const panel = this.panel;
    if (!panel) return;
    const focusInside = panel.contains(document.activeElement);
    this.panel = null;
    this.suppressHover = true;
    this.geometry?.disconnect();
    this.geometry = null;
    panel.remove();
    this.onLayoutChange();
    this.anchor?.setAttribute("aria-expanded", "false");
    window.removeEventListener("pointerdown", this.outside, true);
    window.removeEventListener("keydown", this.keys, true);
    window.removeEventListener("resize", this.position);
    window.removeEventListener("scroll", this.position, true);
    if (restore && focusInside) {
      const target = this.anchor?.isConnected ? this.anchor : document.getElementById("sb-settings");
      target?.focus({ preventScroll: true });
    }
  }

  private async copy(panel: HTMLElement): Promise<void> {
    const button = panel.querySelector<HTMLButtonElement>(".capacity-copy")!;
    if (button.disabled) return;
    button.disabled = true;
    const text = panel.querySelector<HTMLTextAreaElement>("textarea")!;
    try {
      await navigator.clipboard.writeText(text.value);
      if (this.panel === panel) panel.querySelector(".capacity-status")!.textContent = "Copied. Paste it into Hermes.";
    } catch {
      if (this.panel === panel) {
        panel.querySelector(".capacity-status")!.textContent = "Copy failed. Select the prompt below and copy it manually.";
        text.focus({ preventScroll: true }); text.select();
      }
    } finally {
      if (this.panel === panel) button.disabled = false;
    }
  }
}
