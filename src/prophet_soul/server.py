"""The plugin's server: the manifest and the script for Omniscient, nothing else.

Soul asks for no scopes, so it has no key and no connect: its script reads
memory through `prophet.api` in the owner's own Omniscient. The server only
hands Omniscient the manifest and the script, with CORS for the allowed
origins (docs/plugins.md in Prophet_v2, section 3).
"""

import argparse
import os
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).parent
FILES = {
    "/prophet-plugin.json": ("prophet-plugin.json", "application/json; charset=utf-8"),
    "/omniscient.js": ("omniscient.js", "text/javascript; charset=utf-8"),
}
DEFAULT_PORT = 8791
DEFAULT_ORIGIN = "http://127.0.0.1:8770"


def origins(value: str | None) -> set[str]:
    """Omniscient's origins from a comma-separated list, without trailing slashes."""
    return {o.strip().rstrip("/") for o in (value or "").split(",") if o.strip()}


def handler(allowed: set[str]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "prophet-soul"

        def _cors(self) -> None:
            origin = self.headers.get("Origin")
            if origin and origin in allowed:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            found = FILES.get(self.path.split("?", 1)[0])
            if not found:
                self.send_response(404)
                self._cors()
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            name, kind = found
            body = (HERE / name).read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", kind)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args) -> None:  # noqa: A002
            print(f"{self.address_string()} {format % args}", flush=True)

    return Handler


def make_server(host: str, port: int, allowed: set[str]) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), handler(allowed))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="prophet-soul", description=__doc__.splitlines()[0])
    parser.add_argument("--host", default=os.environ.get("SOUL_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SOUL_PORT", DEFAULT_PORT)))
    parser.add_argument(
        "--omniscient",
        default=os.environ.get("SOUL_OMNISCIENT")
        or os.environ.get("PROPHET_URL")
        or DEFAULT_ORIGIN,
        help="Omniscient's origins, comma-separated (default: PROPHET_URL)",
    )
    args = parser.parse_args(argv)
    if not (HERE / "omniscient.js").exists():
        print("omniscient.js is missing: run `make js`", flush=True)
        sys.exit(1)
    try:
        server = make_server(args.host, args.port, origins(args.omniscient))
    except OSError as err:
        print(f"cannot listen on {args.host}:{args.port}: {err}", flush=True)
        sys.exit(1)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown).start())
    print(f"Soul on http://{args.host}:{args.port} for {args.omniscient}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
