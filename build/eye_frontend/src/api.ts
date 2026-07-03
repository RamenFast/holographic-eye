/* RPC + WebSocket client for the Eye control plane (C4).
   Same-origin: the bundle is served by the control plane itself.
   GPLv3 — see LICENSE. */

export type Json = any;

let token = "";

export function getToken(): string {
  if (token) return token;
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    localStorage.setItem("eyeToken", fromUrl);
    url.searchParams.delete("token");
    history.replaceState(null, "", url.toString());
  }
  token = localStorage.getItem("eyeToken") || "";
  while (!token) {
    token = (prompt("Holographic Eye — paste the token from ~/.hermes/eye_token") || "").trim();
    if (token) localStorage.setItem("eyeToken", token);
  }
  return token;
}

export function resetToken(): void {
  localStorage.removeItem("eyeToken");
  token = "";
  location.reload();
}

export async function rpc(method: string, params: Json = {}): Promise<Json> {
  const res = await fetch("/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ method, params }),
  });
  if (res.status === 401) resetToken();
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error}`);
  return body;
}

/** Passthrough read: returns the parsed byte-exact agent tool result. */
export async function toolRead(action: string, params: Json = {}): Promise<Json> {
  const body = await rpc(action, params);
  return JSON.parse(body.raw);
}

export async function stats(): Promise<Json> {
  const res = await fetch("/stats", {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 401) resetToken();
  return res.json();
}

export type WsStatus = "live" | "degraded" | "off";

export function openEvents(
  onEvent: (ev: Json) => void,
  onHello: (stats: Json) => void,
  onStatus: (s: WsStatus) => void,
): void {
  let retryMs = 1000;
  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/events?token=${getToken()}`);
    ws.onopen = () => {
      retryMs = 1000;
      onStatus("live");
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "hello") onHello(msg.stats);
      else if (msg.type === "event") onEvent(msg.event);
    };
    ws.onclose = () => {
      onStatus("off");
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
    ws.onerror = () => onStatus("degraded");
  };
  connect();
}
