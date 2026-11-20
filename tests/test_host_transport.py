from __future__ import annotations

import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest


@contextmanager
def serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


@pytest.mark.parametrize("redirect", [301, 302, 303, 307, 308])
def test_local_http_reader_never_follows_redirects(host, monkeypatch, redirect):
    hits = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            hits.append(self.path)
            if self.path == "/redirect":
                self.send_response(redirect)
                self.send_header("Location", "/target")
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"redirected":true}')

    with serve(Handler) as port:
        monkeypatch.setattr(host, "main_server_port", lambda: port)
        assert host._get_json("/redirect") is None
    assert hits == ["/redirect"]


def test_all_host_json_reads_have_a_default_size_limit(host, monkeypatch):
    response = Mock()
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.status = 200
    response.read.return_value = b'{"ok":true}'
    monkeypatch.setattr(host, "_OPENER", Mock(open=Mock(return_value=response)))
    assert host._get_json("/api/characters") == {"ok": True}
    assert response.read.call_args.args and response.read.call_args.args[0] > 0


@pytest.mark.parametrize("body", [
    b"[" * 2000 + b"]" * 2000, b'{"coins":1,"coins":999}', b'{"value":NaN}', b'{"value":1e999}',
])
def test_malformed_host_json_is_rejected(host, monkeypatch, body):
    response = Mock(status=200)
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.read.return_value = body
    monkeypatch.setattr(host, "_OPENER", Mock(open=Mock(return_value=response)))
    assert host._get_json("/api/characters") is None


def test_oversized_http_body_is_rejected_after_a_bounded_read(host, monkeypatch):
    response = Mock(status=200)
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.read.return_value = b"x" * 17
    monkeypatch.setattr(host, "_MAX_JSON_BYTES", 16)
    monkeypatch.setattr(host, "_OPENER", Mock(open=Mock(return_value=response)))
    assert host._get_json("/api/characters") is None
    response.read.assert_called_once_with(17)


def test_viewing_progress_uses_valid_playback_and_the_latest_record_per_role(host, monkeypatch):
    row = {
        "id": "a" * 32, "job": "b" * 32, "version": "c" * 64, "title": "  A \n video  ",
        "character": "Mio & YUI", "last_watched": "2026-11-20T04:00:00.123+00:00",
        "progress": 752.7, "completed": 0,
    }
    read = Mock(return_value={"watches": [
        dict(row, progress=198, last_watched="2026-11-20T03:00:00+00:00"),
        dict(row, last_watched=None, progress=0),
        dict(row, character="Other"),
        dict(row, character="Before consent", last_watched="2026-11-20T02:00:00+00:00"),
        dict(row, id="unknown", last_watched="2026-11-20T05:00:00+00:00"),
        dict(row, last_watched="2026-11-20T05:00:00+00:00", progress=True),
        row,
        dict(row, character="YUI", id="d" * 32, completed=1),
    ]})
    monkeypatch.setattr(host, "_get_json", read)
    monkeypatch.setattr(host, "main_server_port", lambda: 49991)
    assert host.fetch_recent_watches({}) == {}
    read.assert_not_called()
    records = host.fetch_recent_watches({"Mio & YUI": 1, "YUI": 1, "Before consent": 2_000_000_000})
    assert set(records) == {"Mio & YUI", "YUI"}
    watch = records["Mio & YUI"]
    assert watch["title"] == "A video"
    assert watch["position"] == 752 and watch["completed"] is False
    assert records["YUI"]["completed"] is True
    url = urlsplit(watch["url"])
    assert (url.hostname, url.port, url.path) == ("127.0.0.1", 49991, "/watch_together")
    assert parse_qs(url.query) == {"job": ["b" * 32], "version": ["c" * 64], "lanlan_name": ["Mio & YUI"]}
    read.assert_called_once_with("/api/watch-together/watches?limit=100", timeout=1.5, max_bytes=512 * 1024)


@pytest.mark.parametrize("payload,expected", [(None, None), ({"watches": []}, {}), ({"watches": {}}, None)])
def test_viewing_source_distinguishes_unavailable_from_empty(host, monkeypatch, payload, expected):
    monkeypatch.setattr(host, "_get_json", Mock(return_value=payload))
    assert host.fetch_recent_watches({"YUI": 1}) == expected
