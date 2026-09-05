#!/usr/bin/env node
"use strict";

/* Deterministic frontend edge harness for the Holographic Eye.
   It serves built assets and synthetic memory fixtures on an ephemeral
   loopback port. It never reads ~/.hermes, :8770, or a real token/database. */

const { chromium } = require("playwright-core");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "../eye_frontend/dist");
const TOKEN = "synthetic-fixture-token";
const BROWSER = process.env.EYE_BROWSER || "/usr/bin/thorium-browser";
const ARTIFACT_BASE = process.env.EYE_EDGE_ARTIFACTS ||
  path.join(__dirname, "shots", "gui-edge");
const ARTIFACTS = path.join(ARTIFACT_BASE,
  process.env.EYE_EDGE_RUN_ID || `run-${process.pid}`);
fs.mkdirSync(ARTIFACTS, { recursive: true });

function fact(id, content, overrides = {}) {
  const a = (id * 2.399963229728653) % (Math.PI * 2);
  const r = 12 + Math.sqrt(id) * 5;
  return {
    fact_id: id, x: Math.cos(a) * r, y: Math.sin(a) * r,
    has_vector: true, content, category: "project", tags: "synthetic,edge",
    trust_score: ((id % 9) + 1) / 10, retrieval_count: id % 17,
    helpful_count: id % 4, created_at: "2026-01-02T03:04:05Z",
    updated_at: "2026-01-02T03:04:05Z", entities: ["Synthetic Entity"],
    ...overrides,
  };
}

function entity(id, name, factCount = 1, overrides = {}) {
  return { entity_id: id, name, entity_type: "concept", aliases: "",
           fact_count: factCount, ...overrides };
}

const HOSTILE = `雪❄️ café e\u0301 عربى 👩‍🔬 & <img id="xss-probe" src="/xss" onerror="window.__xss=1"> "quote" 'apostrophe'`;

function statsFor(facts, entities) {
  const categories = {};
  const trust_histogram = {};
  for (const f of facts) {
    categories[f.category] = (categories[f.category] || 0) + 1;
    const k = (Math.round(f.trust_score * 10) / 10).toFixed(1);
    trust_histogram[k] = (trust_histogram[k] || 0) + 1;
  }
  return {
    facts: facts.length, entities: entities.length, categories, trust_histogram,
    snr: facts.length ? Number(Math.sqrt(1024 / facts.length).toFixed(2)) : 0,
    min_trust: 0.3, hrr_dim: 1024, session_id: "synthetic-only",
    mode: "fixture", journal: { last_event_id: 2, lag_s: 0 },
  };
}

function makeFixture(name) {
  let facts = [], entities = [], events = [];
  if (name === "singleton") {
    facts = [fact(1, "One deterministic synthetic fact")];
    entities = [entity(1, "Synthetic Entity")];
  } else if (name === "normal" || name === "stale") {
    facts = [
      fact(1, "First stale response sentinel"),
      fact(2, "Second latest response sentinel", { x: 42, y: -18, trust_score: 0.8 }),
      fact(3, "A fact without a vector", { x: null, y: null, has_vector: false,
        category: "general", entities: [] }),
    ];
    entities = [entity(1, "Synthetic Entity", 2), entity(2, "Zero Link", 0)];
  } else if (name === "hostile") {
    facts = [fact(7, HOSTILE, { entities: [HOSTILE] })];
    entities = [entity(7, HOSTILE)];
    events = [{
      event_id: 1, ts: "2026-01-02T03:04:05Z", session_id: "synthetic-only",
      source: "tool", kind: "add", request: JSON.stringify({ content: HOSTILE }),
      response: JSON.stringify({ fact_id: 7 }), before: null,
      after: JSON.stringify({ facts: [facts[0]], entities_created: [] }),
      duration_ms: 1, undone_by: null,
    }];
  } else if (name === "hero") {
    const cats = ["project", "user_pref", "tool", "lesson", "general", "seed", "session"];
    facts = Array.from({ length: 140 }, (_, i) => fact(i + 1,
      `Synthetic ${cats[i % cats.length]} memory ${String(i + 1).padStart(3, "0")} — fixture evidence only`, {
        category: cats[i % cats.length], entities: [`Topic ${i % 24}`, "Synthetic Atlas"],
        trust_score: 0.2 + (i % 8) * 0.1,
      }));
    entities = Array.from({ length: 25 }, (_, i) => entity(i + 1,
      i === 24 ? "Synthetic Atlas" : `Topic ${i}`, i === 24 ? 140 : 6));
    events = Array.from({ length: 14 }, (_, i) => ({
      event_id: i + 1, ts: new Date(Date.UTC(2026, 0, 2, 3, 4, i)).toISOString(),
      session_id: "synthetic-only", source: "tool", kind: "search",
      request: JSON.stringify({ query: `synthetic query ${i + 1}` }),
      response: JSON.stringify({ results: facts.slice(i, i + 3).map((x) => ({ fact_id: x.fact_id, score: 0.8 })) }),
      before: null, after: null, duration_ms: 4 + i, undone_by: null,
    }));
  } else if (name === "history") {
    facts = Array.from({ length: 60 }, (_, i) => fact(i + 1,
      `History selection ${String(i + 1).padStart(2, "0")}`, { entities: ["History Entity"] }));
    entities = [entity(1, "History Entity", 60)];
  } else if (name === "large") {
    facts = Array.from({ length: 3000 }, (_, i) => fact(i + 1,
      `Synthetic fact ${String(i + 1).padStart(4, "0")} — deterministic load fixture`, {
        category: ["project", "user_pref", "tool", "lesson", "novel-cat"][i % 5],
        entities: [`Entity ${i % 600}`],
      }));
    entities = Array.from({ length: 600 }, (_, i) => entity(i + 1, `Entity ${i}`, 5));
  }
  return { name, facts, entities, events, stats: statsFor(facts, entities) };
}

function detailedFact(f) {
  return {
    ...f, links: f.entities.map((name, i) => ({ entity_id: i + 1, name })),
    vector_bytes: f.has_vector ? 8192 : 0,
    journal_retrievals: f.retrieval_count,
  };
}

class FixtureServer {
  constructor() {
    this.fixture = makeFixture("normal");
    this.acceptWs = true;
    this.sockets = new Set();
    this.unauthorized = 0;
    this.rpcCalls = [];
    this.staticRequests = [];
    this.mutationCalls = [];
    this.factGetDelays = new Map();
    this.probePlans = [];
    this.mutationDelayMs = 0;
    this.mutationReplies = [];
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.on("upgrade", (req, socket) => this.upgrade(req, socket));
  }

  setFixture(name) {
    this.fixture = makeFixture(name);
    this.factGetDelays.clear();
    this.probePlans = [];
    this.mutationReplies = [];
  }

  auth(req) {
    return req.headers.authorization === `Bearer ${TOKEN}`;
  }

  json(res, status, body) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": data.length,
      "Cache-Control": "no-store" });
    res.end(data);
  }

  async body(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }

  staticFile(req, res) {
    const pathname = new URL(req.url, "http://fixture.invalid").pathname;
    const rel = pathname === "/" ? "index.html"
      : pathname === "/favicon.ico" ? "favicon.png" : pathname.slice(1);
    this.staticRequests.push(rel);
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end("synthetic fixture: not found"); return;
    }
    const ext = path.extname(file);
    const type = { ".html": "text/html; charset=utf-8", ".js": "application/javascript",
      ".css": "text/css", ".png": "image/png" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  }

  async handle(req, res) {
    try {
      const pathname = new URL(req.url, "http://fixture.invalid").pathname;
      if (pathname === "/xss") {
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XarWAAAAAElFTkSuQmCC", "base64");
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length });
        res.end(png); return;
      }
      if (pathname === "/stats") {
        if (!this.auth(req)) { this.unauthorized++; return this.json(res, 401, { error: "synthetic unauthorized" }); }
        return this.json(res, 200, this.fixture.stats);
      }
      if (pathname === "/rpc" && req.method === "POST") {
        if (!this.auth(req)) { this.unauthorized++; return this.json(res, 401, { error: "synthetic unauthorized" }); }
        const body = await this.body(req);
        this.rpcCalls.push(body);
        const result = await this.rpc(body.method, body.params || {});
        return this.json(res, 200, result);
      }
      this.staticFile(req, res);
    } catch (error) {
      this.json(res, 500, { error: `fixture server: ${error.message}` });
    }
  }

  async rpc(method, params) {
    const f = this.fixture;
    if (method === "field.projection") return { facts: f.facts,
      meta: { explained_variance: [0.44, 0.22], fixture: f.name } };
    if (method === "entities.list") return { entities: f.entities, total: f.entities.length };
    if (method === "journal.tail") {
      const since = Number(params.since_id || 0);
      const limit = Math.max(0, Number(params.limit || 120));
      let events = f.events.filter((ev) => ev.event_id > since)
        .sort((a, b) => a.event_id - b.event_id);
      if (params.newest_first) events = events.slice(-limit).reverse();
      else events = events.slice(0, limit);
      return { events };
    }
    if (method === "fact.get") {
      const delay = this.factGetDelays.get(Number(params.fact_id)) || 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return { fact: detailedFact(f.facts.find((x) => x.fact_id === Number(params.fact_id))) };
    }
    if (method === "probe") {
      const plan = this.probePlans.length ? this.probePlans.shift() : null;
      if (plan?.delay) await new Promise((resolve) => setTimeout(resolve, plan.delay));
      const rows = plan?.results ?? f.facts.slice(0, 8).map((x) => ({
        fact_id: x.fact_id, score: x.trust_score * 0.75,
        trust_score: x.trust_score, content: x.content,
      }));
      return { raw: JSON.stringify({ results: rows }) };
    }
    if (method === "contradict") {
      const rows = f.name === "history" ? [{ contradiction_score: 0.8,
        fact_a: f.facts[54], fact_b: f.facts[55], shared_entities: ["History Entity"] }] : [];
      return { raw: JSON.stringify({ results: rows }) };
    }
    if (method === "reason.explain") return {
      results: f.facts.slice(0, 8).map((x, i) => ({ ...x, score: 0.9 - i * 0.05,
        entity_sims: { synthetic: (0.8 - i * 0.03).toFixed(2) } })),
      math: ["probe_key = synthetic fixture", "results are not live memory"],
    };
    if (method === "fact.spectrum") return { traces: [], composition: [] };
    if (method === "fact.preview_update") {
      const before = detailedFact(f.facts.find((x) => x.fact_id === Number(params.fact_id)));
      return { before, after: { ...before, ...params }, predicted_entities: [],
        entities_removed: [], bank_impact: [] };
    }
    const mutationMethods = new Set(["fact.remove", "fact.update", "fact.feedback",
      "fact.trust_set", "entity.merge", "entity.alias", "entity.remove", "undo",
      "backfill_vectors", "backup.create", "agent.ask"]);
    if (mutationMethods.has(method)) {
      this.mutationCalls.push({ method, params, at: Date.now() });
      if (this.mutationDelayMs) await new Promise((resolve) => setTimeout(resolve, this.mutationDelayMs));
      if (this.mutationReplies.length) return this.mutationReplies.shift();
      const acknowledgment = { ok: true, event_id: this.mutationCalls.length };
      if (method === "fact.remove") return { ...acknowledgment, removed: params.fact_id };
      if (method === "agent.ask") return { ...acknowledgment,
        session_id: params.session_id || "synthetic-only", reply: "Synthetic confirmed reply" };
      if (method === "backup.create") return { ...acknowledgment,
        path: "/synthetic/backup", manifest: { facts: f.facts.length } };
      return acknowledgment;
    }
    if (method === "backup.list") return { default_dest: "/tmp/synthetic-backups",
      known_dests: ["/tmp/synthetic-backups"], mass_storage_mounted: false, backups: [] };
    if (method === "agent.sessions") return { ok: true, eye_attached_session: "synthetic-only", sessions: [] };
    return { error: `unsupported synthetic RPC: ${method}` };
  }

  upgrade(req, socket) {
    const u = new URL(req.url, "http://fixture.invalid");
    if (u.pathname !== "/events" || u.searchParams.get("token") !== TOKEN || !this.acceptWs) {
      if (u.searchParams.get("token") !== TOKEN) this.unauthorized++;
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => this.sockets.delete(socket));
    this.send(socket, { type: "hello", stats: this.fixture.stats });
  }

  send(socket, obj) {
    const payload = Buffer.from(JSON.stringify(obj));
    let head;
    if (payload.length < 126) head = Buffer.from([0x81, payload.length]);
    else if (payload.length < 65536) {
      head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(payload.length, 2);
    } else {
      head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    socket.write(Buffer.concat([head, payload]));
  }

  dropWebSockets() {
    for (const socket of [...this.sockets]) socket.destroy();
    this.sockets.clear();
  }

  async start() {
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = this.server.address().port;
    this.url = `http://127.0.0.1:${this.port}/`;
  }

  async stop() {
    this.dropWebSockets();
    this.server.closeAllConnections();
    if (this.server.listening) await new Promise((resolve) => this.server.close(resolve));
  }
}

const results = [];
function check(suite, label, ok, detail = "") {
  const rec = { suite, label, ok: Boolean(ok), detail };
  results.push(rec);
  console.log(`[${rec.ok ? "PASS" : "FAIL"}] ${suite}: ${label}${detail ? ` — ${detail}` : ""}`);
  return rec.ok;
}

function pageLog(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function seedToken(page, token = TOKEN) {
  await page.addInitScript((value) => localStorage.setItem("eyeToken", value), token);
}

async function bootPage(browser, server, fixture, opts = {}) {
  server.setFixture(fixture);
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 },
    reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = pageLog(page);
  if (opts.init) await page.addInitScript(opts.init, opts.initArg);
  else await seedToken(page, opts.token === undefined ? TOKEN : opts.token);
  const started = Date.now();
  await page.goto(opts.urlToken ? `${server.url}?token=${TOKEN}` : server.url, { waitUntil: "domcontentloaded" });
  let booted = true;
  try {
    await page.waitForFunction(() => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""),
      null, { timeout: opts.timeout || 10000 });
  } catch (error) {
    if (!opts.allowBootFailure) throw error;
    booted = false;
  }
  return { context, page, errors, booted, bootMs: Date.now() - started };
}

async function selectFirstViaEntity(page) {
  if (await page.locator("#ins-del").count()) return;
  let rows = page.locator(".ent-fact[data-fid]");
  if (!(await rows.count())) {
    await page.locator(".ent-row .chev").first().click();
    rows = page.locator(".ent-fact[data-fid]");
  }
  await rows.first().click();
  await page.waitForSelector("#ins-del");
}

async function run() {
  if (!fs.existsSync(path.join(ROOT, "bundle.js"))) {
    throw new Error(`candidate build missing: ${path.join(ROOT, "bundle.js")} (run npm test)`);
  }
  if (!fs.existsSync(BROWSER)) throw new Error(`headless browser missing: ${BROWSER}`);

  const server = new FixtureServer();
  let browser;
  try {
  await server.start();
  console.log(`Synthetic fixture server: ${server.url} (ephemeral loopback; not :8770)`);
  console.log(`Private artifacts: ${ARTIFACTS}`);

  browser = await chromium.launch({ executablePath: BROWSER, headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-background-networking"] });

    // Empty, singleton, and large data sets.
    for (const name of ["empty", "singleton", "large"]) {
      const p = await bootPage(browser, server, name);
      const metric = await p.page.locator("#sb-metrics").innerText();
      check("fixtures", `${name} boots`, metric.includes(`${server.fixture.facts.length} facts`),
        `${p.bootMs}ms; ${metric.replace(/\s+/g, " ")}`);
      check("fixtures", `${name} has no runtime errors`, p.errors.length === 0,
        p.errors.slice(0, 2).join(" | "));
      if (name === "empty") {
        const rail = p.page.locator("#inspect-open");
        const railBox = await p.page.locator("#pane-inspect").boundingBox();
        check("fixtures", "empty Inspect collapses to its rail",
          await rail.count() === 1 && Boolean(railBox) && railBox.width <= 50,
          `width=${railBox?.width ?? "missing"}px`);
        if (await rail.count()) await rail.click();
        check("fixtures", "empty Inspect manual opens on request",
          /select a field point/i.test(await p.page.locator("#pane-inspect").innerText()));
      }
      if (name === "singleton") {
        await selectFirstViaEntity(p.page);
        check("fixtures", "singleton selects and inspects",
          (await p.page.locator(".factid").innerText()) === "f#0001");
      }
      if (name === "large") {
        const rows = await p.page.locator(".ent-row").count();
        check("fixtures", "large entity list stays bounded", rows === 40, `${rows} DOM rows`);
        check("fixtures", "large fixture boots within 5s", p.bootMs < 5000, `${p.bootMs}ms for 3000 facts`);
      }
      await p.context.close();
    }

    // Hostile Unicode and markup must render as text in every surface.
    {
      const p = await bootPage(browser, server, "hostile");
      await p.page.waitForTimeout(100);
      const injected = await p.page.locator("#xss-probe").count();
      const xssRan = await p.page.evaluate(() => Boolean(window.__xss));
      check("content", "hostile markup never creates DOM", injected === 0 && !xssRan,
        `injectedNodes=${injected} handlerRan=${xssRan}`);
      await selectFirstViaEntity(p.page);
      const text = await p.page.locator("#ins-content").innerText();
      check("content", "Unicode survives inspect round-trip",
        text.includes("雪❄️") && text.includes("عربى") && text.includes("👩‍🔬"), text.slice(0, 90));
      check("content", "hostile fixture has no runtime errors", p.errors.length === 0,
        p.errors.slice(0, 2).join(" | "));
      await p.context.close();
    }

    // Missing token: Cancel must yield one recoverable error, then explicit retry may prompt once.
    {
      server.setFixture("singleton");
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = pageLog(page);
      await page.addInitScript((token) => {
        window.prompt = () => {
          const n = Number(sessionStorage.getItem("__promptCalls") || 0) + 1;
          sessionStorage.setItem("__promptCalls", String(n));
          return n === 1 ? null : token;
        };
      }, TOKEN);
      await page.goto(server.url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      let prompts = await page.evaluate(() => Number(sessionStorage.getItem("__promptCalls") || 0));
      const initialText = await page.locator("body").innerText();
      const initialAttached = /\d+ facts/.test(await page.locator("#sb-metrics").innerText().catch(() => ""));
      const hasRetry = /retry/i.test(initialText);
      check("token", "Cancel stops at one prompt with recoverable retry UI",
        prompts === 1 && !initialAttached && hasRetry,
        `prompts=${prompts} attached=${initialAttached} retry=${hasRetry}`);
      if (hasRetry && !initialAttached) {
        const retry = page.locator("a,button").filter({ hasText: /retry/i }).first();
        if (await retry.count()) await retry.click();
      }
      await page.waitForFunction(() => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""),
        null, { timeout: 10000 });
      prompts = await page.evaluate(() => Number(sessionStorage.getItem("__promptCalls") || 0));
      check("token", "explicit retry after Cancel attaches",
        (await page.locator("#sb-metrics").innerText()).includes("1 facts"));
      check("token", "Cancel plus explicit retry prompts exactly twice", prompts === 2,
        `${prompts} prompt calls`);
      check("token", "recovered token is stored",
        await page.evaluate((token) => localStorage.getItem("eyeToken") === token, TOKEN));
      check("token", "missing-token recovery has no runtime errors", errors.length === 0,
        errors.slice(0, 2).join(" | "));
      await context.close();
    }

    // A 401 must clear the token and show explicit retry without a prompt/reload storm.
    {
      server.setFixture("singleton");
      const unauth0 = server.unauthorized;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = pageLog(page);
      await page.addInitScript((token) => {
        try {
          if (!sessionStorage.getItem("__badSeeded")) {
            localStorage.setItem("eyeToken", "wrong-synthetic-token");
            sessionStorage.setItem("__badSeeded", "1");
          }
        } catch { /* about:blank has no storage origin */ }
        window.prompt = () => {
          const n = Number(sessionStorage.getItem("__promptCalls") || 0) + 1;
          sessionStorage.setItem("__promptCalls", String(n));
          return token;
        };
      }, TOKEN);
      await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
      let prompts = await page.evaluate(() => Number(sessionStorage.getItem("__promptCalls") || 0));
      const initialText = await page.locator("body").innerText();
      const initialAttached = /\d+ facts/.test(await page.locator("#sb-metrics").innerText().catch(() => ""));
      const hasRetry = /retry/i.test(initialText);
      check("token", "wrong stored token reaches synthetic 401", server.unauthorized > unauth0,
        `${server.unauthorized - unauth0} rejected requests`);
      check("token", "401 waits for explicit retry without prompting",
        prompts === 0 && !initialAttached && hasRetry,
        `prompts=${prompts} attached=${initialAttached} retry=${hasRetry}`);
      if (hasRetry && !initialAttached) {
        const retry = page.locator("a,button").filter({ hasText: /retry/i }).first();
        if (await retry.count()) await retry.click();
      }
      let booted = true;
      try {
        await page.waitForFunction(() => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""),
          null, { timeout: 10000 });
      } catch { booted = false; }
      prompts = await page.evaluate(() => Number(sessionStorage.getItem("__promptCalls") || 0)).catch(() => -1);
      check("token", "explicit retry after 401 attaches", booted,
        booted ? "metrics rendered" : "metrics did not render within 10s");
      check("token", "401 recovery prompts once", prompts === 1, `${prompts} prompt calls`);
      let replaced = false;
      try { replaced = await page.evaluate((token) => localStorage.getItem("eyeToken") === token, TOKEN); }
      catch { /* reload still in flight */ }
      check("token", "wrong token is replaced", replaced);
      const unexpected401Errors = errors.filter((e) =>
        !/status of 401|HTTP 401|WebSocket connection.*wrong-synthetic-token.*HTTP Authentication failed/i.test(e));
      check("token", "wrong-token recovery has no unhandled runtime errors",
        unexpected401Errors.length === 0, unexpected401Errors.slice(0, 2).join(" | "));
      await context.close();
    }

    // Storage can fail at property access or at each method. The app still works in memory.
    for (const mode of ["property-denied", "methods-denied"]) {
      const p = await bootPage(browser, server, "singleton", {
        allowBootFailure: true, timeout: 3000, urlToken: mode === "property-denied",
        init: ({ mode, token }) => {
          const denied = () => { throw new DOMException("synthetic localStorage denial", "SecurityError"); };
          if (mode === "property-denied") Object.defineProperty(window, "localStorage", { get: denied });
          else for (const method of ["getItem", "setItem", "removeItem"])
            Storage.prototype[method] = denied;
          window.__storagePrompts = 0;
          window.prompt = () => { window.__storagePrompts++; return token; };
        }, initArg: { mode, token: TOKEN },
      });
      try {
        check("storage", `${mode}: boot uses in-memory token`, p.booted,
          `boot=${p.booted}; errors=${p.errors.join(" | ")}`);
        if (!p.booted) continue;
        await p.page.evaluate(() => window.eyeRefresh());
        check("storage", `${mode}: reads reuse token without prompt storm`,
          await p.page.evaluate(() => window.__storagePrompts) === (mode === "property-denied" ? 0 : 1));
        check("storage", `${mode}: URL does not retain token`, !new URL(p.page.url()).searchParams.has("token"));
        await p.page.locator("#sb-settings").click();
        await p.page.selectOption("#st-scale", "1.25");
        await p.page.locator("#st-garden").uncheck();
        await p.page.locator('.theme-chip[data-th="amber"]').click();
        await p.page.keyboard.press("Escape");
        await p.page.locator("#sb-settings").click();
        const settings = await p.page.evaluate(() => ({
          scale: document.querySelector("#st-scale").value,
          fontSize: document.documentElement.style.fontSize,
          garden: document.querySelector("#st-garden").checked,
          noGarden: document.body.classList.contains("no-garden"),
          theme: document.querySelector('.theme-chip[data-th="amber"]').getAttribute("aria-pressed"),
        }));
        check("storage", `${mode}: Settings retains scale, garden, and theme in memory`,
          settings.scale === "1.25" && settings.fontSize === "16.25px" &&
          !settings.garden && settings.noGarden && settings.theme === "true", JSON.stringify(settings));
        await p.page.screenshot({ path: path.join(ARTIFACTS, `settings-${mode}-synthetic.png`) });
        check("storage", `${mode}: no unhandled runtime errors`, p.errors.length === 0, p.errors.join(" | "));
      } finally { await p.context.close(); }
    }

    // A rejected persisted token must not be read again when persistent removal fails.
    {
      const p = await bootPage(browser, server, "singleton", {
        allowBootFailure: true, timeout: 700,
        init: () => {
          localStorage.setItem("eyeToken", "wrong-synthetic-token");
          Storage.prototype.removeItem = () => { throw new DOMException("synthetic removal denial", "SecurityError"); };
          window.__storagePrompts = 0;
          window.prompt = () => { window.__storagePrompts++; return null; };
        },
      });
      try {
        const before = server.unauthorized;
        const failures = await p.page.evaluate(async () => {
          const outcomes = [];
          for (let i = 0; i < 2; i++) {
            // eyeRefresh handles its rejection by rendering the read-error panel.
            await window.eyeRefresh();
            outcomes.push({
              errorVisible: document.querySelector("#boot-error")?.hidden === false,
              message: document.querySelector("#boot-error-message")?.textContent || "",
              attached: /\d+ facts/.test(document.querySelector("#sb-metrics")?.textContent || ""),
            });
          }
          return outcomes;
        });
        check("storage", "rejected token is not reused despite failed persistent removal",
          !p.booted && server.unauthorized === before &&
          await p.page.evaluate(() => window.__storagePrompts) === 0 &&
          failures.every((x) => x.errorVisible && !x.attached && /No control-plane token/.test(x.message)),
          `extraRejected=${server.unauthorized - before}; outcomes=${JSON.stringify(failures)}`);
        const unexpected = p.errors.filter((e) => !/status of 401|HTTP 401|WebSocket connection.*wrong-synthetic-token.*HTTP Authentication failed/i.test(e));
        check("storage", "token rejection with denied removal has no unhandled errors", unexpected.length === 0,
          unexpected.join(" | "));
      } finally { await p.context.close(); }
    }

    // Every malformed acknowledgment keeps the visible send locked, including forced duplicate events.
    for (const [label, reply] of [["null", null], ["array", []], ["empty", {}],
      ["negative", { ok: false }], ["missing-event", { ok: true, session_id: "fixture", reply: "fixture" }],
      ["malformed-success", { ok: true, event_id: 1, session_id: 3, reply: null }]]) {
      const p = await bootPage(browser, server, "singleton");
      try {
        server.mutationReplies = [reply];
        const before = server.mutationCalls.length;
        await p.page.evaluate(() => window.eyeAskAgent([1]));
        await p.page.locator("#ask-send").click();
        await p.page.waitForFunction(() => document.querySelector("#ask-send")?.textContent === "outcome unknown");
        await p.page.locator("#ask-send").dispatchEvent("click");
        await p.page.waitForTimeout(50);
        const status = await p.page.locator("#ask-status").innerText();
        check("acknowledgment", `${label}: no success UI and no duplicate send`,
          await p.page.locator("#ask-send").isDisabled() &&
          server.mutationCalls.length - before === 1 && /unknown/i.test(status) && !/landed|agent replied/i.test(status),
          `requests=${server.mutationCalls.length - before}; ${status}`);
        check("acknowledgment", `${label}: no unhandled runtime errors`, p.errors.length === 0, p.errors.join(" | "));
      } finally { await p.context.close(); }
    }

    // A confirmed send followed by a failed read is still sent. It must never become retryable.
    {
      const p = await bootPage(browser, server, "singleton");
      try {
        const before = server.mutationCalls.length;
        await p.page.evaluate(() => {
          window.__refreshFailures = 0;
          window.eyeRefresh = async () => {
            window.__refreshFailures++;
            throw new Error("synthetic read failure after confirmed send");
          };
          window.eyeAskAgent([1]);
        });
        await p.page.locator("#ask-send").click();
        await p.page.waitForFunction(() => /already sent/i.test(document.querySelector("#ask-status")?.textContent || ""));
        await p.page.locator("#ask-send").dispatchEvent("click");
        await p.page.waitForTimeout(50);
        const status = await p.page.locator("#ask-status").innerText();
        check("agent", "confirmed send stays disabled after refresh fails",
          await p.page.locator("#ask-send").isDisabled() &&
          await p.page.locator("#ask-send").innerText() === "sent" &&
          /already sent/i.test(status) && /synthetic read failure/i.test(status), status);
        check("agent", "confirmed send cannot resubmit after failed refresh",
          server.mutationCalls.length - before === 1 &&
          await p.page.evaluate(() => window.__refreshFailures) === 1,
          `requests=${server.mutationCalls.length - before}`);
        await p.page.screenshot({ path: path.join(ARTIFACTS, "agent-confirmed-refresh-failed-synthetic.png") });
        check("agent", "confirmed send read failure has no unhandled runtime errors",
          p.errors.length === 0, p.errors.join(" | "));
      } finally { await p.context.close(); }
    }

    // If initial WebSocket is unavailable, the first later hello must catch up after HTTP boot.
    server.acceptWs = false;
    const lateHello = await bootPage(browser, server, "normal");
    await lateHello.page.waitForFunction(() => document.querySelector("#sb-livelabel")?.textContent === "off");
    await lateHello.page.waitForTimeout(150);
    const lateFact = fact(4, "Late first-hello catch-up sentinel", {
      x: 63, y: 11, category: "lesson", entities: ["Synthetic Entity"] });
    server.fixture.facts.push(lateFact);
    server.fixture.entities[0].fact_count++;
    server.fixture.events.push({ event_id: 99, ts: "2026-01-02T03:06:39Z",
      session_id: "synthetic-only", source: "tool", kind: "search",
      request: JSON.stringify({ query: "late first hello" }),
      response: JSON.stringify({ results: [{ fact_id: 4, score: 0.92 }] }),
      before: null, after: null, duration_ms: 5, undone_by: null });
    server.fixture.stats = statsFor(server.fixture.facts, server.fixture.entities);
    server.fixture.stats.journal = { last_event_id: 99, lag_s: 0 };
    server.acceptWs = true;
    try {
      await lateHello.page.waitForFunction(() =>
        document.querySelector("#sb-livelabel")?.textContent === "live" &&
        document.querySelector("#sb-metrics")?.textContent?.includes("4 facts") &&
        document.querySelectorAll('.s-line[data-eid="99"]').length === 1,
        null, { timeout: 7000 });
    } catch { /* measured below */ }
    check("network", "late first hello catches up after successful HTTP boot",
      (await lateHello.page.locator("#sb-metrics").innerText()).includes("4 facts") &&
      await lateHello.page.locator('.s-line[data-eid="99"]').count() === 1,
      `metrics=${await lateHello.page.locator("#sb-metrics").innerText()} eventCopies=${await lateHello.page.locator('.s-line[data-eid="99"]').count()}`);
    const lateUnexpected = lateHello.errors.filter((e) =>
      !/WebSocket connection.*synthetic-fixture-token.*HTTP Authentication failed/i.test(e));
    check("network", "late-first-hello path has no unhandled errors", lateUnexpected.length === 0,
      lateUnexpected.slice(0, 2).join(" | "));
    await lateHello.context.close();

    // Normal baseline, network reconnect, and private screenshot.
    const normal = await bootPage(browser, server, "normal");
    await normal.page.screenshot({ path: path.join(ARTIFACTS, "normal-synthetic.png") });
    await normal.page.waitForFunction(() => window.eyeField?.geometryStatus?.().mode === "wasm",
      null, { timeout: 5000 });
    await normal.page.locator("#sb-settings").click();
    const settingsText = await normal.page.locator(".modal-back").innerText();
    check("geometry", "built geometry.wasm loads through fixture server",
      server.staticRequests.includes("geometry.wasm"));
    check("geometry", "Settings reports Zig/WASM and packed fact count",
      settingsText.includes("Zig/WASM") && settingsText.includes("2 packed facts"),
      settingsText.match(/field geometry[^\n]*[\s\S]{0,100}/i)?.[0]?.replace(/\s+/g, " ") || "missing");
    await normal.page.screenshot({ path: path.join(ARTIFACTS, "settings-geometry-wasm-synthetic.png") });
    await normal.page.keyboard.press("Escape");
    check("network", "starts live", (await normal.page.locator("#sb-livelabel").innerText()) === "live");
    const mutationsBeforeOffline = server.mutationCalls.length;
    server.acceptWs = false;
    server.dropWebSockets();
    await normal.page.waitForFunction(() => document.querySelector("#sb-livelabel")?.textContent === "off",
      null, { timeout: 3000 });
    check("network", "loss becomes visible", true);
    const offlineFact = fact(4, "Offline catch-up sentinel", {
      x: 70, y: 22, category: "lesson", entities: ["Synthetic Entity"] });
    server.fixture.facts.push(offlineFact);
    server.fixture.entities[0].fact_count++;
    server.fixture.events = Array.from({ length: 450 }, (_, i) => ({
      event_id: i + 1, ts: new Date(Date.UTC(2026, 0, 2, 3, 5, i)).toISOString(),
      session_id: "synthetic-only", source: "tool", kind: "search",
      request: JSON.stringify({ query: `offline catch-up ${i + 1}` }),
      response: JSON.stringify({ results: [{ fact_id: 4, score: 0.91 }] }),
      before: null, after: null, duration_ms: 7, undone_by: null,
    }));
    server.fixture.stats = statsFor(server.fixture.facts, server.fixture.entities);
    server.fixture.stats.journal = { last_event_id: 450, lag_s: 0 };
    await normal.page.waitForTimeout(1150);
    server.acceptWs = true;
    await normal.page.waitForFunction(() => document.querySelector("#sb-livelabel")?.textContent === "live",
      null, { timeout: 7000 });
    check("network", "WebSocket reconnects", true);
    try {
      await normal.page.waitForFunction(() =>
        document.querySelector("#sb-metrics")?.textContent?.includes("4 facts") &&
        document.querySelectorAll('.s-line[data-eid="450"]').length === 1,
        null, { timeout: 7000 });
    } catch { /* checks below report each missing read surface */ }
    const caughtMetrics = (await normal.page.locator("#sb-metrics").innerText()).includes("4 facts");
    const caughtEntity = (await normal.page.locator(".ent-row .n").first().innerText()) === "3";
    await normal.page.keyboard.press("Control+f");
    await normal.page.locator(".find-overlay input").fill("offline catch-up sentinel");
    const caughtProjection = await normal.page.locator('.find-results [data-id="4"]').count() === 1;
    await normal.page.keyboard.press("Escape");
    check("network", "reconnect catches up projection, entities, and stats",
      caughtMetrics && caughtEntity && caughtProjection,
      `stats=${caughtMetrics} entity=${caughtEntity} projection=${caughtProjection}`);
    const caughtEvents = await normal.page.locator('.s-line[data-eid="450"]').count();
    const staleFirstEvent = await normal.page.locator('.s-line[data-eid="1"]').count();
    const reconnectTail = [...server.rpcCalls].reverse().find((call) =>
      call.method === "journal.tail" && Number(call.params?.limit) === 400);
    check("network", "offline journal window requests the latest 400 events",
      reconnectTail?.params?.since_id === 50 && caughtEvents === 1 && staleFirstEvent === 0,
      `since=${reconnectTail?.params?.since_id} latestCopies=${caughtEvents} firstCopies=${staleFirstEvent}`);
    check("network", "latest offline journal event is inserted exactly once", caughtEvents === 1,
      `${caughtEvents} rendered copies`);
    check("network", "read-only reconnect emits no mutation RPC",
      server.mutationCalls.length === mutationsBeforeOffline,
      `${server.mutationCalls.length - mutationsBeforeOffline} fixture mutations`);

    // Stream dock is 30px by default, expands to 112px, and persists both states.
    const dockHeight = () => normal.page.locator("#stream-dock").evaluate((el) =>
      el.getBoundingClientRect().height);
    let streamH = await dockHeight();
    check("stream", "collapsed dock is 30px", Math.abs(streamH - 30) <= 2, `${streamH}px`);
    await normal.page.locator("#stream-toggle").click();
    streamH = await dockHeight();
    check("stream", "expanded dock is 112px", Math.abs(streamH - 112) <= 2, `${streamH}px`);
    await normal.page.reload({ waitUntil: "domcontentloaded" });
    await normal.page.waitForFunction(() => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""));
    check("stream", "expanded dock persists across reload",
      await normal.page.locator("#stream-toggle").getAttribute("aria-expanded") === "true" &&
      Math.abs(await dockHeight() - 112) <= 2);
    await normal.page.locator("#stream-toggle").click();
    await normal.page.reload({ waitUntil: "domcontentloaded" });
    await normal.page.waitForFunction(() => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""));
    check("stream", "collapsed dock persists across reload",
      await normal.page.locator("#stream-toggle").getAttribute("aria-expanded") === "false" &&
      Math.abs(await dockHeight() - 30) <= 2);

    // Field remains dirty-flag driven after data and layout settle.
    await normal.page.waitForTimeout(200);
    await normal.page.evaluate(() => {
      const ctx = document.querySelector(".fieldc").getContext("2d");
      const clear = ctx.clearRect.bind(ctx);
      window.__edgeIdleDraws = 0;
      ctx.clearRect = (...args) => { window.__edgeIdleDraws++; return clear(...args); };
    });
    await normal.page.waitForTimeout(1200);
    const idleDraws = await normal.page.evaluate(() => window.__edgeIdleDraws);
    check("performance", "field performs zero draws during 1.2s idle", idleDraws === 0,
      `${idleDraws} clearRect calls`);

    // Semantic tab roles and roving Arrow key focus.
    check("semantics", "left tabs expose tablist/tab/tabpanel roles",
      await normal.page.locator('[role="tablist"] [role="tab"]').count() === 3 &&
      await normal.page.locator('[role="tabpanel"]').count() === 1);
    check("semantics", "header actions are labeled native buttons",
      await normal.page.locator('nav[aria-label="Application actions"] button.header-action').count() === 5 &&
      await normal.page.locator('nav[aria-label="Application actions"] button[aria-label], nav[aria-label="Application actions"] button[title]').count() === 5);
    await normal.page.locator('#tab-entities').focus();
    await normal.page.keyboard.press("ArrowRight");
    check("semantics", "ArrowRight selects and focuses next tab",
      await normal.page.locator('#tab-queue').getAttribute("aria-selected") === "true" &&
      await normal.page.evaluate(() => document.activeElement?.id === "tab-queue"));
    await normal.page.keyboard.press("ArrowLeft");
    check("semantics", "ArrowLeft restores previous tab",
      await normal.page.locator('#tab-entities').getAttribute("aria-selected") === "true" &&
      await normal.page.evaluate(() => document.activeElement?.id === "tab-entities"));

    // Stale async fact.get: the newest selection must own Inspect.
    server.setFixture("stale");
    await normal.page.evaluate(() => window.eyeRefresh());
    await normal.page.waitForFunction(() => document.querySelectorAll(".ent-row").length > 0);
    server.factGetDelays.set(1, 350);
    server.factGetDelays.set(2, 20);
    await normal.page.locator(".ent-row .chev").first().click();
    const facts = normal.page.locator(".ent-fact[data-fid]");
    await facts.nth(0).click();
    await normal.page.waitForTimeout(10);
    await facts.nth(1).click();
    await normal.page.waitForTimeout(450);
    const staleShown = await normal.page.locator(".factid").innerText();
    const staleContent = await normal.page.locator("#ins-content").innerText();
    check("async", "latest selection wins delayed fact.get",
      staleShown === "f#0002" && staleContent.includes("Second latest"),
      `${staleShown}: ${staleContent}`);

    // Alt history shortcuts stay inert in forms, contenteditable surfaces, modals, and popouts.
    const selectedBeforeGuards = await normal.page.locator(".factid").innerText();
    await normal.page.locator("#entfilter").focus();
    await normal.page.keyboard.press("Alt+ArrowLeft");
    await normal.page.evaluate(() => {
      const d = document.createElement("div"); d.id = "edge-editable"; d.contentEditable = "true";
      d.textContent = "synthetic editable"; document.body.appendChild(d); d.focus();
    });
    await normal.page.keyboard.press("Alt+ArrowLeft");
    await normal.page.locator("#edge-editable").evaluate((el) => el.remove());
    await normal.page.locator("#sb-help").click();
    await normal.page.keyboard.press("Alt+ArrowLeft");
    await normal.page.keyboard.press("Escape");
    await normal.page.locator("#spark").click();
    await normal.page.keyboard.press("Alt+ArrowLeft");
    await normal.page.locator("#spark").click();
    check("history", "Alt arrows are guarded in form/editable/modal/popout contexts",
      (await normal.page.locator(".factid").innerText()) === selectedBeforeGuards,
      `selection=${await normal.page.locator(".factid").innerText()}`);

    // Entity and trust scopes clear independently. A removed/re-added probe ignores its stale response.
    server.probePlans = [
      { delay: 350, results: [{ fact_id: 3, score: 0.8, trust_score: 0.8,
        content: "stale structural result" }] },
      { delay: 20, results: [] },
    ];
    await normal.page.locator(".ent-row .nm").first().click();
    await normal.page.waitForSelector('#context-rail [data-entity]');
    await normal.page.locator('#context-rail [data-entity]').click();
    await normal.page.locator(".ent-row .nm").first().click();
    await normal.page.waitForTimeout(450);
    const scopeMath = await normal.page.locator(".mathlog").innerText();
    check("scope", "remove/re-add ignores stale entity probe response",
      scopeMath.includes("0 structurally hot") && !scopeMath.includes("1 structurally hot"),
      scopeMath.replace(/\s+/g, " ").slice(0, 180));
    await normal.page.locator("#spark").click();
    await normal.page.locator('[data-m="above"]').click();
    await normal.page.locator("#spark").click();
    check("scope", "entity and trust contexts coexist",
      await normal.page.locator('#context-rail [data-entity]').count() === 1 &&
      await normal.page.locator('#clear-trust-context').count() === 1);
    await normal.page.locator('#context-rail [data-entity]').click();
    check("scope", "clearing entity preserves trust context",
      await normal.page.locator('#context-rail [data-entity]').count() === 0 &&
      await normal.page.locator('#clear-trust-context').count() === 1);
    await normal.page.locator('#clear-trust-context').click();
    check("scope", "clearing trust hides empty context rail",
      await normal.page.locator("#context-rail").isHidden());

    // Find shortcuts and keyboard-only result choice.
    await normal.page.keyboard.press("F");
    await normal.page.waitForSelector(".find-overlay input");
    check("find", "F opens focused empty search",
      await normal.page.evaluate(() => document.activeElement?.matches(".find-overlay input") &&
        document.querySelector(".find-overlay input").value === ""));
    await normal.page.keyboard.press("Control+f");
    check("find", "repeat Ctrl+F replaces prior overlay and keeps focus",
      await normal.page.locator(".find-overlay").count() === 1 &&
      await normal.page.evaluate(() => document.activeElement?.matches(".find-overlay input")));
    await normal.page.keyboard.type("First stale response");
    await normal.page.waitForSelector(".find-results [data-id]");
    await normal.page.keyboard.press("ArrowDown");
    const activeDescendant = await normal.page.locator(".find-overlay input").getAttribute("aria-activedescendant");
    check("find", "active descendant points to one unique result ID",
      Boolean(activeDescendant) && await normal.page.locator(`#${activeDescendant}`).count() === 1,
      `aria-activedescendant=${activeDescendant}`);
    await normal.page.keyboard.press("Enter");
    await normal.page.waitForTimeout(80);
    const findClosed = await normal.page.locator(".find-overlay").count() === 0;
    const findPicked = (await normal.page.locator(".factid").innerText()) === "f#0001";
    check("find", "ArrowDown and Enter choose a result", findClosed && findPicked,
      `closed=${findClosed} selected=${await normal.page.locator(".factid").innerText()}`);
    if (!findClosed) await normal.page.keyboard.press("Escape");
    await normal.page.keyboard.press("Control+f");
    check("find", "Ctrl+F is intercepted by app", await normal.page.locator(".find-overlay").count() === 1);
    await normal.page.keyboard.press("Escape");
    check("find", "Escape closes find", await normal.page.locator(".find-overlay").count() === 0);

    // Modal Escape, initial focus, focus containment, and return focus.
    await normal.page.locator("#sb-workbench").click();
    await normal.page.waitForSelector(".modal-back");
    const modalAuto = await normal.page.evaluate(() =>
      document.activeElement?.id === "wb-entities");
    check("modal", "workbench gives initial focus to its input", modalAuto,
      `active=${await normal.page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);
    if (!modalAuto) await normal.page.locator("#wb-entities").focus();
    await normal.page.keyboard.press("Shift+Tab");
    const trapped = await normal.page.evaluate(() =>
      Boolean(document.activeElement?.closest?.(".modal-back")));
    check("modal", "Shift+Tab stays inside modal", trapped,
      `active=${await normal.page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName)}`);
    await normal.page.keyboard.press("Escape");
    check("modal", "Escape closes modal", await normal.page.locator(".modal-back").count() === 0);
    check("modal", "close restores trigger focus",
      await normal.page.evaluate(() => document.activeElement?.id === "sb-workbench"),
      `active=${await normal.page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);

    // Every theme, text scale, and supported/edge viewport gets an overflow measurement.
    const themes = ["blossom_dark", "blossom", "amoled", "light", "dark",
      "funky", "paper", "basalt", "amber", "chromacore"];
    const scales = ["0.85", "1", "1.1", "1.25"];
    const viewports = [[640, 480], [1100, 680], [1440, 900], [2200, 1200]];
    const matrix = [];
    for (const theme of themes) {
      await normal.page.locator("#sb-settings").click();
      await normal.page.locator(`.theme-chip[data-th="${theme}"]`).click();
      for (const scale of scales) {
        await normal.page.selectOption("#st-scale", scale);
        await normal.page.keyboard.press("Escape");
        for (const [width, height] of viewports) {
          await normal.page.setViewportSize({ width, height });
          await normal.page.waitForTimeout(20);
          const m = await normal.page.evaluate(() => {
            const html = document.documentElement;
            const sb = document.querySelector(".statusbar").getBoundingClientRect();
            const main = document.querySelector(".main").getBoundingClientRect();
            const garden = document.querySelector(".garden").getBoundingClientRect();
            const stream = document.querySelector(".stream").getBoundingClientRect();
            return { overflowX: Math.max(0, html.scrollWidth - innerWidth),
              statusRight: Math.max(0, sb.right - innerWidth),
              mainRight: Math.max(0, main.right - innerWidth),
              gardenOverlap: Math.max(0, stream.bottom - garden.top) };
          });
          matrix.push({ theme, scale, width, height, ...m });
        }
        await normal.page.setViewportSize({ width: 1440, height: 900 });
        await normal.page.locator("#sb-settings").click();
      }
      await normal.page.keyboard.press("Escape");
    }
    fs.writeFileSync(path.join(ARTIFACTS, "overflow-matrix.json"), JSON.stringify(matrix, null, 2));
    const supported = matrix.filter((m) => m.width >= 1100);
    const bad = supported.filter((m) => m.overflowX > 1 || m.statusRight > 1 ||
      m.mainRight > 1 || m.gardenOverlap > 1);
    const maxOverflow = Math.max(0, ...supported.map((m) => m.overflowX));
    const narrowMax = Math.max(0, ...matrix.filter((m) => m.width < 1100).map((m) => m.overflowX));
    check("layout", "theme × scale × supported viewport matrix has no horizontal overflow",
      bad.length === 0, `${bad.length}/${supported.length} bad; max ${maxOverflow}px; matrix=${path.join(ARTIFACTS, "overflow-matrix.json")}`);
    check("layout", "below-minimum 640px viewport is measured, not claimed supported", true,
      `max observed overflow ${narrowMax}px; native minimum is 1100px`);
    await normal.page.setViewportSize({ width: 1440, height: 900 });

    // Typed-ID guard and duplicate destructive submit, intercepted only by fixture RPC.
    server.setFixture("singleton");
    await normal.page.evaluate(() => window.eyeRefresh());
    await normal.page.waitForTimeout(100);
    await selectFirstViaEntity(normal.page);
    const beforeMutations = server.mutationCalls.length;
    await normal.page.locator("#ins-del").click();
    await normal.page.locator("#del-confirm").fill("999");
    const wrongDisabled = await normal.page.locator("#del-go").isDisabled();
    await normal.page.locator("#del-confirm").press("Enter");
    await normal.page.waitForTimeout(40);
    check("destructive", "wrong typed ID blocks delete",
      wrongDisabled && server.mutationCalls.length === beforeMutations,
      `disabled=${wrongDisabled}; intercepted=${server.mutationCalls.length - beforeMutations}`);
    await normal.page.locator("#del-confirm").fill("1");
    check("destructive", "exact typed ID enables delete", !(await normal.page.locator("#del-go").isDisabled()));
    server.mutationDelayMs = 180;
    await normal.page.locator("#del-go").dispatchEvent("click");
    await normal.page.locator("#del-go").dispatchEvent("click");
    await normal.page.waitForTimeout(450);
    server.mutationDelayMs = 0;
    const removeCalls = server.mutationCalls.slice(beforeMutations)
      .filter((x) => x.method === "fact.remove");
    check("destructive", "duplicate submit emits one fact.remove RPC", removeCalls.length === 1,
      `${removeCalls.length} intercepted synthetic calls`);
    check("destructive", "all mutation RPCs stayed synthetic",
      server.mutationCalls.every((x) => x.params && typeof x.method === "string"),
      `${server.mutationCalls.length} total fixture mutations; server=${server.url}`);

    // Fifty-entry selection history, multi-selection replay, and forward-branch truncation.
    const history = await bootPage(browser, server, "history");
    await history.page.locator(".ent-row .chev").click();
    await history.page.waitForSelector(".ent-fact[data-fid]");
    await history.page.evaluate(() => {
      const rows = [...document.querySelectorAll(".ent-fact[data-fid]")];
      for (const row of rows.slice(0, 55)) row.click();
    });
    await history.page.waitForFunction(() => document.querySelector(".factid")?.textContent === "f#0055");
    await history.page.locator("#inspect-back").click();
    check("history", "Back restores previous selection",
      (await history.page.locator(".factid").innerText()) === "f#0054");
    await history.page.locator("#inspect-forward").click();
    check("history", "Forward restores newer selection",
      (await history.page.locator(".factid").innerText()) === "f#0055");
    let capBackMoves = 0;
    while (capBackMoves < 60 && !(await history.page.locator("#inspect-back").isDisabled())) {
      await history.page.locator("#inspect-back").click();
      capBackMoves++;
    }
    const cappedEarliest = await history.page.locator(".factid").innerText();
    check("history", "selection history retains only the newest 50 entries",
      cappedEarliest === "f#0006" && capBackMoves === 49,
      `${capBackMoves} back moves; earliest=${cappedEarliest}`);
    while (!(await history.page.locator("#inspect-forward").isDisabled())) {
      await history.page.locator("#inspect-forward").click();
    }
    server.fixture.facts = server.fixture.facts.filter((f) => f.fact_id !== 54);
    server.fixture.stats = statsFor(server.fixture.facts, server.fixture.entities);
    await history.page.evaluate(() => window.eyeRefresh());
    await history.page.locator("#inspect-back").click();
    check("history", "Back skips an ID deleted from the new projection",
      (await history.page.locator(".factid").innerText()) === "f#0053");
    await history.page.locator("#inspect-forward").click();
    check("history", "Forward also skips the deleted ID",
      (await history.page.locator(".factid").innerText()) === "f#0055");
    await history.page.locator("#tab-contra").click();
    await history.page.waitForSelector(".c-row");
    await history.page.locator(".c-row").click();
    check("history", "history records and renders multi-selection",
      (await history.page.locator(".factid").innerText()) === "2 facts selected");
    await history.page.locator("#inspect-back").click();
    check("history", "Back from multi-selection restores singleton",
      (await history.page.locator(".factid").innerText()) === "f#0055");
    await history.page.locator("#inspect-forward").click();
    check("history", "Forward restores multi-selection",
      (await history.page.locator(".factid").innerText()) === "2 facts selected");
    await history.page.locator("#inspect-back").click();
    await history.page.locator("#tab-entities").click();
    await history.page.locator('.ent-fact[data-fid="57"]').click();
    check("history", "new selection truncates forward branch",
      await history.page.locator("#inspect-forward").isDisabled());
    check("history", "history fixture has no runtime errors", history.errors.length === 0,
      history.errors.slice(0, 2).join(" | "));
    await history.context.close();

    // Synthetic-only visual receipt: richer data, one selected fact, expanded Stream.
    const hero = await bootPage(browser, server, "hero");
    await selectFirstViaEntity(hero.page);
    await hero.page.locator("#stream-toggle").click();
    await hero.page.waitForTimeout(200);
    const heroPath = path.join(ARTIFACTS, "hero-selected-stream-expanded-synthetic.png");
    await hero.page.screenshot({ path: heroPath });
    check("receipt", "hero screenshot has one selected fact and expanded Stream",
      (await hero.page.locator(".factid").innerText()) === "f#0001" &&
      await hero.page.locator("#stream-toggle").getAttribute("aria-expanded") === "true",
      heroPath);
    check("receipt", "hero fixture has no runtime errors", hero.errors.length === 0,
      hero.errors.slice(0, 2).join(" | "));
    await hero.context.close();

    const unexpectedNormalErrors = normal.errors.filter((e) =>
      !/WebSocket connection.*synthetic-fixture-token.*HTTP Authentication failed/i.test(e));
    check("runtime", "normal scenario has no unexpected page errors",
      unexpectedNormalErrors.length === 0, unexpectedNormalErrors.slice(0, 4).join(" | "));
    await normal.context.close();
  } catch (error) {
    check("harness", "all GUI scenarios complete", false, error.stack || String(error));
    if (browser) {
      for (const [index, page] of browser.contexts().flatMap((c) => c.pages()).entries()) {
        await page.screenshot({ path: path.join(ARTIFACTS, `failure-${index}.png`) }).catch(() => {});
      }
    }
  } finally {
    try { if (browser) await browser.close(); }
    finally { await server.stop(); }
  }

  const failed = results.filter((r) => !r.ok);
  const report = { status: failed.length ? "fail" : "pass", fixtureOnly: true,
    livePort8770Used: false, browser: BROWSER, artifacts: ARTIFACTS,
    totals: { checks: results.length, passed: results.length - failed.length, failed: failed.length },
    failures: failed, results };
  fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.totals.passed}/${report.totals.checks} passed; ${failed.length} failed`);
  console.log(`Report: ${path.join(ARTIFACTS, "report.json")}`);
  process.exitCode = failed.length ? 1 : 0;
}

run().catch((error) => {
  console.error(`HARNESS BLOCKED: ${error.stack || error}`);
  console.error("Fix: build the frontend, install build/verify dependencies, and ensure headless Thorium exists.");
  process.exitCode = 2;
});
