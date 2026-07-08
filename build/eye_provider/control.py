"""Control plane for The Holographic Eye (C4 in PLAN.md PART 4).

Loopback HTTP + WebSocket server in a daemon thread inside the wrapper
provider (daemon threads are sanctioned by the plugin threading contract).
stdlib-only — the hermes venv gains zero dependencies.

  GET  /health            liveness (unauthenticated, loopback-only)
  GET  /stats             counts, trust histogram, journal lag   (token)
  POST /rpc               {"method": ..., "params": {...}}       (token)
  GET  /events            WebSocket — every journal event live   (token)
  GET  /                  the Eye frontend bundle (static files)

Auth: bearer token generated into $HERMES_HOME/eye_token (0600); accepted
as ``Authorization: Bearer`` header or ``?token=`` query param (browsers
cannot set WS headers). Default bind 127.0.0.1 (invariant I8); LAN use is
an explicit config opt-in (bind: 0.0.0.0), still token-authed.

RPC read passthrough returns the *byte-exact* string the agent's tool
call would return (invariant I6) in the ``raw`` field.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import mimetypes
import os
import queue
import secrets
import select
import socket
import struct
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)

_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
_FRONTEND_DIR = Path(__file__).parent / "frontend"

_singleton_lock = threading.Lock()
_singleton: Optional["EyeControlPlane"] = None


def ensure_control_plane(provider) -> "EyeControlPlane":
    """Start (once per process) and attach the provider to the control plane.

    The singleton is published only after a successful bind — a failed
    start (port taken by a process that will die, e.g. the 2026-07-07
    dashboard port-theft) must be retried on the next initialize, not
    remembered as a permanently broken plane."""
    global _singleton
    with _singleton_lock:
        if _singleton is None:
            plane = EyeControlPlane(provider._config)
            plane.start()
            _singleton = plane
        _singleton.attach(provider)
        return _singleton


def ensure_control_plane_boot(provider) -> "EyeControlPlane":
    """Start the plane (once per process) and set *provider* as its
    persistent fallback data source.

    Used at gateway boot (D-0015): since the TUI moved agent turns into
    ``tui_gateway.slash_worker`` subprocesses, the per-session
    ``initialize()`` that used to wake the plane no longer fires in the
    gateway — so :8770 stayed dormant until an api_server/Telegram turn
    happened to arrive in-process. Warming a dedicated provider here makes
    :8770 live from process start, independent of where sessions run. The
    same failed-bind-is-retryable contract as ``ensure_control_plane``
    holds (a lingering socket from the outgoing gateway must not be
    remembered as permanently broken)."""
    global _singleton
    with _singleton_lock:
        if _singleton is None:
            plane = EyeControlPlane(provider._config)
            plane.start()
            _singleton = plane
        _singleton.attach_boot(provider)
        return _singleton


class EyeControlPlane:
    def __init__(self, config: dict):
        self.config = config or {}
        self.port = int(self.config.get("port", 8770))
        self.bind = str(self.config.get("bind", "127.0.0.1"))
        self.provider = None          # live per-session provider (may be None)
        self._boot_provider = None    # persistent gateway-boot fallback (D-0015)
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._clients: List["queue.Queue"] = []
        self._clients_lock = threading.Lock()
        self.token = self._load_token()
        self.started_at = time.time()

    # -- lifecycle -----------------------------------------------------------

    def _load_token(self) -> str:
        try:
            from hermes_constants import get_hermes_home
            token_path = Path(get_hermes_home()) / "eye_token"
        except Exception:
            token_path = Path("~/.hermes/eye_token").expanduser()
        try:
            if token_path.exists():
                tok = token_path.read_text().strip()
                if tok:
                    return tok
            tok = secrets.token_hex(32)
            token_path.write_text(tok + "\n")
            os.chmod(token_path, 0o600)
            return tok
        except Exception as e:
            logger.warning("Eye token file unavailable (%s); using process token", e)
            return secrets.token_hex(32)

    def start(self) -> None:
        handler = _make_handler(self)
        self._server = ThreadingHTTPServer((self.bind, self.port), handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="eye-control-plane", daemon=True
        )
        self._thread.start()
        logger.info("Eye control plane listening on %s:%d", self.bind, self.port)

    def attach(self, provider) -> None:
        self.provider = provider
        if provider.journal is not None:
            provider.journal.add_listener(self._on_event)

    def attach_boot(self, provider) -> None:
        """Set the persistent gateway-boot provider — the plane's fallback
        data source so :8770 serves real data from process start, even when
        no per-session provider is attached (TUI turns run in slash_worker
        subprocesses; D-0015). Never nulled by session detach."""
        self._boot_provider = provider
        if provider.journal is not None:
            provider.journal.add_listener(self._on_event)

    def active_provider(self):
        """The provider the plane reads through: the live per-session
        provider when one is attached, else the persistent boot provider.
        Both read the same on-disk store/journal (WAL), so a fallback read
        is byte-identical to a live-session read."""
        return self.provider if self.provider is not None else self._boot_provider

    def detach(self, provider) -> None:
        if self.provider is provider:
            self.provider = None
        try:
            if provider.journal is not None:
                provider.journal.remove_listener(self._on_event)
        except Exception:
            pass

    # -- event fanout ----------------------------------------------------------

    def _on_event(self, event: Dict[str, Any]) -> None:
        payload = json.dumps({"type": "event", "event": event}, ensure_ascii=False,
                             default=str)
        with self._clients_lock:
            clients = list(self._clients)
        for q in clients:
            try:
                q.put_nowait(payload)
            except queue.Full:
                try:  # drop oldest, keep the stream moving
                    q.get_nowait()
                    q.put_nowait(payload)
                except Exception:
                    pass

    def register_client(self) -> "queue.Queue":
        q: "queue.Queue" = queue.Queue(maxsize=500)
        with self._clients_lock:
            self._clients.append(q)
        return q

    def unregister_client(self, q: "queue.Queue") -> None:
        with self._clients_lock:
            if q in self._clients:
                self._clients.remove(q)

    @property
    def client_count(self) -> int:
        with self._clients_lock:
            return len(self._clients)

    # -- shared data helpers -----------------------------------------------------

    def check_token(self, supplied: str) -> bool:
        return bool(supplied) and hmac.compare_digest(supplied, self.token)

    def stats(self) -> Dict[str, Any]:
        from . import __version__, accel
        prov = self.active_provider()
        out: Dict[str, Any] = {
            "ok": prov is not None,
            "version": __version__,
            "mode": getattr(prov, "_mode", None),
            "session_id": getattr(prov, "_session_id", ""),
            "ws_clients": self.client_count,
            "uptime_s": round(time.time() - self.started_at, 1),
            "accel": accel.stats(),
        }
        store = prov.store if prov else None
        if store is not None:
            c = store._conn
            out["facts"] = c.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
            out["entities"] = c.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
            out["links"] = c.execute("SELECT COUNT(*) FROM fact_entities").fetchone()[0]
            out["null_vectors"] = c.execute(
                "SELECT COUNT(*) FROM facts WHERE hrr_vector IS NULL"
            ).fetchone()[0]
            out["trust_histogram"] = {
                str(r[0]): r[1] for r in c.execute(
                    "SELECT ROUND(trust_score, 1), COUNT(*) FROM facts GROUP BY 1 ORDER BY 1"
                )
            }
            out["categories"] = {
                r[0]: r[1] for r in c.execute(
                    "SELECT category, COUNT(*) FROM facts GROUP BY category"
                )
            }
            out["banks"] = [
                {"bank_name": r[0], "dim": r[1], "fact_count": r[2], "updated_at": r[3]}
                for r in c.execute(
                    "SELECT bank_name, dim, fact_count, updated_at FROM memory_banks"
                )
            ]
            dim = getattr(store, "hrr_dim", 1024)
            out["hrr_dim"] = dim
            out["snr"] = round(math.sqrt(dim / max(1, out["facts"])), 3)
            out["min_trust"] = getattr(prov._inner, "_min_trust", 0.3)
        j = prov.journal if prov else None
        if j is not None:
            js = j.stats()
            out["journal"] = js
            if js.get("last_event_ts"):
                try:
                    last = datetime.fromisoformat(js["last_event_ts"])
                    out["journal"]["lag_s"] = round(
                        (datetime.now(timezone.utc) - last).total_seconds(), 3
                    )
                except Exception:
                    pass
        return out

    def rpc(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        from . import rpc as rpc_mod
        return rpc_mod.dispatch(self, method, params or {})


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

def _make_handler(plane: EyeControlPlane):
    class EyeHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "HolographicEye/1.0.2"

        def log_message(self, fmt, *args):
            logger.debug("eye-http: " + fmt, *args)

        # -- auth ----------------------------------------------------------

        def _supplied_token(self) -> str:
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                return auth[7:].strip()
            qs = parse_qs(urlparse(self.path).query)
            return (qs.get("token") or [""])[0]

        def _authed(self) -> bool:
            return plane.check_token(self._supplied_token())

        def _deny(self):
            self._send_json({"error": "unauthorized"}, status=401)

        def _send_json(self, obj: Any, status: int = 200):
            body = json.dumps(obj, ensure_ascii=False, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        # -- routes ----------------------------------------------------------

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/health":
                from . import __version__
                self._send_json({"ok": True, "app": "holographic-eye",
                                 "version": __version__,
                                 "attached": plane.active_provider() is not None})
            elif path == "/stats":
                if not self._authed():
                    return self._deny()
                self._send_json(plane.stats())
            elif path == "/events":
                if not self._authed():
                    return self._deny()
                self._serve_websocket()
            else:
                self._serve_static(path)

        def do_POST(self):
            path = urlparse(self.path).path
            if path != "/rpc":
                return self._send_json({"error": "not found"}, status=404)
            if not self._authed():
                return self._deny()
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                method = body.get("method", "")
                params = body.get("params") or {}
            except Exception as e:
                return self._send_json({"error": f"bad request: {e}"}, status=400)
            if plane.active_provider() is None:
                return self._send_json({"error": "no provider attached"}, status=503)
            try:
                result = plane.rpc(method, params)
                self._send_json(result)
            except Exception as e:
                logger.debug("Eye RPC %s failed", method, exc_info=True)
                self._send_json({"error": str(e), "method": method}, status=500)

        # -- static frontend ---------------------------------------------------

        def _serve_static(self, path: str):
            if path in ("/", ""):
                path = "/index.html"
            target = (_FRONTEND_DIR / path.lstrip("/")).resolve()
            if (
                _FRONTEND_DIR.exists()
                and str(target).startswith(str(_FRONTEND_DIR.resolve()))
                and target.is_file()
            ):
                ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
                data = target.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif path == "/index.html":
                body = (b"<!doctype html><meta charset=utf-8>"
                        b"<title>The Holographic Eye</title>"
                        b"<body style='background:#000;color:#eaf6ff;font-family:monospace'>"
                        b"<p>&#8857; holographic-eye control plane is up; "
                        b"frontend bundle not deployed.</p>")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self._send_json({"error": "not found"}, status=404)

        # -- websocket (server-push event stream) -------------------------------

        def _serve_websocket(self):
            key = self.headers.get("Sec-WebSocket-Key", "")
            if self.headers.get("Upgrade", "").lower() != "websocket" or not key:
                return self._send_json({"error": "expected websocket upgrade"}, 400)
            accept = base64.b64encode(
                hashlib.sha1((key + _WS_GUID).encode()).digest()
            ).decode()
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.end_headers()

            sock: socket.socket = self.connection
            sock.settimeout(15)  # a stalled client must not wedge this thread
            q = plane.register_client()
            try:
                self._ws_send(sock, json.dumps({
                    "type": "hello",
                    "stats": plane.stats(),
                }, ensure_ascii=False, default=str))
                while True:
                    # block on the event queue (events push instantly);
                    # client frames (close/ping) are polled non-blocking
                    try:
                        self._ws_send(sock, q.get(timeout=0.25))
                        while True:
                            self._ws_send(sock, q.get_nowait())
                    except queue.Empty:
                        pass
                    r, _, _ = select.select([sock], [], [], 0)
                    if r:
                        opcode, payload = self._ws_recv(sock)
                        if opcode is None or opcode == 0x8:      # close
                            if opcode == 0x8:
                                try:  # RFC 6455: echo the close frame
                                    self._ws_send_raw(sock, 0x8, payload[:2])
                                except OSError:
                                    pass
                            break
                        if opcode == 0x9:                        # ping → pong
                            self._ws_send_raw(sock, 0xA, payload)
                        # 0x0/0x1/0x2 client data frames are ignored — this
                        # stream is server-push only
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                plane.unregister_client(q)
                self.close_connection = True

        @staticmethod
        def _ws_send(sock: socket.socket, text: str) -> None:
            EyeHandler._ws_send_raw(sock, 0x1, text.encode())

        @staticmethod
        def _ws_send_raw(sock: socket.socket, opcode: int, payload: bytes) -> None:
            header = bytes([0x80 | opcode])
            n = len(payload)
            if n < 126:
                header += bytes([n])
            elif n < 65536:
                header += bytes([126]) + struct.pack(">H", n)
            else:
                header += bytes([127]) + struct.pack(">Q", n)
            sock.sendall(header + payload)

        @staticmethod
        def _ws_recv(sock: socket.socket):
            """Read one (masked) client frame; returns (opcode, payload)."""
            def read_exact(k: int) -> bytes:
                buf = b""
                while len(buf) < k:
                    chunk = sock.recv(k - len(buf))
                    if not chunk:
                        raise ConnectionResetError
                    buf += chunk
                return buf
            try:
                b1, b2 = read_exact(2)
                opcode = b1 & 0x0F
                masked = b2 & 0x80
                n = b2 & 0x7F
                if n == 126:
                    n = struct.unpack(">H", read_exact(2))[0]
                elif n == 127:
                    n = struct.unpack(">Q", read_exact(8))[0]
                mask = read_exact(4) if masked else b"\x00" * 4
                data = read_exact(n) if n else b""
                payload = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
                return opcode, payload
            except (ConnectionResetError, struct.error, OSError):
                return None, b""

    return EyeHandler
