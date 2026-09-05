#!/usr/bin/env node
"use strict";

// Run the actual bundled transport in a private VM. fetch never opens a socket.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildSync } = require("../eye_frontend/node_modules/esbuild");
const ARTIFACTS = path.resolve(process.env.EYE_TRANSPORT_ARTIFACTS ||
  path.join(__dirname, "shots", "transport", `run-${process.pid}`));
fs.mkdirSync(ARTIFACTS, { recursive: true });
const bundle = buildSync({ entryPoints: [process.env.EYE_TRANSPORT_API || path.join(__dirname, "../eye_frontend/src/api.ts")],
  bundle: true, platform: "browser", format: "iife", globalName: "transport", write: false,
  target: "es2022" }).outputFiles[0].text;
const results = [];
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}: ${JSON.stringify(detail)}`);
}
function client(response, opts = {}) {
  const calls = [];
  const tokens = new Map(opts.stored ? [["eyeToken", opts.stored]] : []);
  let prompts = 0;
  const denied = () => { throw new DOMException("synthetic storage denied", "SecurityError"); };
  const storage = { getItem: opts.denyRead ? denied : (k) => tokens.get(k) ?? null,
    setItem: opts.denyWrite ? denied : (k, v) => tokens.set(k, v),
    removeItem: opts.denyRemove ? denied : (k) => tokens.delete(k) };
  const context = vm.createContext({ URL, Headers, Response, TextDecoder, DOMException,
    AbortController, console, setTimeout, clearTimeout,
    location: { href: opts.url || "http://fixture.invalid/?token=synthetic-fixture-token", reload() {} },
    history: { replaceState() {} }, localStorage: storage,
    prompt: () => { prompts++; return "synthetic-fixture-token"; },
    fetch: async (url, init) => {
      calls.push({ url, authorization: init.headers.get("Authorization"), body: init.body });
      const value = typeof response === "function" ? response(calls.length) : response;
      return new Response(value.raw === undefined ? JSON.stringify(value.body) : value.raw,
        { status: value.status || 200, headers: { "Content-Type": "application/json" } });
    } });
  context.window = context;
  vm.runInContext(bundle, context, { filename: "candidate-api.bundle.js" });
  return { api: context.transport, calls, tokens, prompts: () => prompts };
}
async function outcome(promise) {
  try { return { success: true, value: await promise }; }
  catch (e) { return { success: false, outcome: e.outcome, message: e.message }; }
}
async function run() {
  const methods = ["fact.add", "fact.update", "fact.remove", "fact.trust_set", "fact.feedback",
    "entity.merge", "entity.alias", "entity.remove", "undo", "backfill_vectors", "backup.create", "agent.ask"];
  const malformed = [
    ["null", { body: null }], ["array", { body: [] }], ["empty object", { body: {} }],
    ["negative acknowledgement", { body: { ok: false } }],
    ["negative with event", { body: { ok: false, event_id: 1 } }],
    ["missing event", { body: { ok: true } }],
    ["zero event", { body: { ok: true, event_id: 0 } }],
    ["negative event", { body: { ok: true, event_id: -1 } }],
    ["fractional event", { body: { ok: true, event_id: 1.5 } }],
    ["string event", { body: { ok: true, event_id: "1" } }],
    ["truthy ok", { body: { ok: "true", event_id: 1 } }],
    ["empty response", { raw: "" }], ["non-JSON", { raw: "<html>fixture failure</html>" }],
    ["error body", { body: { error: "synthetic error" } }],
  ];
  async function held(method, label, response) {
    const c = client(response);
    const params = { fixture: "identical-request" };
    const first = await outcome(c.api.rpc(method, params));
    const second = await outcome(c.api.rpc(method, params));
    check(`${method}: ${label} holds identical-request lock`,
      !first.success && !second.success && first.outcome === "unknown" &&
      second.outcome === "unknown" && c.calls.length === 1,
      { requests: c.calls.length, first, second });
  }
  for (const method of methods) {
    for (const [label, response] of malformed) await held(method, label, response);
  }
  for (const [label, body] of [
    ["missing agent fields", { ok: true, event_id: 1 }],
    ["empty session", { ok: true, event_id: 1, session_id: "", reply: "fixture reply" }],
    ["numeric session", { ok: true, event_id: 1, session_id: 3, reply: "fixture reply" }],
    ["missing reply", { ok: true, event_id: 1, session_id: "fixture-session" }],
    ["numeric reply", { ok: true, event_id: 1, session_id: "fixture-session", reply: 3 }],
  ]) await held("agent.ask", label, { body });
  for (const [label, body] of [
    ["missing backup fields", { ok: true, event_id: 1 }],
    ["empty path", { ok: true, event_id: 1, path: "", manifest: { facts: 0 } }],
    ["numeric path", { ok: true, event_id: 1, path: 3, manifest: { facts: 0 } }],
    ["null manifest", { ok: true, event_id: 1, path: "/synthetic/backup", manifest: null }],
    ["array manifest", { ok: true, event_id: 1, path: "/synthetic/backup", manifest: [] }],
  ]) await held("backup.create", label, { body });
  for (const method of methods) {
    const body = { ok: true, event_id: 1, session_id: "fixture-session", reply: "fixture reply",
      path: "/synthetic/backup", manifest: { facts: 0, fixture: true } };
    const c = client({ body });
    const outcomes = await Promise.all([outcome(c.api.rpc(method, {})), outcome(c.api.rpc(method, {}))]);
    const third = await outcome(c.api.rpc(method, {}));
    check(`${method}: confirmed acknowledgement releases completed lock`,
      outcomes.every((r) => r.success) && third.success && c.calls.length === 2,
      { requests: c.calls.length, outcomes, third });
  }
  for (const source of ["url", "prompt"]) {
    const c = client({ body: { facts: 1 } }, { denyRead: true, denyWrite: true,
      denyRemove: true, url: source === "url" ? undefined : "http://fixture.invalid/" });
    const first = await outcome(c.api.stats());
    const second = await outcome(c.api.stats());
    check(`denied storage: ${source} token stays in memory`, first.success && second.success &&
      c.calls.length === 2 && c.prompts() === (source === "prompt" ? 1 : 0),
      { requests: c.calls.length, prompts: c.prompts(), first, second });
  }
  for (const status of [401, 403]) {
    const c = client({ status, body: { error: "synthetic rejected token" } },
      { stored: "wrong-synthetic-token", denyRemove: true, url: "http://fixture.invalid/" });
    const first = await outcome(c.api.stats());
    const second = await outcome(c.api.stats());
    check(`HTTP ${status}: rejected token clears in memory when removeItem fails`,
      !first.success && !second.success && second.outcome === "not-sent" &&
      c.calls.length === 1 && c.prompts() === 0,
      { requests: c.calls.length, prompts: c.prompts(), first, second });
  }
}
run().catch((e) => check("harness completes", false, { error: e.stack })).finally(() => {
  const failed = results.filter((r) => !r.ok);
  const report = { status: failed.length ? "fail" : "pass", fixtureOnly: true,
    livePort8770Used: false, artifacts: ARTIFACTS,
    totals: { checks: results.length, passed: results.length - failed.length, failed: failed.length },
    failures: failed, results };
  const reportPath = path.join(ARTIFACTS, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`${report.totals.passed}/${report.totals.checks} passed. Report: ${reportPath}`);
  process.exitCode = failed.length ? 1 : 0;
});
