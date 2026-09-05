# Field kernel benchmark

Date: 2026-09-05

Command:

```bash
node build/eye_geometry/test.mjs
```

Environment: `/usr/bin/thorium-browser`, HeadlessChrome 144.0.0.0, x86_64 Linux. The test uses the project-contained Zig 0.15.2 compiler. It serves only synthetic files on an ephemeral `127.0.0.1` port.

Five consecutive passing runs produced these steady-state pointer medians:

| facts | JavaScript median | Zig/WASM median | speedup range |
|---:|---:|---:|---:|
| 3,000 | 0.0250–0.0292 ms | 0.00833–0.00937 ms | 2.78–3.25× |
| 20,000 | 0.0771–0.1011 ms | 0.0531–0.0594 ms | 1.42–1.73× |

Each median contains 41 samples of 96 pointer positions after warmup. Each run alternates JavaScript and WebAssembly batches against the same facts and pointer sequence. The checksum keeps both results observable.

The same runs measured load plus compile separately at 4.7–19.8 ms. Facts-change packing measured 0.10–0.40 ms for 3,000 facts and 0.8–5.2 ms for 20,000 facts. Packing does not run on pointer movement.

The enablement gate requires the WebAssembly median to be at least 10% lower at both fixture sizes. All five runs passed. The browser differential also passed empty, inside-radius, exact-boundary, first-tie, null-x, null-y coercion, non-finite, 600 random-pointer, and 20,000-fact cases. The JavaScript fallback passed a deliberate WebAssembly compile failure.

These numbers describe the isolated hit-test path. They do not claim an end-to-end frame-time gain or a database change.
