#!/usr/bin/env node
"use strict";

/* Synthetic, offline frontend performance comparison.
   Baseline defaults to v1.1.0. Candidate is the working tree. This script
   never reads a Hermes token/database and never connects to :8770.

   Scope: v1.1.0 Field/Stream versus candidate Field/Stream under the SAME
   current UI/state/geometry. This is NOT a whole-release comparison or a
   claim of new-feature parity. Both arms force labels OFF at construction.
   The legacy adapter only accepts an active Field, OFF text, and label-cache
   invalidation (a no-op). Zoom/new views are intentionally unsupported here.
   Every fixture fact has a vector and real coordinates, so exact full-canvas
   hashes exclude the intentionally changed vectorless caption by DATA, not
   by masking a mismatch. Null-vector behavior has its own Field/Explorer tests. */

const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "../..");
const FRONTEND = path.join(REPO, "build/eye_frontend");
const ESBUILD = path.join(FRONTEND, "node_modules/.bin/esbuild");
const BROWSER = process.env.EYE_BROWSER || "/usr/bin/thorium-browser";
const BASELINE_REF = process.env.EYE_PERF_BASELINE || "v1.1.0";
const FACTS = Number(process.env.EYE_PERF_FACTS || 5000);
const EVENTS = Number(process.env.EYE_PERF_EVENTS || 120);
// Opt-in diagnostic. The original short comparison remains the default.
const LONG = process.env.EYE_PERF_LONG === "1";
const RUNS = Number(process.env.EYE_PERF_RUNS || (LONG ? 6 : 3));
const DRAW_WARMUP = LONG ? 20 : 0;
const DRAW_SAMPLES = LONG ? 40 : 5;
const KEEP = process.env.EYE_PERF_KEEP === "1";
const TOKEN = "synthetic-perf-token";
const ADAPTER = `
// Test-only presentation bridge. The inherited renderer/hit/input code is unchanged.
export class Field extends LegacyField {
  setActive(active: boolean): void {
    if (!active) throw new Error("Baseline adapter requires an active Field");
  }
  setLabelMode(mode: "auto" | "off"): void {
    if (mode !== "off") throw new Error("Baseline adapter only supports labels OFF");
  }
  getLabelMode(): "off" { return "off"; }
  invalidateLabels(): void {}
  zoomBy(_factor: number): void {
    throw new Error("Baseline adapter does not compare the new zoom controls");
  }
}
`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "holo-eye-perf-"));

function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function stage(name, baseline) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(FRONTEND, "src"), path.join(dir, "src"), { recursive: true });
  if (baseline) {
    for (const file of ["field.ts", "stream.ts"]) {
      let text = execFileSync("git", ["show", `${BASELINE_REF}:build/eye_frontend/src/${file}`],
                                { cwd: REPO, encoding: "utf8", timeout: 60000 });
      if (file === "field.ts") {
        if (text.split("export class Field {").length !== 2)
          throw new Error("Legacy Field declaration changed. Review the compatibility adapter before comparing.");
        text = text.replace("export class Field {", "class LegacyField {") + ADAPTER;
      }
      fs.writeFileSync(path.join(dir, "src", file), text);
    }
  }
  // Apply identical benchmark-only presentation setup before either first draw.
  const mainPath = path.join(dir, "src/main.ts");
  const main = fs.readFileSync(mainPath, "utf8");
  const constructor = 'field = new Field($("#field-wrap"));';
  if (main.split(constructor).length !== 2) throw new Error("Review the labels-OFF construction hook.");
  fs.writeFileSync(mainPath, main.replace(constructor, constructor + '\n  field.setLabelMode("off");'));
  fs.mkdirSync(path.join(dir, "dist"));
  execFileSync(ESBUILD, [path.join(dir, "src/main.ts"), "--bundle", "--format=iife",
    `--outfile=${path.join(dir, "dist/bundle.js")}`, "--minify", "--target=es2022"],
    { stdio: "pipe", timeout: 60000 });
  for (const file of ["index.html", "styles.css", "explorer.css", "favicon.png"]) {
    fs.copyFileSync(path.join(FRONTEND, file), path.join(dir, "dist", file));
  }
  const wasm = path.join(REPO, "build/eye_geometry/zig-out/geometry.wasm");
  if (fs.existsSync(wasm)) fs.copyFileSync(wasm, path.join(dir, "dist/geometry.wasm"));
  return path.join(dir, "dist");
}

function fact(id) {
  const a = id * 2.399963229728653;
  return {
    fact_id: id, x: Math.cos(a) * (20 + Math.sqrt(id)),
    y: Math.sin(a) * (20 + Math.sqrt(id)), has_vector: true,
    content: `synthetic fact ${id} alpha beta`,
    category: ["general", "user_pref", "project", "tool", "lesson"][id % 5],
    tags: "synthetic", trust_score: (id % 11) / 10,
    retrieval_count: id % 50, helpful_count: id % 4,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    entities: [`entity ${id % 2000}`, `group ${id % 20}`],
  };
}

const facts = Array.from({ length: FACTS }, (_, i) => fact(i + 1));
const entities = Array.from({ length: Math.min(FACTS, 2000) }, (_, i) => ({
  entity_id: i + 1, name: `entity ${i}`, entity_type: "named", aliases: "",
  fact_count: Math.max(1, Math.floor(FACTS / Math.min(FACTS, 2000))),
}));
const events = Array.from({ length: EVENTS }, (_, i) => ({
  event_id: i + 1, ts: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  session_id: "synthetic", source: "tool", kind: "search",
  request: JSON.stringify({ query: `query ${i}` }),
  response: JSON.stringify({ results: Array.from({ length: 12 }, (_, j) => ({
    fact_id: ((i + j) % FACTS) + 1, score: 0.9 - j / 100,
  })) }), before: null, after: null, duration_ms: 3, undone_by: null,
})).reverse(); // server disorder exercises Store.pushEvents ordering
const stats = { facts: FACTS, entities: entities.length,
  trust_histogram: { "0.5": FACTS }, snr: 4.2, min_trust: 0.3, hrr_dim: 1024,
  categories: { general: FACTS }, journal: { last_event_id: EVENTS, lag_s: 0 } };

class Server {
  constructor(dist) {
    this.dist = dist;
    this.tailAt = 0;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }
  async start() {
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return this.server.address().port;
  }
  stop() {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(resolve));
  }
  json(res, body) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": data.length,
      "Cache-Control": "no-store" });
    res.end(data);
  }
  handle(req, res) {
    const pathname = new URL(req.url, "http://fixture.invalid").pathname;
    if (req.method === "POST" && pathname === "/rpc") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (body.method === "field.projection") return this.json(res, { facts, meta: { synthetic: true } });
        if (body.method === "entities.list") return this.json(res, { entities, total: entities.length });
        if (body.method === "journal.tail") {
          this.tailAt = performance.now();
          return this.json(res, { events });
        }
        if (body.method === "fact.get") {
          const f = facts.find((row) => row.fact_id === body.params.fact_id);
          return this.json(res, { fact: { ...f, links: (f?.entities || []).map((name, i) => ({ entity_id: i + 1, name })), vector_bytes: 8192 } });
        }
        return this.json(res, {});
      });
      return;
    }
    if (pathname === "/stats") return this.json(res, stats);
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.resolve(this.dist, rel);
    if (!file.startsWith(this.dist + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404); res.end(); return;
    }
    const ext = path.extname(file);
    const type = { ".html": "text/html", ".js": "application/javascript",
      ".css": "text/css", ".png": "image/png", ".wasm": "application/wasm" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  }
}

async function one(dist) {
  const server = new Server(dist);
  let browser;
  try {
  const port = await server.start();
  browser = await chromium.launch({ executablePath: BROWSER, headless: true, timeout: 30000,
    args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  await page.addInitScript((token) => {
    localStorage.setItem("eyeToken", token);
    class FakeWebSocket {
      constructor() { window.__perfWs = this; setTimeout(() => this.onopen?.(), 0); }
      close() { this.onclose?.(); }
      send() {}
      emit(event) { this.onmessage?.({ data: JSON.stringify({ type: "event", event }) }); }
    }
    Object.defineProperty(window, "WebSocket", { value: FakeWebSocket });
  }, TOKEN);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error)));
  const started = performance.now();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction((n) => document.querySelectorAll(".s-line").length === Math.min(n, 200), EVENTS,
                             { timeout: 60000 });
  const bootMs = performance.now() - started;
  const tailApplyMs = performance.now() - server.tailAt;
  const burstCount = 120;
  const burstStarted = performance.now();
  await page.evaluate(({ start, count, facts }) => {
    for (let i = 0; i < count; i++) {
      window.__perfWs.emit({ event_id: start + i,
        ts: new Date(Date.UTC(2026, 0, 4, 0, 0, i % 60)).toISOString(),
        session_id: "synthetic", source: "tool", kind: "search",
        request: JSON.stringify({ query: `live burst ${i}` }),
        response: JSON.stringify({ results: [{ fact_id: (i % facts) + 1, score: 0.75 }] }),
        before: null, after: null, duration_ms: 1, undone_by: null });
    }
  }, { start: EVENTS + 1000, count: burstCount, facts: FACTS });
  await page.waitForFunction((id) => document.querySelector(`.s-line[data-eid="${id}"]`),
    EVENTS + 1000 + burstCount - 1);
  const burstApplyMs = performance.now() - burstStarted;
  await page.waitForFunction(() => typeof window.eyeField.geometryStatus !== "function" ||
    window.eyeField.geometryStatus().mode !== "loading");
  const sample = await page.evaluate(async ({ warmup, samples }) => {
    const f = window.eyeField;
    if (f.getLabelMode() !== "off") throw new Error("Geometry comparison requires labels OFF");
    // Normalize the camera through each arm's existing fit API, after UI boot.
    f.fit();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.querySelector("canvas.fieldc");
    const ctx = canvas.getContext("2d");
    let rects = 0;
    const originalRect = canvas.getBoundingClientRect.bind(canvas);
    canvas.getBoundingClientRect = () => { rects++; return originalRect(); };
    for (let i = 0; i < warmup; i++) f.draw();
    const drawTimes = [];
    for (let i = 0; i < samples; i++) {
      const t = performance.now(); f.draw(); drawTimes.push(performance.now() - t);
    }
    const sortedDrawTimes = [...drawTimes].sort((a, b) => a - b);
    const drawMs = sortedDrawTimes[Math.floor(sortedDrawTimes.length / 2)];
    const drawP95Ms = sortedDrawTimes[Math.floor(sortedDrawTimes.length * 0.95)];
    rects = 0;
    f.draw();
    const drawRects = rects;
    const hitRuns = 100;
    let hitChecksum = 0;
    const hitStarted = performance.now();
    for (let i = 0; i < hitRuns; i++) {
      const id = f.hitTest(canvas.clientWidth * ((i * 17) % 101) / 100,
                           canvas.clientHeight * ((i * 43) % 101) / 100);
      if (id !== null) hitChecksum = (hitChecksum + id) % 1000000007;
    }
    const hitMs = (performance.now() - hitStarted) / hitRuns;
    rects = 0;
    f.hitTest(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const hitRects = rects;
    const probes = [];
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) {
      probes.push(f.hitTest(canvas.clientWidth * x / 4, canvas.clientHeight * y / 4));
    }
    f.draw();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    const pixelHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const geometry = typeof f.geometryStatus === "function" ? f.geometryStatus() : null;
    return { drawMs, drawP95Ms, drawTimes, hitMs, hitChecksum, drawRects, hitRects, probes, pixelHash, geometry };
  }, { warmup: DRAW_WARMUP, samples: DRAW_SAMPLES });
  if (pageErrors.length) throw new Error(`Benchmark page errors: ${pageErrors.join("; ")}`);
  return { bootMs, tailApplyMs, burstApplyMs, ...sample };
  } finally {
    try { await browser?.close(); }
    finally { await server.stop(); }
  }
}

async function candidateChecks(dist) {
  const server = new Server(dist);
  let browser;
  try {
  const port = await server.start();
  browser = await chromium.launch({ executablePath: BROWSER, headless: true, timeout: 30000,
    args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.addInitScript((token) => {
    localStorage.setItem("eyeToken", token);
    class FakeWebSocket {
      constructor() { window.__perfWs = this; setTimeout(() => this.onopen?.(), 0); }
      send() {}
      emit(event) { this.onmessage?.({ data: JSON.stringify({ type: "event", event }) }); }
    }
    Object.defineProperty(window, "WebSocket", { value: FakeWebSocket });
  }, TOKEN);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  await page.waitForFunction((n) => document.querySelectorAll(".s-line").length === Math.min(n, 200), EVENTS);
  const initialOrder = await page.locator(".s-line").evaluateAll((rows) =>
    rows.map((row) => Number(row.dataset.eid)));
  const toggle = page.locator(".stream-toggle");
  if (await toggle.count()) {
    await toggle.click();
    await page.locator("#stream").waitFor({ state: "visible" });
    await page.waitForTimeout(220); // dock height transition must settle
  }
  const mk = (id, results, query = `event ${id}`) => ({ event_id: id,
    ts: new Date(Date.UTC(2026, 0, 2, 0, 0, id % 60)).toISOString(), session_id: "synthetic",
    source: "tool", kind: "search", request: JSON.stringify({ query }),
    response: JSON.stringify({ results }), before: null, after: null, duration_ms: 1, undone_by: null });
  const stream = page.locator("#stream");
  await stream.evaluate((el) => { el.scrollTop = Math.floor(el.scrollHeight / 2); });
  const anchorBefore = await stream.evaluate((el) => {
    const rows = [...el.querySelectorAll(".s-line")];
    const row = rows.find((r) => r.offsetTop + r.offsetHeight >= el.scrollTop);
    return row ? { id: row.dataset.eid, offset: row.offsetTop - el.scrollTop } : null;
  });
  await page.evaluate((event) => window.__perfWs.emit(event), mk(EVENTS + 1,
    [{ fact_id: 1 }, { fact_id: 2 }, { fact_id: 3 }]));
  await page.waitForFunction((id) => document.querySelector(`.s-line[data-eid="${id}"]`), EVENTS + 1);
  const anchorAfter = await stream.evaluate((el, before) => {
    const row = before && el.querySelector(`.s-line[data-eid="${before.id}"]`);
    return row ? row.offsetTop - el.scrollTop : null;
  }, anchorBefore);
  await stream.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.evaluate((event) => window.__perfWs.emit(event), mk(EVENTS + 2,
    [{ fact_id: 4 }, { fact_id: 5 }]));
  await page.waitForFunction((id) => document.querySelector(`.s-line[data-eid="${id}"]`), EVENTS + 2);
  const bottomGap = await stream.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

  const hostile = `<img id="xss-probe" src="/xss" onerror="window.__xss=1">`;
  await page.evaluate((event) => window.__perfWs.emit(event), mk(EVENTS + 3,
    [{ fact_id: 6 }, { fact_id: "7" }, { fact_id: 8.5 }, { entity_id: 9 }, { event_id: 10 }], hostile));
  await page.waitForFunction((id) => document.querySelector(`.s-line[data-eid="${id}"]`), EVENTS + 3);
  const last = page.locator(`.s-line[data-eid="${EVENTS + 3}"]`);
  const refs = await last.locator(".s-fid").evaluateAll((els) => els.map((e) => Number(e.dataset.fid)));
  const hostileNode = await page.locator("#xss-probe").count();
  const hostileText = await last.textContent();

  await page.evaluate((event) => window.__perfWs.emit(event), mk(EVENTS + 4,
    Array.from({ length: 12 }, (_, i) => ({ fact_id: i + 1 }))));
  await page.waitForFunction((id) => document.querySelector(`.s-line[data-eid="${id}"]`), EVENTS + 4);
  const navLine = page.locator(`.s-line[data-eid="${EVENTS + 4}"]`);
  const navCount = await navLine.locator(".s-fid").count();
  await navLine.evaluate((el) => el.click());
  await page.waitForFunction(() => document.querySelector(".factid")?.textContent === "12 facts selected");
  await navLine.locator('.s-fid[data-fid="12"]').click();
  await page.waitForFunction(() => /f#0012/.test(document.querySelector(".factid")?.textContent || ""));
  const inspected = await page.locator(".factid").textContent();

  // Parsed JSON can be valid but not an object. Every known source must
  // normalize null/scalar/array payloads without dereference errors.
  const oddPayloads = ["null", "42", "\"text\"", "[]"];
  await page.evaluate(({ start, payloads }) => {
    const shapes = [["tool", "search"], ["prefetch", "prefetch"],
      ["mirror", "add"], ["eye", "entity.merge"]];
    payloads.forEach((payload, i) => window.__perfWs.emit({ event_id: start + i,
      ts: new Date(Date.UTC(2026, 0, 2, 1, 0, i)).toISOString(), session_id: "synthetic",
      source: shapes[i][0], kind: shapes[i][1], request: payload, response: payload,
      before: payload, after: payload, duration_ms: 1, undone_by: null }));
  }, { start: EVENTS + 20, payloads: oddPayloads });
  await page.waitForFunction((id) => document.querySelector(`.s-line[data-eid="${id}"]`), EVENTS + 23);
  const oddRefs = await page.locator(`.s-line[data-eid="${EVENTS + 20}"],` +
    `.s-line[data-eid="${EVENTS + 21}"],.s-line[data-eid="${EVENTS + 22}"],` +
    `.s-line[data-eid="${EVENTS + 23}"]`).locator(".s-fid").count();

  // One synchronous burst must retain all store data while bounding the DOM.
  await page.evaluate(({ start, count }) => {
    for (let i = 0; i < count; i++) {
      window.__perfWs.emit({ event_id: start + i,
        ts: new Date(Date.UTC(2026, 0, 3, 0, 0, i % 60)).toISOString(),
        session_id: "synthetic", source: "tool", kind: "search",
        request: JSON.stringify({ query: `burst ${i}` }),
        response: JSON.stringify({ results: [{ fact_id: (i % 12) + 1 }] }),
        before: null, after: null, duration_ms: 1, undone_by: null });
    }
  }, { start: EVENTS + 5, count: 405 });
  await page.waitForFunction((id) => document.querySelector(`.s-line[data-eid="${id}"]`), EVENTS + 409);
  const visibleRows = await page.locator(".s-line").count();

  return {
    scrollAnchorDelta: anchorBefore && anchorAfter !== null ? Math.abs(anchorAfter - anchorBefore.offset) : null,
    bottomGap, hostileNode, hostileTextKept: hostileText.includes(`<img id="xss-probe"`), invalidIdRefs: refs,
    allResultRefs: navCount, inspected, visibleRows, oddRefs, pageErrors, initialOrder,
  };
  } finally {
    try { await browser?.close(); }
    finally { await server.stop(); }
  }
}

(async () => {
  try {
  if (!Number.isSafeInteger(FACTS) || FACTS < 12 || !Number.isSafeInteger(EVENTS) || EVENTS < 10 ||
      !Number.isSafeInteger(RUNS) || RUNS < 1) throw new Error("FACTS>=12, EVENTS>=10, RUNS>=1 required");
  const baselineDist = stage("baseline", true);
  const candidateDist = stage("candidate", false);
  const values = { baseline: [], candidate: [] };
  const pairOrder = [];
  for (let i = 0; i < RUNS; i++) {
    // LONG alternates B/C then C/B. Pair index still aligns exact parity checks.
    const order = LONG && i % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    pairOrder.push(order);
    for (const variant of order)
      values[variant].push(await one(variant === "baseline" ? baselineDist : candidateDist));
  }
  const keys = ["bootMs", "tailApplyMs", "burstApplyMs", "drawMs", "drawP95Ms", "hitMs", "drawRects", "hitRects"];
  const summary = {};
  for (const variant of ["baseline", "candidate"]) {
    summary[variant] = {};
    for (const key of keys) summary[variant][key] = median(values[variant].map((x) => x[key]));
  }
  const checks = await candidateChecks(candidateDist);
  const correctness = {
    pixelHashEqual: values.baseline.every((v, i) => v.pixelHash === values.candidate[i].pixelHash),
    hitProbeIdsEqual: values.baseline.every((v, i) =>
      JSON.stringify(v.probes) === JSON.stringify(values.candidate[i].probes) &&
      v.hitChecksum === values.candidate[i].hitChecksum),
    scrollAnchorStable: checks.scrollAnchorDelta !== null && checks.scrollAnchorDelta <= 1,
    followsBottom: checks.bottomGap <= 1,
    hostileMarkupIsText: checks.hostileNode === 0 && checks.hostileTextKept,
    rejectsNonIntegerAndUnrelatedIds: JSON.stringify(checks.invalidIdRefs) === "[6]",
    allKnownResultsNavigable: checks.allResultRefs === 12 && checks.inspected === "f#0012",
    visibleRowsBounded: checks.visibleRows === 200,
    nonObjectJsonSafe: checks.oddRefs === 0 && checks.pageErrors.length === 0,
    journalOrderStable: checks.initialOrder.every((id, i, ids) => i === 0 || ids[i - 1] < id),
  };
  const ok = Object.values(correctness).every(Boolean);
  console.log(JSON.stringify({ status: ok ? "ok" : "error", tool: "perf_frontend",
    version: "1", ts: new Date().toISOString(), fixture: { facts: FACTS, events: EVENTS,
    runs: RUNS, viewport: "1440x900", baselineRef: BASELINE_REF,
    measurement: { mode: LONG ? "long diagnostic; supplements earlier short results" : "original short",
      untimedDrawWarmup: DRAW_WARMUP, drawSamplesPerArmPerRun: DRAW_SAMPLES, pairOrder,
      timingScope: "synchronous canvas command submission, not frame presentation latency" },
    vectors: "all facts have vectors; vectorless caption deliberately outside this fixture",
    labels: "off in both arms from construction" },
    comparison: { scope: "Field/Stream modules under current UI/state/geometry, not whole releases or new-feature parity",
      baselineAdapter: ADAPTER, camera: "each arm fit() after boot", pixels: "exact full canvas, no crop or tolerance" }, summary, raw: values,
    checks, correctness, artifacts: KEEP ? root : "removed" }, null, 2));
  process.exitCode = ok ? 0 : 1;
  } finally {
    if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(JSON.stringify({ status: "error", tool: "perf_frontend", version: "1",
    ts: new Date().toISOString(), error: String(error.stack || error),
    fix: "Run from the repository with npm install completed in build/eye_frontend and build/verify." }));
  process.exitCode = 2;
});
