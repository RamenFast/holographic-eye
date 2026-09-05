/* RPC + WebSocket client for the Eye control plane (C4).
   Same-origin: the bundle is served by the control plane itself.
   GPLv3 — see LICENSE. */

import { getStored, setStored, removeStored } from "./storage";

export type Json = any;

const READ_TIMEOUT_MS = 20_000;
const MUTATION_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY = 4_096;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_WS_PACKET_CHARS = 8 * 1024 * 1024;
const MUTATIONS = new Set([
  "fact.add", "fact.update", "fact.remove", "fact.trust_set", "fact.feedback",
  "entity.merge", "entity.alias", "entity.remove", "undo", "backfill_vectors",
  "backup.create", "agent.ask",
]);

type RpcOutcome = "not-sent" | "rejected" | "unknown";

export class RpcError extends Error {
  constructor(message: string, public readonly outcome: RpcOutcome = "rejected") {
    super(message);
    this.name = "RpcError";
  }
}

let token = "";
let tokenPromptDismissed = false;
let authInvalid = false;
const mutationFlights = new Map<string, Promise<Json>>();

function forgetToken(): void {
  token = "";
  authInvalid = true;
  removeStored("eyeToken");
}

export function getToken(): string {
  if (token) return token;
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("token")?.trim();
  if (fromUrl) {
    token = fromUrl;
    tokenPromptDismissed = false;
    authInvalid = false;
    setStored("eyeToken", token);
    url.searchParams.delete("token");
    history.replaceState(null, "", url.toString());
    return token;
  }

  if (tokenPromptDismissed || authInvalid) {
    throw new RpcError(
      "No control-plane token is available. Reload, then paste ~/.hermes/eye_token.",
      "not-sent",
    );
  }
  const stored = getStored("eyeToken")?.trim();
  if (stored) {
    token = stored;
    return token;
  }

  const entered = prompt("Holographic Eye — paste the token from ~/.hermes/eye_token");
  if (entered === null || !entered.trim()) {
    tokenPromptDismissed = true;
    throw new RpcError(
      "Token entry was cancelled. Reload when you are ready to paste ~/.hermes/eye_token.",
      "not-sent",
    );
  }
  token = entered.trim();
  setStored("eyeToken", token);
  return token;
}

export function resetToken(): void {
  removeStored("eyeToken");
  token = "";
  tokenPromptDismissed = false;
  authInvalid = false;
  location.reload();
}

function errorDetail(value: unknown): string {
  if (typeof value === "string") return value.slice(0, MAX_ERROR_BODY);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const detail = record.error ?? record.detail ?? record.message;
    if (typeof detail === "string") return detail.slice(0, MAX_ERROR_BODY);
  }
  return "";
}

async function readResponseText(res: Response, label: string): Promise<string> {
  const declared = Number(res.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new RpcError(`${label}: response exceeded the 32 MiB safety limit. Check the gateway log before retrying.`);
  }
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  const parts: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new RpcError(`${label}: response exceeded the 32 MiB safety limit. Check the gateway log before retrying.`);
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

async function parseJsonResponse(res: Response, label: string): Promise<Json> {
  const text = await readResponseText(res, label);
  if (!text.trim()) {
    throw new RpcError(`${label}: HTTP ${res.status} returned an empty response. Check the gateway log before retrying.`);
  }
  let body: Json;
  try {
    body = JSON.parse(text);
  } catch {
    const sample = text.trim().replace(/\s+/g, " ").slice(0, 180);
    throw new RpcError(
      `${label}: HTTP ${res.status} returned non-JSON${sample ? `: ${sample}` : "."} Check the gateway log before retrying.`,
    );
  }
  if (!res.ok) {
    const detail = errorDetail(body);
    throw new RpcError(
      `${label}: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${detail ? ` — ${detail}` : ""}. Check the gateway version and log before retrying.`,
    );
  }
  return body;
}

async function fetchJson(
  label: string,
  input: RequestInfo | URL,
  init: RequestInit,
  mutation: boolean,
): Promise<Json> {
  let auth: string;
  try {
    auth = getToken();
  } catch (err) {
    throw err instanceof RpcError ? err : new RpcError(String(err), "not-sent");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${auth}`);
  const controller = mutation ? null : new AbortController();
  let timeout: number | undefined;
  const network = fetch(input, { ...init, headers, signal: controller?.signal })
    .then(async (res) => {
      if (res.status === 401 || res.status === 403) {
        forgetToken();
        throw new RpcError(
          `${label}: token rejected (HTTP ${res.status}). Reload, then paste the current ~/.hermes/eye_token.`,
          "rejected",
        );
      }
      try {
        return await parseJsonResponse(res, label);
      } catch (err) {
        if (mutation) {
          const message = err instanceof Error ? err.message : String(err);
          throw new RpcError(
            `${message} The mutation outcome is unknown. Check the journal before retrying.`,
            "unknown",
          );
        }
        throw err;
      }
    })
    .catch((err) => {
      if (err instanceof RpcError) throw err;
      if (!mutation && err instanceof DOMException && err.name === "AbortError") {
        throw new RpcError(`${label}: timed out after ${READ_TIMEOUT_MS / 1000}s. Retry the read.`);
      }
      const detail = err instanceof Error ? err.message : String(err);
      const suffix = mutation
        ? "The mutation outcome is unknown. Check the journal before retrying."
        : "Check that the gateway is running, then retry the read.";
      throw new RpcError(`${label}: network failure — ${detail}. ${suffix}`, mutation ? "unknown" : "rejected");
    });

  if (!mutation) {
    timeout = window.setTimeout(() => controller!.abort(), READ_TIMEOUT_MS);
    return network.finally(() => clearTimeout(timeout));
  }

  const bounded = new Promise<Json>((resolve, reject) => {
    timeout = window.setTimeout(() => reject(new RpcError(
      `${label}: no response after ${MUTATION_TIMEOUT_MS / 1000}s. The mutation outcome is unknown. Check the journal before retrying.`,
      "unknown",
    )), MUTATION_TIMEOUT_MS);
    network.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
  // Do not abort a mutation. The server can commit after the client times out.
  return bounded;
}

export async function rpc(method: string, params: Json = {}): Promise<Json> {
  const mutation = MUTATIONS.has(method);
  let body: string;
  try {
    body = JSON.stringify({ method, params });
  } catch (err) {
    throw new RpcError(`${method}: request parameters are not JSON serializable.`, "not-sent");
  }

  if (!mutation) {
    const result = await fetchJson(method, "/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }, false);
    if (result?.error) throw new RpcError(`${method}: ${errorDetail(result) || "request rejected"}.`);
    return result;
  }

  const key = `${method}\n${body}`;
  const existing = mutationFlights.get(key);
  if (existing) return existing;

  const network = fetchJson(method, "/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }, true).then((result) => {
    const object = result !== null && typeof result === "object" && !Array.isArray(result);
    const acknowledged = object && result.ok === true && !result.error &&
      Number.isSafeInteger(result.event_id) && result.event_id > 0;
    const validAsk = method !== "agent.ask" || (typeof result?.session_id === "string" &&
      result.session_id.trim().length > 0 && typeof result?.reply === "string");
    const validBackup = method !== "backup.create" || (typeof result?.path === "string" &&
      result.path.trim().length > 0 &&
      result?.manifest !== null && typeof result?.manifest === "object" &&
      !Array.isArray(result.manifest) && Number.isSafeInteger(result.manifest.facts) &&
      result.manifest.facts >= 0);
    if (!acknowledged || !validAsk || !validBackup) {
      throw new RpcError(
        `${method}: ${errorDetail(result) || "missing or invalid mutation acknowledgment"}. The mutation outcome is unknown. Inspect current state and the journal before retrying.`,
        "unknown",
      );
    }
    return result;
  });
  mutationFlights.set(key, network);
  network.then(
    () => { if (mutationFlights.get(key) === network) mutationFlights.delete(key); },
    (err) => {
      // Keep an unknown mutation blocked for this page lifetime. A retry could double-commit.
      if (err?.outcome !== "unknown" && mutationFlights.get(key) === network) {
        mutationFlights.delete(key);
      }
    },
  );
  return network;
}

/** Passthrough read: returns the parsed byte-exact agent tool result. */
export async function toolRead(action: string, params: Json = {}): Promise<Json> {
  const body = await rpc(action, params);
  if (typeof body?.raw !== "string") {
    throw new RpcError(`${action}: response omitted the raw agent result. Check the gateway log, then retry the read.`);
  }
  try {
    return JSON.parse(body.raw);
  } catch {
    throw new RpcError(`${action}: raw agent result was not valid JSON. Check the gateway log, then retry the read.`);
  }
}

export async function stats(): Promise<Json> {
  const body = await fetchJson("stats", "/stats", {}, false);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RpcError("stats: response was not a JSON object. Check the gateway log, then retry the read.");
  }
  if (body.error) throw new RpcError(`stats: ${errorDetail(body) || "request rejected"}. Check the gateway log, then retry the read.`);
  return body;
}

export type WsStatus = "live" | "degraded" | "off";

export function openEvents(
  onEvent: (ev: Json) => void,
  onHello: (stats: Json) => void,
  onStatus: (s: WsStatus) => void,
): void {
  let retryMs = 1000;
  let retryTimer: number | undefined;
  let generation = 0;
  let lastStatus: WsStatus | undefined;

  const report = (status: WsStatus) => {
    if (lastStatus === status) return;
    lastStatus = status;
    try { onStatus(status); } catch (err) { console.error("Eye WS status callback failed", err); }
  };
  const schedule = () => {
    if (authInvalid || tokenPromptDismissed || retryTimer !== undefined) return;
    const jitter = Math.floor(Math.random() * Math.min(500, retryMs / 4));
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, retryMs + jitter);
    retryMs = Math.min(retryMs * 2, 15_000);
  };
  const connect = () => {
    const mine = ++generation;
    let auth: string;
    try { auth = getToken(); }
    catch (err) {
      console.warn(err);
      report("off");
      return;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/events?token=${encodeURIComponent(auth)}`);
    } catch (err) {
      console.warn("Eye WS connection failed", err);
      report("off");
      schedule();
      return;
    }
    ws.onopen = () => {
      if (mine !== generation) return;
      retryMs = 1000;
      report("live");
    };
    ws.onmessage = (message) => {
      if (mine !== generation) return;
      if (typeof message.data !== "string") {
        console.warn("Eye WS ignored a non-text packet");
        report("degraded");
        return;
      }
      if (message.data.length > MAX_WS_PACKET_CHARS) {
        console.warn("Eye WS ignored a packet above the 8 MiB safety limit");
        report("degraded");
        return;
      }
      let packet: Json;
      try { packet = JSON.parse(message.data); }
      catch {
        console.warn("Eye WS ignored malformed JSON");
        report("degraded");
        return;
      }
      try {
        if (packet?.type === "hello" && packet.stats && typeof packet.stats === "object") {
          onHello(packet.stats);
          report("live");
        } else if (packet?.type === "event" && packet.event && typeof packet.event === "object") {
          onEvent(packet.event);
          report("live");
        } else {
          console.warn("Eye WS ignored an unknown packet", packet);
          report("degraded");
        }
      } catch (err) {
        console.error("Eye WS message callback failed", err);
        report("degraded");
      }
    };
    ws.onclose = (event) => {
      if (mine !== generation) return;
      if (event.code === 1008 || event.code === 4401 || event.code === 4403) {
        forgetToken();
        console.warn("Eye WS token rejected; reload to enter the current token");
      }
      report("off");
      schedule();
    };
    ws.onerror = () => {
      if (mine === generation) report("degraded");
    };
  };
  connect();
}
