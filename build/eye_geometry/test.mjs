#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const zig = resolve(process.env.ZIG || resolve(root, "build/toolchains/zig-x86_64-linux-0.15.2/zig"));
const wasmPath = resolve(here, "zig-out/geometry.wasm");
const geometryJs = resolve(here, "zig-out/geometry-test.js");
const require = createRequire(import.meta.url);
const { chromium } = require(resolve(root, "build/verify/node_modules/playwright-core"));
const browserPath = process.env.EYE_BROWSER || "/usr/bin/thorium-browser";

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status ?? "spawn error"}`);
}

run(zig, ["test", resolve(here, "geometry.zig"), "-O", "ReleaseSafe"], "Zig unit tests");
run(process.execPath, [resolve(here, "build.mjs")], "WebAssembly build");
run(resolve(root, "build/eye_frontend/node_modules/.bin/esbuild"), [
  resolve(root, "build/eye_frontend/src/geometry.ts"), "--bundle", "--format=esm",
  "--target=es2022", `--outfile=${geometryJs}`,
], "geometry TypeScript test bundle");

const bytes = readFileSync(wasmPath);
const module = new WebAssembly.Module(bytes);
assert.deepEqual(WebAssembly.Module.imports(module), []);
assert.deepEqual(WebAssembly.Module.exports(module).map(({ name, kind }) => [name, kind]), [
  ["memory", "memory"], ["facts_ptr", "function"],
  ["facts_capacity", "function"], ["hit_test", "function"],
]);
const native = new WebAssembly.Instance(module, {}).exports;
assert.equal(native.facts_capacity(), 131_072);
assert.equal(native.facts_ptr() % 8, 0);
assert.equal(native.memory.buffer.byteLength, 4_194_304);
assert.throws(() => native.memory.grow(1), RangeError);
assert.equal(native.hit_test(131_073, 0, 0, 1, 100, 100, 50, 50), -1);

const server = createServer((request, response) => {
  const path = new URL(request.url, "http://geometry.invalid").pathname;
  if (path === "/geometry.wasm") {
    response.writeHead(200, { "Content-Type": "application/wasm", "Cache-Control": "no-store" });
    response.end(bytes);
  } else if (path === "/geometry-test.js") {
    response.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
    response.end(readFileSync(geometryJs));
  } else if (path === "/bad.wasm") {
    response.writeHead(200, { "Content-Type": "application/wasm", "Cache-Control": "no-store" });
    response.end("not wasm");
  } else if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>geometry differential</title>");
  } else {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
});
await new Promise((accept, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", accept);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: "load" });
  const report = await page.evaluate(async ({ wasmUrl, moduleUrl }) => {
    const loadStart = performance.now();
    const response = await fetch(wasmUrl);
    const { instance } = await WebAssembly.instantiateStreaming(response, {});
    const loadCompileMs = performance.now() - loadStart;
    const wasm = instance.exports;
    const pointer = wasm.facts_ptr();
    const capacity = wasm.facts_capacity();

    function oldHit(facts, cx, cy, scale, width, height, sx, sy) {
      let best = null, bestD = 100;
      for (const fact of facts) {
        if (fact.x === null) continue;
        const px = (fact.x - cx) * scale + width / 2;
        const py = (fact.y - cy) * scale + height / 2;
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        if (d < bestD) { bestD = d; best = fact.fact_id; }
      }
      return best;
    }

    function pack(facts) {
      const started = performance.now();
      const selected = facts.filter((fact) => fact.x !== null);
      if (selected.length > capacity) throw new Error("capacity");
      const coordinates = new Float64Array(selected.length * 2);
      const ids = new Array(selected.length);
      for (let i = 0; i < selected.length; i += 1) {
        coordinates[i * 2] = selected[i].x;
        coordinates[i * 2 + 1] = selected[i].y;
        ids[i] = selected[i].fact_id;
      }
      new Float64Array(wasm.memory.buffer, pointer, coordinates.length).set(coordinates);
      return { ids, packMs: performance.now() - started };
    }

    function wasmHit(ids, cx, cy, scale, width, height, sx, sy) {
      const index = wasm.hit_test(ids.length, cx, cy, scale, width, height, sx, sy);
      return index === -1 ? null : ids[index];
    }

    const checks = [];
    function check(name, facts, args) {
      const { ids } = pack(facts);
      const oldValue = oldHit(facts, ...args);
      const wasmValue = wasmHit(ids, ...args);
      checks.push({ name, oldValue, wasmValue, pass: Object.is(oldValue, wasmValue) });
    }
    const base = [0, 0, 1, 100, 100];
    check("empty", [], [...base, 50, 50]);
    check("inside", [{ fact_id: 9007199254740991, x: 0, y: 0 }], [...base, 59.999, 50]);
    check("boundary", [{ fact_id: 1, x: 0, y: 0 }], [...base, 60, 50]);
    check("tie-first", [{ fact_id: 41, x: -1, y: 0 }, { fact_id: 42, x: 1, y: 0 }], [...base, 50, 50]);
    check("null-x-omitted", [{ fact_id: 1, x: null, y: 0 }, { fact_id: 2, x: 2, y: 0 }], [...base, 52, 50]);
    check("null-y-coerces-zero", [{ fact_id: 7, x: 2, y: null }], [...base, 52, 50]);
    check("nonfinite", [
      { fact_id: 1, x: NaN, y: 0 }, { fact_id: 2, x: Infinity, y: 0 },
      { fact_id: 3, x: 2, y: 3 },
    ], [...base, 52, 53]);
    check("nonfinite-transform", [{ fact_id: 1, x: 0, y: 0 }],
      [0, 0, Infinity, 100, 100, 50, 50]);

    let seed = 0x9e3779b9;
    const random = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
    const randomFacts = Array.from({ length: 2048 }, (_, i) => ({
      fact_id: i % 97 === 0 ? 9_000_000_000 + i : i + 1,
      x: i % 127 === 0 ? NaN : (random() - 0.5) * 800,
      y: i % 211 === 0 ? Infinity : (random() - 0.5) * 600,
    }));
    const randomPacked = pack(randomFacts);
    let randomPass = true;
    for (let i = 0; i < 600; i += 1) {
      const args = [
        (random() - 0.5) * 100, (random() - 0.5) * 100,
        0.2 + random() * 12, 320 + random() * 1800, 240 + random() * 900,
        random() * 1800, random() * 1100,
      ];
      if (!Object.is(oldHit(randomFacts, ...args), wasmHit(randomPacked.ids, ...args))) {
        randomPass = false; break;
      }
    }
    checks.push({ name: "random-600", pass: randomPass });

    const largeFacts = Array.from({ length: 20_000 }, (_, i) => ({
      fact_id: 8_500_000_000 + i,
      x: Math.sin(i * 0.173) * 400 + (i % 31),
      y: Math.cos(i * 0.117) * 300 - (i % 19),
    }));
    const largePacked = pack(largeFacts);
    let largePass = true;
    for (let i = 0; i < 200; i += 1) {
      const args = [4.25, -9.5, 1.8, 1440, 900, (i * 83) % 1440, (i * 47) % 900];
      if (oldHit(largeFacts, ...args) !== wasmHit(largePacked.ids, ...args)) {
        largePass = false; break;
      }
    }
    checks.push({ name: "large-20000", pass: largePass });

    function median(values) {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = sorted.length >> 1;
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }
    function benchmark(count) {
      const facts = largeFacts.slice(0, count);
      const packed = pack(facts);
      const pointers = Array.from({ length: 96 }, (_, i) => [
        (i * 97.3) % 1440, (i * 53.7) % 900,
      ]);
      let checksum = 0;
      for (let i = 0; i < 200; i += 1) {
        const p = pointers[i % pointers.length];
        checksum += oldHit(facts, 4.25, -9.5, 1.8, 1440, 900, p[0], p[1]) ?? -1;
        checksum += wasmHit(packed.ids, 4.25, -9.5, 1.8, 1440, 900, p[0], p[1]) ?? -1;
      }
      const js = [], zig = [];
      for (let sample = 0; sample < 41; sample += 1) {
        let started = performance.now();
        for (let i = 0; i < pointers.length; i += 1) {
          const p = pointers[i];
          checksum += oldHit(facts, 4.25, -9.5, 1.8, 1440, 900, p[0], p[1]) ?? -1;
        }
        js.push((performance.now() - started) / pointers.length);
        started = performance.now();
        for (let i = 0; i < pointers.length; i += 1) {
          const p = pointers[i];
          checksum += wasmHit(packed.ids, 4.25, -9.5, 1.8, 1440, 900, p[0], p[1]) ?? -1;
        }
        zig.push((performance.now() - started) / pointers.length);
      }
      const jsMedianMs = median(js), wasmMedianMs = median(zig);
      return {
        facts: count, samples: js.length, pointersPerSample: pointers.length,
        packMs: packed.packMs, jsMedianMs, wasmMedianMs,
        speedup: jsMedianMs / wasmMedianMs,
        measurableGain: wasmMedianMs <= jsMedianMs * 0.9,
        checksum,
      };
    }

    const managerModule = await import(moduleUrl);
    const managerFacts = [
      { fact_id: 7_000_000_001, x: -1, y: 0 },
      { fact_id: 7_000_000_002, x: 1, y: 0 },
      { fact_id: 7_000_000_003, x: null, y: null },
    ];
    const manager = new managerModule.GeometryHitTester(wasmUrl);
    manager.sync(managerFacts);
    await manager.ready();
    const managerHit = manager.hitTest(0, 0, 1, 100, 100, 50, 50);
    const missing = new managerModule.GeometryHitTester(`${wasmUrl}.missing`);
    missing.sync(managerFacts);
    await missing.ready();
    const fallbackHit = missing.hitTest(0, 0, 1, 100, 100, 50, 50);
    const corrupt = new managerModule.GeometryHitTester(`${new URL(wasmUrl).origin}/bad.wasm`);
    corrupt.sync(managerFacts);
    await corrupt.ready();
    const corruptFallbackHit = corrupt.hitTest(0, 0, 1, 100, 100, 50, 50);
    const allocation = new managerModule.GeometryHitTester(wasmUrl);
    allocation.sync(managerFacts);
    await allocation.ready();
    const RealFloat64Array = globalThis.Float64Array;
    globalThis.Float64Array = class BrokenFloat64Array {
      constructor() { throw new RangeError("synthetic allocation failure"); }
    };
    allocation.sync(managerFacts);
    globalThis.Float64Array = RealFloat64Array;
    const allocationFallbackHit = allocation.hitTest(0, 0, 1, 100, 100, 50, 50);
    const overCapacityFacts = Array.from({ length: capacity + 1 }, (_, i) => ({
      fact_id: i + 1, x: i * 100, y: i * 100,
    }));
    const overCapacity = new managerModule.GeometryHitTester(wasmUrl);
    overCapacity.sync(overCapacityFacts);
    await overCapacity.ready();
    const overCapacityHit = overCapacity.hitTest(0, 0, 1, 100, 100, 50, 50);

    return {
      userAgent: navigator.userAgent,
      wasmBytes: (await (await fetch(wasmUrl)).arrayBuffer()).byteLength,
      loadCompileMs,
      checks,
      manager: { hit: managerHit, status: manager.status() },
      missingFallback: { hit: fallbackHit, status: missing.status() },
      corruptFallback: { hit: corruptFallbackHit, status: corrupt.status() },
      allocationFallback: { hit: allocationFallbackHit, status: allocation.status() },
      overCapacityFallback: { hit: overCapacityHit, status: overCapacity.status() },
      benchmarks: [benchmark(3000), benchmark(20_000)],
    };
  }, { wasmUrl: `${origin}/geometry.wasm`, moduleUrl: `${origin}/geometry-test.js` });

  assert.ok(report.checks.every((check) => check.pass), JSON.stringify(report.checks));
  assert.equal(report.manager.hit, 7_000_000_001);
  assert.equal(report.manager.status.mode, "wasm");
  assert.equal(report.missingFallback.hit, 7_000_000_001);
  assert.equal(report.missingFallback.status.mode, "javascript");
  assert.match(report.missingFallback.status.reason, /HTTP 404/);
  assert.equal(report.corruptFallback.hit, 7_000_000_001);
  assert.equal(report.corruptFallback.status.mode, "javascript");
  assert.match(report.corruptFallback.status.reason, /WASM unavailable/);
  assert.equal(report.allocationFallback.hit, 7_000_000_001);
  assert.equal(report.allocationFallback.status.mode, "javascript");
  assert.match(report.allocationFallback.status.reason, /allocation failure/);
  assert.equal(report.overCapacityFallback.hit, 1);
  assert.equal(report.overCapacityFallback.status.mode, "javascript");
  assert.match(report.overCapacityFallback.status.reason, /capacity/);
  assert.ok(report.benchmarks.every((row) => row.measurableGain), JSON.stringify(report.benchmarks));
  console.log(JSON.stringify({
    status: "ok", tool: "eye-geometry-test", version: "1.1.0", compiler_version: "0.15.2",
    wasmBytes: statSync(wasmPath).size, ...report,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((accept) => server.close(accept));
}
