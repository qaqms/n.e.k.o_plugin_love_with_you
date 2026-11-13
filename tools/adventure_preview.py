"""Local game preview with real adventure persistence and isolated test data."""

from __future__ import annotations

import argparse
import importlib
import json
import mimetypes
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
package = ModuleType("_love_adventure_preview")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
adventure = importlib.import_module(package.__name__ + "._adventure")
storage = importlib.import_module(package.__name__ + "._storage")

HOST_PAGE = b"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Border Forest - isolated preview</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body><iframe id="surface" title="Border Forest"
sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
src="/plugin/love_with_you/ui/index.html"></iframe>
<script src="/preview-host.js"></script></body></html>"""

HOST_SCRIPT = b"""
const frame = document.getElementById('surface');
window.addEventListener('message', async event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const d = event.data;
  if (d?.type !== 'neko-hosted-surface-request' || d.method !== 'call') return;
  if (d.payload?.actionId !== 'adventure_action') return;
  let payload;
  try {
    const r = await fetch('/preview/action', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d.payload.args),
    });
    payload = await r.json();
  } catch (e) { payload = {ok:false,error:String(e)}; }
  frame.contentWindow.postMessage({
    type:'neko-hosted-surface-response', requestId:d.requestId, ...payload,
  }, location.origin);
});
"""


def make_server(port: int, data_dir: Path) -> ThreadingHTTPServer:
    store = adventure.AdventureStore(storage.StateFile(data_dir / "adventure.json", max_bytes=adventure.MAX_BYTES))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, body, content_type="application/json", status=200):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path == "/":
                return self.respond(HOST_PAGE, "text/html; charset=utf-8")
            if path == "/preview-host.js":
                return self.respond(HOST_SCRIPT, "text/javascript")
            prefix = "/plugin/love_with_you/ui/"
            if path.startswith(prefix):
                target = (ROOT / "static" / path[len(prefix):]).resolve()
                if target.is_relative_to(ROOT / "static") and target.is_file():
                    mime = "text/javascript" if target.suffix in (".js", ".mjs") else mimetypes.guess_type(target)[0]
                    return self.respond(target.read_bytes(), mime or "application/octet-stream")
            return self.respond({"error": "not_found"}, status=404)

        def do_POST(self):
            if self.headers.get("Origin") not in (None, f"http://{self.headers.get('Host')}"):
                return self.respond({"error": "origin_denied"}, status=403)
            if self.path not in ("/preview/action", "/plugin/love_with_you/hosted-ui/action/adventure_action"):
                return self.respond({"error": "not_found"}, status=404)
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= adventure.MAX_BYTES:
                    return self.respond({"error": "request_too_large"}, status=413)
                args = json.loads(self.rfile.read(size))
                if self.path != "/preview/action":
                    args = args["args"]
                if args.get("operation") == "read":
                    result = store.view(args.get("client", ""))
                    result.update(characters=["YUI", "MIO"], current_character="YUI")
                else:
                    result = store.execute(
                        args.get("operation"), args.get("request_id"), args.get("revision"),
                        args.get("client"), args.get("epoch"), args.get("values"),
                        character=args.get("values", {}).get("character", ""), stage_index=2,
                    )
                return self.respond({"ok": True, "result": {"result": {"adventure": result}}})
            except adventure.AdventureError as exc:
                return self.respond({"ok": False, "code": str(exc), "error": str(exc)})
            except (ValueError, KeyError, TypeError, OSError):
                return self.respond({"ok": False, "error": "preview_request_failed"})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4321)
    parser.add_argument("--data", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="neko-adventure-") as temporary:
        server = make_server(args.port, args.data or Path(temporary))
        print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}", "isolated": True}), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
