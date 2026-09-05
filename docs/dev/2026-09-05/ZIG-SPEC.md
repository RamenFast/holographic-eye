# D-0017 · Zig Field hit-test kernel

Status: candidate enabled after the differential and latency gates passed. JavaScript remains the runtime fallback.

## Why Zig earns this part

Field hit testing is a small numeric kernel on a hot pointer path. It scans the same geometry on every pointer event. Zig gives this loop explicit `f64` arithmetic, a freestanding WebAssembly target, and a fixed memory layout without a runtime or allocator. The boundary stays visible: TypeScript owns facts and exact IDs; Zig only returns the winning packed index.

Zig does not touch HRR vectors, PCA, the provider, the database, rendering, or native GPU APIs. WebAssembly is useful here only if measured browser latency improves.

## Behavior contract

The packed rows preserve `store.facts` Map insertion order. TypeScript omits only facts whose `x === null`. It converts each remaining `x` and `y` through `Float64Array` assignment, matching JavaScript numeric coercion for the valid API shape and the requested malformed null and non-finite cases. A parallel JavaScript array holds each exact `fact_id` without narrowing it through WebAssembly.

For each packed row, the kernel evaluates these `f64` operations in this order:

```text
px = (x - cx) * scale + width / 2
py = (y - cy) * scale + height / 2
dx = px - sx
dy = py - sy
d  = dx * dx + dy * dy
```

The kernel starts with `best_d = 100`. It replaces the winner only when `d < best_d`. A point at exactly 10 px does not hit. The first point wins an equal-distance tie. NaN distances never win. Infinite values follow WebAssembly `f64` arithmetic and the same strict comparison. The kernel returns `-1` when no packed row wins. `Field` then runs the existing no-vector strip fallback unchanged.

## ABI and memory bound

The `wasm32-freestanding` module exports its linear `memory` and:

```text
facts_ptr() -> u32
facts_capacity() -> u32
hit_test(count: u32, cx: f64, cy: f64, scale: f64,
         width: f64, height: f64, sx: f64, sy: f64) -> i32
```

The module has one static interleaved `f64` buffer. Its capacity is 131072 facts, or 2 MiB of coordinate data. It imports nothing, uses no allocator, and cannot grow its buffer. TypeScript writes the buffer only after a facts event. Pointer movement passes eight scalar values and makes no N-sized copy. A fact set above capacity stays on JavaScript.

## Load and fallback contract

TypeScript starts loading the module without delaying Field construction. It validates the four exports, the buffer address, capacity, memory bounds, and one known-answer probe. Fetch, compilation, instantiation, validation, capacity, packing, detached-memory, or kernel-result failure disables the module for that geometry revision. The same scalar JavaScript algorithm remains available for every call.

Facts can change before or after the module loads. Each facts event rebuilds the current geometry once. A stale asynchronous load cannot install stale coordinates.

## Enablement gate

The candidate defaults to WebAssembly only after all checks pass:

1. Zig unit tests cover empty, boundary, tie, NaN, infinity, and capacity behavior.
2. Browser differential tests cover random, boundary, tie, empty, malformed null/non-finite, and large fixtures.
3. The browser benchmark compares old scalar JavaScript with WebAssembly on the same points and pointer sequence.
4. Both fixture medians must be at least 10% lower than the JavaScript medians.
5. Any failed gate leaves the runtime on the JavaScript path.

The benchmark report records browser version, fact count, sample count, both medians, ratio, and gate result. Build and tests must use the project-contained Zig 0.15.2 toolchain. Results and the reproduce command live in `build/eye_geometry/BENCHMARK.md`.
