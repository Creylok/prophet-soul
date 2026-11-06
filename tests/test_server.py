"""The server offline, and the manifest against docs/plugins.md, section 2."""

import json
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from prophet_soul import server

PKG = Path(server.__file__).parent
ORIGIN = "http://127.0.0.1:8770"
FIELDS = {
    "id",
    "name",
    "version",
    "api_version",
    "description",
    "homepage",
    "scopes",
    "script",
    "connect",
    "settings",
}
SETTING_KEYS = {
    "type",
    "title",
    "description",
    "default",
    "enum",
    "minimum",
    "maximum",
    "maxLength",
}


@pytest.fixture
def base():
    srv = server.make_server("127.0.0.1", 0, {ORIGIN})
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def get(url, origin=ORIGIN, method="GET"):
    req = urllib.request.Request(url, method=method, headers={"Origin": origin})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), b""


def test_manifest_follows_the_rules():
    raw = (PKG / "prophet-plugin.json").read_bytes()
    assert len(raw) <= 64 * 1024
    m = json.loads(raw)
    assert set(m) <= FIELDS
    assert re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", m["id"])
    assert 1 <= len(m["name"]) <= 60
    assert 1 <= len(m["version"]) <= 40
    assert m["api_version"] == 1
    assert len(m.get("description", "")) <= 300
    assert not m.get("scopes"), "Soul reads memory through prophet.api and needs no key"
    assert "connect" not in m
    assert re.fullmatch(r"/[A-Za-z0-9._~/-]{1,199}", m["script"]) and ".." not in m["script"]
    settings = m["settings"]
    assert set(settings) == {"type", "properties"} and settings["type"] == "object"
    assert len(settings["properties"]) <= 30
    for name, s in settings["properties"].items():
        assert re.fullmatch(r"[a-z][a-z0-9_]{0,39}", name)
        assert set(s) <= SETTING_KEYS
        assert s["type"] in {"string", "number", "integer", "boolean"}
        assert "default" in s
        if "minimum" in s:
            assert s["minimum"] <= s["default"] <= s["maximum"]


def test_version_matches_the_package():
    m = json.loads((PKG / "prophet-plugin.json").read_text())
    pyproject = (PKG.parents[1] / "pyproject.toml").read_text()
    assert f'version = "{m["version"]}"' in pyproject


def test_script_is_one_self_contained_file():
    js = (PKG / "omniscient.js").read_bytes()
    assert 0 < len(js) <= 2 * 1024 * 1024
    text = js.decode()
    assert "export{" in text.replace(" ", "") and "activate" in text
    assert not re.search(r"\bimport\s*[\w{*][^;]*from\s*['\"]", text), (
        "the bundle imports another file"
    )
    assert not re.search(r"\bimport\(\s*['\"]", text)


def test_serves_manifest_and_script_with_cors(base):
    status, headers, body = get(f"{base}/prophet-plugin.json")
    assert status == 200
    assert json.loads(body)["id"] == "soul"
    assert headers["Content-Type"].startswith("application/json")
    assert headers["Cache-Control"] == "no-store"
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Vary"] == "Origin"
    status, headers, body = get(f"{base}/omniscient.js")
    assert status == 200 and body
    assert headers["Content-Type"].startswith("text/javascript")


def test_other_origins_get_no_cors(base):
    status, headers, _ = get(f"{base}/prophet-plugin.json", origin="http://evil.example")
    assert status == 200
    assert "Access-Control-Allow-Origin" not in headers
    assert headers["Vary"] == "Origin"


def test_preflight(base):
    status, headers, _ = get(f"{base}/prophet-plugin.json", method="OPTIONS")
    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Access-Control-Allow-Headers"] == "Content-Type"


def test_nothing_else_is_served(base):
    for path in ("/", "/server.py", "/../pyproject.toml", "/prophet-plugin.json/../server.py"):
        assert get(f"{base}{path}")[0] == 404


def test_origins_list():
    assert server.origins("http://a:1/, http://b:2 ,,") == {"http://a:1", "http://b:2"}
    assert server.origins(None) == set()
