#!/usr/bin/env node
"use strict";

/* Fixture definitions copied from gui_edge.cjs without its executable test runner.
   Deterministic frontend responsive harness for the Holographic Eye.
   It serves built assets and synthetic memory fixtures on an ephemeral
   loopback port. It never reads ~/.hermes, :8770, or a real token/database. */

const { chromium } = require("playwright-core");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const ROOT = path.resolve(process.env.EYE_UI_ASSETS || path.join(__dirname, "../eye_frontend/dist"));
const TOKEN = "synthetic-fixture-token";
const BROWSER = process.env.EYE_BROWSER || "/usr/bin/thorium-browser";
const ARTIFACTS = path.resolve(process.env.EYE_UI_ARTIFACTS || path.join(__dirname, "shots/next-ui/current"));
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
      const found=f.facts.find((x) => x.fact_id === Number(params.fact_id));
      return { fact: found ? detailedFact(found) : null };
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
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack || e.message}`));
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


const THEMES = ["blossom_dark", "blossom", "amoled", "light", "dark", "funky", "paper", "basalt", "amber", "chromacore"];
const SCALES = ["0.85", "1", "1.1", "1.25"];
const VIEWPORTS = [[640,480], [800,480], [1100,480], [1440,480], [1440,900]];

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
    const selectors = [".statusbar", ".main", "#pane-left", "#field-wrap", "#pane-inspect", "#stream-dock", ".garden", "#sb-settings", "#sb-help", "#explorer", "#fact-browser", "#explorer-tabs", "#pane-switcher"];
    const boxes = Object.fromEntries(selectors.map(s => [s, rect(document.querySelector(s))]));
    const clippedControls = [...document.querySelectorAll('.statusbar button')].filter(el => {
      const r=el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth+1 || r.top < -1 || r.bottom > innerHeight+1;
    }).map(el => el.id);
    const activePanel = document.querySelector('#fact-browser:not([hidden])') || document.querySelector('#field-wrap');
    const panelOverflow = Math.max(0, activePanel.scrollWidth-activePanel.clientWidth);
    const expectedMainHeight = innerHeight-boxes['.statusbar'].height-boxes['#pane-switcher'].height-boxes['.garden'].height-(document.querySelector('#stream-toggle').getAttribute('aria-expanded')==='true'?112:30);
    const mainHeightLoss = Math.max(0,expectedMainHeight-boxes['.main'].height);
    const initialDataVisible = [...document.querySelectorAll('#browser-directory [data-category-key],#browser-directory [data-time-branch],#browser-facts [data-fact-id]')].some(el=>{
      const r=el.getBoundingClientRect(), host=document.querySelector('#fact-browser').getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return r.width>0&&r.height>0&&r.top>=host.top&&r.bottom<=Math.min(innerHeight,host.bottom)&&Boolean(hit&&(hit===el||el.contains(hit)));
    });
    const focusVisible = !(document.activeElement?.closest('[hidden], [inert]'));
    return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,boxes,clippedControls,panelOverflow,focusVisible,mainHeightLoss,initialDataVisible,layout:document.querySelector('.app').dataset.layout,pane:document.querySelector('.app').dataset.pane};
  });
}

async function dialogMetrics(page) {
  return page.evaluate(() => {
    const modal=document.querySelector('.modal'), title=document.querySelector('.m-title'), close=document.querySelector('.m-close'), body=document.querySelector('.m-body');
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const m=rect(modal),t=rect(title),c=rect(close);
    const at=document.elementFromPoint(c.left+c.width/2,c.top+c.height/2);
    return {modal:m,title:t,close:c,body:rect(body),modalScroll:modal.scrollTop,bodyScroll:body.scrollTop,
      titleVisible:t.top>=m.top-1&&t.bottom<=m.bottom+1&&t.left>=0&&t.right<=innerWidth,
      closeVisible:c.top>=m.top-1&&c.bottom<=m.bottom+1&&c.left>=0&&c.right<=innerWidth&&Boolean(at?.closest('.m-close')),
      overflowX:modal.scrollWidth-modal.clientWidth};
  });
}


async function exerciseViews(page,server) {
  const custom = [
    fact(9001,'UTC offset boundary sentinel', {category:'Exact CAT',created_at:'2026-01-01T00:30:00+01:00',updated_at:'2026-03-02 04:05:06.123456',entities:[]}),
    fact(9002,'Invalid Gregorian day sentinel', {category:'exact cat',created_at:'2026-02-30T03:04:05Z',updated_at:null,entities:[]}),
    fact(9003,'Blank category sentinel',{category:'',created_at:'2026-01-02T03:04:05Z',entities:[]}),
    fact(9004,HOSTILE,{category:'<img id="category-xss" src=x onerror="window.__xss=1">',created_at:'<img id="timestamp-xss" src=x onerror="window.__timestampXss=1">',entities:[]}),
    fact(9005,'Naive UTC sentinel',{category:'Exact CAT',created_at:'2026-01-02 03:04:05',updated_at:'2026-04-01T00:00:00Z',entities:[]}),
    fact(9006,'Missing category sentinel',{category:undefined,created_at:null,updated_at:'2026-04-01T00:00:00Z',entities:[]}),
  ];
  const rows=Array.from({length:220},(_,i)=>fact(i+1,`Pagination memory ${i+1}`,{category:`Directory ${String(i).padStart(3,'0')}`,entities:[]}));
  server.fixture={name:'responsive-views',facts:[...custom,...rows],entities:[],events:[]};
  server.fixture.stats=statsFor(server.fixture.facts,[]);
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.eyeRefresh());
  await page.locator('#explorer-tabs [data-view="categories"]').click();
  await page.waitForSelector('#browser-query');
  if(await page.locator('#browser-filters-toggle').getAttribute('aria-expanded')==='false') await page.locator('#browser-filters-toggle').click();
  const facts=()=>page.locator('#browser-facts [data-fact-id]');
  const group=()=>page.locator('#browser-directory [data-category-key]');
  check('browser','directories and facts are bounded at100',await group().count()===100&&await facts().count()===100,`groups=${await group().count()} facts=${await facts().count()}`);
  check('semantics','Categories fact rows name the Stored date axis',(await facts().first().innerText()).includes('Stored'));
  await page.locator('#explorer-tabs [data-view="timeline"]').click();await page.selectOption('#browser-axis','updated_at');
  await page.locator('#explorer-tabs [data-view="categories"]').click();
  check('semantics','Categories fact rows name the Last updated date axis',(await facts().first().innerText()).includes('Last updated'));
  await page.locator('#explorer-tabs [data-view="timeline"]').click();await page.selectOption('#browser-axis','created_at');
  await page.locator('#explorer-tabs [data-view="categories"]').click();
  const firstPage=await facts().first().getAttribute('data-fact-id');
  await page.locator('#browser-facts-next').click();
  check('browser','fact next page changes IDs and stays bounded',await facts().first().getAttribute('data-fact-id')!==firstPage&&await facts().count()<=100);
  await page.locator('#browser-directory-next').click();
  check('browser','directory next page stays bounded',await group().count()<=100);
  if(await page.locator('#browser-clear-all').isVisible()) await page.locator('#browser-clear-all').click();
  await page.locator('#browser-query').fill('utc OFFSET boundary');
  await page.waitForFunction(()=>document.querySelectorAll('#browser-facts [data-fact-id]').length===1);
  check('browser','query is case-insensitive content substring',await facts().first().getAttribute('data-fact-id')==='9001');
  await page.locator('#browser-query').focus();
  await page.evaluate(()=>window.eyeRefresh());
  check('browser','refresh preserves query and focus',await page.locator('#browser-query').inputValue()==='utc OFFSET boundary'&&await page.evaluate(()=>document.activeElement?.id==='browser-query'));
  if(await page.locator('#browser-clear-all').isVisible()) await page.locator('#browser-clear-all').click();
  await page.locator('#browser-category').fill('Exact CAT');
  await page.locator('#browser-category-apply').click();
  const exactIds=await facts().evaluateAll(els=>els.map(el=>el.dataset.factId).sort());
  check('browser','category is exact and case-sensitive',JSON.stringify(exactIds)===JSON.stringify(['9001','9005']),JSON.stringify(exactIds));
  await page.locator('#browser-query').fill('Naive');
  check('browser','category and content filters compose with AND',await facts().count()===1&&await facts().first().getAttribute('data-fact-id')==='9005');
  await page.locator('#explorer-tabs [data-view="timeline"]').click();
  check('browser','view switch preserves active facets',await page.locator('#browser-query').inputValue()==='Naive'&&await facts().count()===1);
  if(await page.locator('#browser-clear-all').isVisible()) await page.locator('#browser-clear-all').click();
  await page.selectOption('#browser-axis','created_at');
  // The offset timestamp belongs to UTC 2025, not its written local year 2026.
  const branches=()=>page.locator('#browser-directory [data-time-branch]');
  const branch2025=branches().filter({hasText:/2025/});
  await branch2025.click();
  check('timeline','Stored UTC year includes offset boundary fact',await facts().count()===1&&await facts().first().getAttribute('data-fact-id')==='9001');
  await page.locator('#browser-clear-time').click();
  await branches().filter({hasText:/Unknown/i}).click();
  const unknownIds=await facts().evaluateAll(els=>els.map(el=>el.dataset.factId).sort());
  check('timeline','invalid and absent timestamps enter Unknown',JSON.stringify(unknownIds)===JSON.stringify(['9002','9004','9006']),JSON.stringify(unknownIds));
  await page.locator('#browser-clear-time').click();
  await page.selectOption('#browser-axis','updated_at');
  await page.locator('#browser-query').fill('9001');
  check('timeline','ID substring query finds boundary fact',await facts().count()===1&&await facts().first().getAttribute('data-fact-id')==='9001');
  await branches().filter({hasText:/2026/}).click();
  check('timeline','Last updated uses updated_at, not creation year',await facts().count()===1);
  if(await page.locator('#browser-clear-all').isVisible()) await page.locator('#browser-clear-all').click();
  await page.locator('#browser-query').fill('雪');
  check('browser','hostile content remains text',await facts().count()===1&&(await facts().innerText()).includes('<img')&&await page.locator('#xss-probe,#category-xss').count()===0&&!await page.evaluate(()=>window.__xss));
  await facts().first().click();
  await page.waitForSelector('#ins-content');
  check('content','HTML-like invalid timestamp stays literal in Inspect',(await page.locator('#pane-inspect').innerText()).includes('<img id="timestamp-xss"')&&await page.locator('#timestamp-xss').count()===0&&!await page.evaluate(()=>window.__timestampXss));
  if(await page.locator('#browser-clear-all').isVisible()) await page.locator('#browser-clear-all').click();
  await page.locator('#fact-browser').evaluate(el=>el.scrollTop=320);
  const browserScroll=await page.locator('#fact-browser').evaluate(el=>el.scrollTop);
  await page.locator('#explorer-tabs [data-view="field"]').click();
  await page.locator('#explorer-tabs [data-view="timeline"]').click();
  check('browser','Field roundtrip preserves browser scroll',browserScroll>0&&Math.abs(await page.locator('#fact-browser').evaluate(el=>el.scrollTop)-browserScroll)<=1);
  await page.locator('#browser-query').fill('9001');
  await page.setViewportSize({width:640,height:480});
  await page.locator('#pane-switcher [data-pane="explore"]').click();
  await facts().first().click();
  check('panes','compact selection leaves Explore active',await page.locator('.app').getAttribute('data-pane')==='explore');
  await page.locator('#pane-switcher [data-pane="inspect"]').click();
  await page.waitForSelector('#ins-content');
  check('panes','browser selection uses shared Inspect', (await page.locator('#ins-content').innerText()).includes('UTC offset boundary'));
  await page.locator('#pane-switcher [data-pane="evidence"]').click();
  check('panes','Evidence is reachable in compact mode',await page.locator('#pane-left').isVisible()&&await page.evaluate(()=>!document.activeElement?.closest('[hidden],[inert]')));
  await page.locator('#entfilter').fill('Synthetic');
  await page.locator('#entfilter').evaluate(el=>el.setSelectionRange(2,5));
  await page.evaluate(()=>window.eyeRefresh());
  const caret=await page.locator('#entfilter').evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd,focused:document.activeElement===el}));
  check('panes','Evidence filter and caret survive refresh',caret.value==='Synthetic'&&caret.start===2&&caret.end===5&&caret.focused,JSON.stringify(caret));
  await page.setViewportSize({width:1440,height:900});
  await page.setViewportSize({width:800,height:480});
  check('panes','resize preserves pane that owns focus',await page.locator('.app').getAttribute('data-pane')==='evidence'&&await page.evaluate(()=>document.activeElement?.id==='entfilter'));
  await page.locator('#pane-switcher [data-pane="explore"]').click();
  await page.setViewportSize({width:1440,height:900});
  // Positive label proof uses known sparse space, separate from the browser fixture's outliers.
  server.fixture.facts=Array.from({length:9},(_,i)=>fact(i+1,`Sparse content memory ${i+1}`,{x:(i%3-1)*150,y:(Math.floor(i/3)-1)*150,entities:[]}));
  server.fixture.stats=statsFor(server.fixture.facts,[]);
  await page.evaluate(()=>window.eyeRefresh());
  await page.locator('#explorer-tabs [data-view="field"]').click();
  await page.locator('#field-fit').click();
  if(await page.locator('#field-text-mode').getAttribute('aria-pressed')!=='true') await page.locator('#field-text-mode').click();
  const zoomSteps=[];
  for(let step=0;step<12;step++) {
    await page.locator('#field-zoom-in').click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const status=await page.evaluate(()=>window.eyeField.labelStatus());
    zoomSteps.push(status);
    if(status.accepted>0)break;
  }
  fs.writeFileSync(path.join(ARTIFACTS,'labels-zoom-steps.json'),JSON.stringify(zoomSteps,null,2));
  const labels=await page.evaluate(()=>window.eyeField.labelStatus());
  const sparseLayout=await layoutMetrics(page);
  check('responsive','sparse Field keeps the available vertical budget',sparseLayout.mainHeightLoss<=2,JSON.stringify(sparseLayout));
  fs.writeFileSync(path.join(ARTIFACTS,'labels-zoom.json'),JSON.stringify(labels,null,2));
  check('labels','zoom reveals bounded content labels',labels.accepted>0&&labels.accepted<=48&&labels.measured<=256,JSON.stringify(labels));
  check('labels','labels contain content, not ID-only captions',labels.labels.some(l=>l.lines.join(' ').includes('Sparse')),JSON.stringify(labels.labels.slice(0,4)));
  const overlap=labels.labels.some((a,i)=>labels.labels.slice(i+1).some(b=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y));
  check('labels','accepted label rectangles do not overlap',!overlap);
  await page.screenshot({path:path.join(ARTIFACTS,'field-zoom-content.png'),timeout:5000});
  const camera=()=>page.evaluate(()=>({scale:window.eyeField.scale,cx:window.eyeField.cx,cy:window.eyeField.cy}));
  const beforeCamera=await camera();
  await page.locator('#field-text-mode').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const off=await page.evaluate(()=>window.eyeField.labelStatus());
  check('labels','Text off clears labels without moving camera',off.mode==='off'&&off.accepted===0&&JSON.stringify(await camera())===JSON.stringify(beforeCamera));
  await page.locator('#field-text-mode').click();
  await page.locator('#explorer-tabs [data-view="categories"]').click();
  const hiddenBefore=await page.evaluate(()=>window.eyeField.labelStatus());
  await page.evaluate(()=>{window.eyeField.requestDraw();window.eyeField.invalidateLabels();});
  // This fixed observation interval tests inactivity, not readiness.
  await page.waitForTimeout(200);
  const hiddenAfter=await page.evaluate(()=>window.eyeField.labelStatus());
  check('labels','hidden Field stays inactive without layout rebuild',!hiddenAfter.active&&hiddenAfter.rebuilds===hiddenBefore.rebuilds);
  await page.locator('#explorer-tabs [data-view="timeline"]').click();
  await page.locator('#explorer-tabs [data-view="field"]').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  check('labels','view roundtrip preserves camera',JSON.stringify(await camera())===JSON.stringify(beforeCamera));
  const idleBefore=await page.evaluate(()=>window.eyeField.labelStatus().rebuilds);
  const idleKeyBefore=await page.evaluate(()=>window.eyeField.labels.key);
  await page.waitForTimeout(250);
  const idleAfter=await page.evaluate(()=>window.eyeField.labelStatus().rebuilds);
  check('labels','visible idle Field does not rebuild labels',idleAfter===idleBefore,JSON.stringify({before:idleBefore,after:idleAfter,keyBefore:idleKeyBefore,keyAfter:await page.evaluate(()=>window.eyeField.labels.key)}));
  server.fixture.facts=Array.from({length:500},(_,i)=>fact(i+1,`Dense coincident memory ${i+1}`,{x:0,y:0,entities:[]}));
  server.fixture.stats=statsFor(server.fixture.facts,[]);
  await page.evaluate(()=>window.eyeRefresh());
  await page.locator('#field-fit').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const dense=await page.evaluate(()=>window.eyeField.labelStatus());
  const denseOverlap=dense.labels.some((a,i)=>dense.labels.slice(i+1).some(b=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y));
  check('labels','dense coincident facts omit captions rather than collide',dense.accepted<500&&dense.accepted<=48&&dense.measured<=256&&!denseOverlap,JSON.stringify(dense));
  fs.writeFileSync(path.join(ARTIFACTS,'labels-dense.json'),JSON.stringify(dense,null,2));
  await page.screenshot({path:path.join(ARTIFACTS,'field-dense-omission.png'),timeout:5000});
  await page.locator('#field-fit').focus();
  await page.keyboard.press('Control+f');
  check('keyboard','Ctrl+F from a toolbar button opens focused Find',await page.locator('.find-overlay input').count()===1&&await page.evaluate(()=>document.activeElement?.matches('.find-overlay input')));
  await page.keyboard.press('Escape');
  check('keyboard','Escape closes toolbar-opened Find',await page.locator('.find-overlay').count()===0);
}


async function exerciseHiddenBoot(browser,server) {
  for(const view of ['categories','timeline']) {
    server.fixture={name:'hidden-boot',facts:Array.from({length:9},(_,i)=>fact(i+1,`Hidden boot memory ${i+1}`,{x:1000+(i%3-1)*100,y:2000+(Math.floor(i/3)-1)*100,entities:[]})),entities:[],events:[]};
    server.fixture.stats=statsFor(server.fixture.facts,[]);
    const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    try {
      context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);
      await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(server.url).origin?route.continue():route.abort());
      const page=await context.newPage();const errors=pageLog(page);
      await page.addInitScript(({view,token})=>{localStorage.setItem('eyeToken',token);localStorage.setItem('eyeExploreView',view);},{view,token:TOKEN});
      await page.goto(server.url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#sb-metrics')?.textContent?.includes('9 facts'));
      check('hidden-boot',`${view}: saved view loads with Field inactive`,await page.locator(`#explorer-tabs [data-view="${view}"]`).getAttribute('aria-selected')==='true'&&!await page.evaluate(()=>window.eyeField.labelStatus().active));
      await page.locator('#explorer-tabs [data-view="field"]').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const state=await page.evaluate(()=>({cx:window.eyeField.cx,cy:window.eyeField.cy,scale:window.eyeField.scale,status:window.eyeField.labelStatus()}));
      check('hidden-boot',`${view}: first Field activation fits loaded data`,Math.abs(state.cx-1000)<1&&Math.abs(state.cy-2000)<1&&state.scale!==1&&state.status.visible===9,JSON.stringify(state));
      await page.locator('#field-zoom-in').click();
      const zoomed=await page.evaluate(()=>({cx:window.eyeField.cx,cy:window.eyeField.cy,scale:window.eyeField.scale}));
      await page.locator(`#explorer-tabs [data-view="${view}"]`).click();await page.locator('#explorer-tabs [data-view="field"]').click();
      const returned=await page.evaluate(()=>({cx:window.eyeField.cx,cy:window.eyeField.cy,scale:window.eyeField.scale}));
      check('hidden-boot',`${view}: later activation preserves zoom`,JSON.stringify(returned)===JSON.stringify(zoomed));
      check('hidden-boot',`${view}: no runtime errors`,errors.length===0,errors.join(' | '));
      await page.screenshot({path:path.join(ARTIFACTS,`hidden-boot-${view}.png`),timeout:5000});
    } finally {await context.close();}
  }
}


async function exercisePaneMatrix(page) {
  await page.setViewportSize({width:1440,height:900});
  if(await page.locator('#pane-switcher').isVisible()) await page.locator('#pane-switcher [data-pane="evidence"]').click();
  await selectFirstViaEntity(page);
  await page.setViewportSize({width:2200,height:900});
  await page.locator('#sb-settings').click();await page.selectOption('#st-scale','1.25');await page.keyboard.press('Escape');
  await page.evaluate(()=>{
    window.__resizeBeforePaint=new Promise(resolve=>{
      const onResize=()=>{clearTimeout(timer);resolve({layout:document.querySelector('.app').dataset.layout,overflow:document.documentElement.scrollWidth-innerWidth,viewport:innerWidth});};
      const timer=setTimeout(()=>{removeEventListener('resize',onResize);resolve({error:'resize event missing within2s'});},2000);
      addEventListener('resize',onResize,{once:true});
    });
  });
  await page.setViewportSize({width:640,height:480});
  const beforePaint=await page.evaluate(()=>window.__resizeBeforePaint);
  check('resize','selected Inspect compacts during resize event before paint',beforePaint.layout==='compact'&&beforePaint.overflow<=1&&beforePaint.viewport===640,JSON.stringify(beforePaint));
  const measurements=[];
  for(const theme of THEMES) for(const scale of SCALES) {
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#sb-settings').click();
    await page.locator(`.theme-chip[data-th="${theme}"]`).click();
    await page.selectOption('#st-scale',scale);await page.keyboard.press('Escape');
    for(const width of [640,800,1100,1440]) {
      await page.setViewportSize({width,height:480});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      for(const pane of ['evidence','inspect']) {
        if(await page.locator('#pane-switcher').isVisible()) await page.locator(`#pane-switcher [data-pane="${pane}"]`).click();
        const m=await page.evaluate(pane=>{
          const el=document.querySelector(pane==='evidence'?'#pane-left':'#pane-inspect'),r=el.getBoundingClientRect();
          return {viewport:innerWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,panelOverflow:el.scrollWidth-el.clientWidth,left:r.left,right:r.right,width:r.width,height:r.height,focusVisible:!document.activeElement?.closest('[hidden],[inert]')};
        },pane);
        measurements.push({theme,scale,pane,width,...m});
        check('pane-matrix',`${theme} ${scale} ${width} ${pane}: content fits`,m.documentOverflow<=1&&m.panelOverflow<=1&&m.left>=-1&&m.right<=width+1&&m.height>100&&m.focusVisible,JSON.stringify(m));
        if(theme==='blossom_dark'&&scale==='1.25'&&width<=800) await page.screenshot({path:path.join(ARTIFACTS,`pane-${pane}-${width}-${scale}.png`),timeout:5000});
      }
    }
  }
  fs.writeFileSync(path.join(ARTIFACTS,'pane-matrix.json'),JSON.stringify(measurements,null,2));
  await page.setViewportSize({width:1440,height:900});
  if(await page.locator('#pane-switcher').isVisible()) await page.locator('#pane-switcher [data-pane="explore"]').click();
}

async function run() {
  fs.mkdirSync(ARTIFACTS,{recursive:true});
  const server=new FixtureServer(); let browser;
  const matrix=[], dialogs=[];
  try {
    await server.start();
    if(server.port===8770) throw new Error('Reserved live port selected; stop and rerun');
    browser=await chromium.launch({executablePath:BROWSER,headless:true,timeout:15000,args:["--no-sandbox","--disable-gpu","--disable-background-networking"],env:{...process.env,DISPLAY:"",WAYLAND_DISPLAY:"",WAYLAND_SOCKET:""}});
    browser.on('disconnected',()=>{});
    server.setFixture('hero');
    const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    try {
      context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);
      await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(server.url).origin?route.continue():route.abort());
      const page=await context.newPage();const errors=pageLog(page);await seedToken(page);
      await page.goto(server.url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#sb-metrics')?.textContent?.includes('140 facts'));
      check('semantics','Field panel exposes tabpanel role and active-tab label',await page.locator('#field-wrap').getAttribute('role')==='tabpanel'&&await page.locator('#field-wrap').getAttribute('aria-labelledby')==='view-field');
      for(const theme of (process.env.EYE_UI_FOCUSED || process.env.EYE_UI_PANES_ONLY ? [] : process.env.EYE_UI_QUICK ? ["blossom_dark"] : THEMES)) for(const scale of SCALES) {
        await page.setViewportSize({width:1440,height:900});
        await page.locator('#sb-settings').click();
        await page.locator(`.theme-chip[data-th="${theme}"]`).click();
        await page.selectOption('#st-scale',scale);await page.keyboard.press('Escape');
        for(const [width,height] of (process.env.EYE_UI_FOCUSED ? [] : VIEWPORTS)) {
          await page.setViewportSize({width,height});
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          if(await page.locator('#pane-switcher').isVisible()) await page.locator('#pane-switcher [data-pane="explore"]').click();
          for(const view of ['field','categories','timeline']) {
            await page.locator(`#explorer-tabs [data-view="${view}"]`).click();
            const m=await layoutMetrics(page);matrix.push({theme,scale,view,...m});
            check('responsive',`${theme} ${scale} ${width}×${height} ${view}: actions and panels fit`,
              m.clippedControls.length===0&&m.boxes['.main'].right<=width+1&&m.boxes['#explorer'].width>=180&&m.panelOverflow<=1&&m.focusVisible&&m.mainHeightLoss<=2&&(view==='field'||m.initialDataVisible),
              JSON.stringify({clipped:m.clippedControls,mainRight:m.boxes['.main'].right,panelOverflow:m.panelOverflow,focusVisible:m.focusVisible,mainHeightLoss:m.mainHeightLoss,initialDataVisible:m.initialDataVisible}));
            if(theme==='blossom_dark'&&(scale==='1'||scale==='1.25')) await page.screenshot({path:path.join(ARTIFACTS,`layout-${width}-${height}-${scale}-${view}.png`),timeout:5000});
          }
        }
      }
      if(!process.env.EYE_UI_FOCUSED&&!process.env.EYE_UI_QUICK) await exercisePaneMatrix(page);
      if(!process.env.EYE_UI_QUICK&&!process.env.EYE_UI_PANES_ONLY) {
      // Use the real Manual dialog. Its body exceeds the viewport without injected content.
      for(const [width,height] of (process.env.EYE_UI_FOCUSED ? [] : VIEWPORTS)) {
        await page.setViewportSize({width:1440,height:900});
        await page.locator('#sb-help').click();
        await page.setViewportSize({width,height});
        const before=await dialogMetrics(page);
        await page.locator('.m-body').evaluate(el=>{el.scrollTop=el.scrollHeight;el.parentElement.scrollTop=el.parentElement.scrollHeight;});
        const after=await dialogMetrics(page);dialogs.push({width,height,kind:'manual-scroll',before,after});
        check('dialog',`${width}: title and close stay visible after body scroll`,after.titleVisible&&after.closeVisible&&Math.abs(before.title.top-after.title.top)<=1&&after.bodyScroll>0,JSON.stringify(after));
        check('dialog',`${width}: dialog fits with 12px edge clearance`,after.modal.left>=11&&after.modal.right<=width-11&&after.modal.top>=11&&after.modal.bottom<=height-11&&after.overflowX<=1,JSON.stringify(after.modal));
        await page.screenshot({path:path.join(ARTIFACTS,`manual-scrolled-${width}-${height}.png`),timeout:5000});
        await page.keyboard.press('Escape');
        check('dialog',`${width}: Escape closes and restores focus`,await page.locator('.modal-back').count()===0&&await page.evaluate(()=>document.activeElement?.id==='sb-help'));
      }
      // Exercise the common real modal with a pathological synthetic title, preserving its close node.
      await page.setViewportSize({width:1440,height:900});await page.locator('#sb-workbench').click();
      await page.locator('.m-title').evaluate(el=>{
        const label=el.querySelector('.m-title-text');
        const long='SyntheticLongTitleWithoutBreaks'.repeat(14);
        if(label)label.textContent=long;
        else for(const n of el.childNodes)if(n.nodeType===Node.TEXT_NODE){n.textContent=long;break;}
      });
      await page.setViewportSize({width:640,height:480});
      const long=await dialogMetrics(page);dialogs.push({width:640,height:480,kind:'synthetic-long-title',...long});
      check('dialog','640: long title does not push close outside viewport',long.closeVisible&&long.overflowX<=1,JSON.stringify(long));
      await page.screenshot({path:path.join(ARTIFACTS,'dialog-long-title-640.png'),timeout:5000});
      await page.keyboard.press('Escape');
      await exerciseViews(page,server);
      check('runtime','no page errors',errors.length===0,errors.join(' | '));
      check('safety','no mutation calls',server.mutationCalls.length===0);
      }
    } finally {await context.close();}
    if(!process.env.EYE_UI_QUICK&&!process.env.EYE_UI_PANES_ONLY) await exerciseHiddenBoot(browser,server);
  } catch(error) {check('harness','scenarios finish',false,error.stack||String(error));}
  finally {try {if(browser)await browser.close();} finally {await server.stop();}}
  const failures=results.filter(r=>!r.ok);
  const report={status:failures.length?'fail':'pass',fixtureOnly:true,livePort8770Used:false,nativeTitlebarCoverage:false,assetRoot:ROOT,artifacts:ARTIFACTS,totals:{checks:results.length,failed:failures.length},results,matrix,dialogs};
  fs.writeFileSync(path.join(ARTIFACTS,'report.json'),JSON.stringify(report,null,2));
  console.log(`Report: ${path.join(ARTIFACTS,'report.json')}`);
  process.exitCode=failures.length?1:0;
  return report;
}
module.exports={FixtureServer,fact,entity,statsFor,layoutMetrics,dialogMetrics,THEMES,SCALES,VIEWPORTS,run};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=2;});
