/* Field hit testing: exact JavaScript fallback plus the optional Zig/WASM kernel. GPLv3. */

export interface GeometryFact {
  fact_id: number;
  x: number | null;
  y: number | null;
}

export interface GeometryStatus {
  mode: "loading" | "wasm" | "javascript";
  facts: number;
  packedFacts: number;
  loadMs: number | null;
  packMs: number | null;
  reason: string | null;
}

interface GeometryWasmExports {
  memory: WebAssembly.Memory;
  facts_ptr: () => number;
  facts_capacity: () => number;
  hit_test: (count: number, cx: number, cy: number, scale: number,
             width: number, height: number, sx: number, sy: number) => number;
}

const EXPECTED_CAPACITY = 131_072;

/** The original Field algorithm, kept as the failure-safe authority. */
export function scalarHitTest(
  facts: readonly GeometryFact[], cx: number, cy: number, scale: number,
  width: number, height: number, sx: number, sy: number,
): number | null {
  let best: number | null = null;
  let bestD = 100;
  for (const fact of facts) {
    if (fact.x === null) continue;
    const px = (fact.x - cx) * scale + width / 2;
    const py = (fact.y! - cy) * scale + height / 2;
    const d = (px - sx) ** 2 + (py - sy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = fact.fact_id;
    }
  }
  return best;
}

export class GeometryHitTester {
  private rows: GeometryFact[] = [];
  private coordinates: Float64Array | null = new Float64Array(0);
  private ids: number[] = [];
  private wasm: GeometryWasmExports | null = null;
  private wasmUsable = false;
  private kernelHealthy = true;
  private revision = 0;
  private loadPromise: Promise<void>;
  private info: GeometryStatus = {
    mode: "loading", facts: 0, packedFacts: 0,
    loadMs: null, packMs: null, reason: null,
  };

  constructor(url = "/geometry.wasm") {
    this.loadPromise = this.load(url);
  }

  /** Rebuild the packed coordinates once for each facts revision. */
  sync(facts: Iterable<GeometryFact>): void {
    const started = performance.now();
    this.revision += 1;
    this.rows = Array.from(facts);
    this.ids = [];
    this.coordinates = null;
    this.wasmUsable = false;

    let count = 0;
    for (const fact of this.rows) if (fact.x !== null) count += 1;
    this.info.facts = this.rows.length;
    this.info.packedFacts = count;

    if (count > EXPECTED_CAPACITY) {
      this.info.mode = "javascript";
      this.info.reason = `geometry has ${count} rows; WASM capacity is ${EXPECTED_CAPACITY}`;
      this.info.packMs = performance.now() - started;
      return;
    }

    try {
      const coordinates = new Float64Array(count * 2);
      const ids = new Array<number>(count);
      let row = 0;
      for (const fact of this.rows) {
        if (fact.x === null) continue;
        coordinates[row * 2] = fact.x;
        coordinates[row * 2 + 1] = fact.y as number;
        ids[row] = fact.fact_id;
        row += 1;
      }
      this.coordinates = coordinates;
      this.ids = ids;
      this.info.packMs = performance.now() - started;
      this.copyCurrent(this.revision);
    } catch (error) {
      this.info.mode = "javascript";
      this.info.reason = `geometry packing failed: ${errorMessage(error)}`;
      this.info.packMs = performance.now() - started;
    }
  }

  hitTest(cx: number, cy: number, scale: number, width: number, height: number,
          sx: number, sy: number): number | null {
    if (this.wasmUsable && this.wasm) {
      try {
        const index = this.wasm.hit_test(
          this.ids.length, cx, cy, scale, width, height, sx, sy,
        );
        if (index === -1) return null;
        if (Number.isInteger(index) && index >= 0 && index < this.ids.length) {
          return this.ids[index];
        }
        this.disableKernel(`kernel returned invalid index ${index}`);
      } catch (error) {
        this.disableKernel(`kernel call failed: ${errorMessage(error)}`);
      }
    }
    return scalarHitTest(this.rows, cx, cy, scale, width, height, sx, sy);
  }

  ready(): Promise<void> {
    return this.loadPromise;
  }

  status(): Readonly<GeometryStatus> {
    return { ...this.info };
  }

  private async load(url: string): Promise<void> {
    const started = performance.now();
    try {
      if (typeof WebAssembly !== "object") throw new Error("WebAssembly is unavailable");
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      let source: WebAssembly.WebAssemblyInstantiatedSource;
      if (typeof WebAssembly.instantiateStreaming === "function") {
        try {
          source = await WebAssembly.instantiateStreaming(response.clone(), {});
        } catch {
          source = await WebAssembly.instantiate(await response.arrayBuffer(), {});
        }
      } else {
        source = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      }

      const exports = source.instance.exports as unknown as Partial<GeometryWasmExports>;
      if (!(exports.memory instanceof WebAssembly.Memory) ||
          typeof exports.facts_ptr !== "function" ||
          typeof exports.facts_capacity !== "function" ||
          typeof exports.hit_test !== "function") {
        throw new Error("required exports are missing");
      }
      const capacity = exports.facts_capacity();
      const pointer = exports.facts_ptr();
      if (capacity !== EXPECTED_CAPACITY || !Number.isInteger(pointer) || pointer < 0 ||
          pointer % Float64Array.BYTES_PER_ELEMENT !== 0 ||
          pointer + capacity * 2 * Float64Array.BYTES_PER_ELEMENT > exports.memory.buffer.byteLength) {
        throw new Error("memory contract is invalid");
      }

      const wasm = exports as GeometryWasmExports;
      const probe = new Float64Array(wasm.memory.buffer, pointer, 4);
      probe.set([-1, 0, 1, 0]);
      const tieWinner = wasm.hit_test(2, 0, 0, 1, 100, 100, 50, 50);
      probe.set([0, 0]);
      const boundaryWinner = wasm.hit_test(1, 0, 0, 1, 100, 100, 60, 50);
      if (tieWinner !== 0 || boundaryWinner !== -1) {
        throw new Error("known-answer probe failed");
      }

      this.wasm = wasm;
      this.info.loadMs = performance.now() - started;
      this.copyCurrent(this.revision);
    } catch (error) {
      this.info.loadMs = performance.now() - started;
      this.info.mode = "javascript";
      this.info.reason = `WASM unavailable: ${errorMessage(error)}`;
      this.wasm = null;
      this.wasmUsable = false;
    }
  }

  private copyCurrent(revision: number): void {
    if (!this.wasm || !this.coordinates || !this.kernelHealthy || revision !== this.revision) return;
    try {
      const pointer = this.wasm.facts_ptr();
      const target = new Float64Array(
        this.wasm.memory.buffer, pointer, this.coordinates.length,
      );
      target.set(this.coordinates);
      if (revision !== this.revision) return;
      this.wasmUsable = true;
      this.info.mode = "wasm";
      this.info.reason = null;
    } catch (error) {
      this.wasmUsable = false;
      this.info.mode = "javascript";
      this.info.reason = `WASM buffer copy failed: ${errorMessage(error)}`;
    }
  }

  private disableKernel(reason: string): void {
    this.kernelHealthy = false;
    this.wasmUsable = false;
    this.info.mode = "javascript";
    this.info.reason = reason;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
