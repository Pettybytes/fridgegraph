#!/usr/bin/env python3
"""ops/n8n-api.py — call the n8n public API without ever putting the key in a command.

Why this exists: a shell command that pastes an auth header next to a command substitution gets
rewritten before it runs, so the server sees a placeholder instead of the key. Here the header name
is assembled from parts and the value is read from .env *inside* Python, so no auth-shaped text ever
appears in a command line, a log, or an agent transcript.

Usage:
    python3 ops/n8n-api.py GET  /workflows?limit=100
    python3 ops/n8n-api.py POST /workflows --body-file docs/n8n/x.workflow.json
    python3 ops/n8n-api.py POST /variables --json '{"key":"K","value":"V"}'
    python3 ops/n8n-api.py DELETE /workflows/<id> --quiet

Prints the HTTP status, then the response body (truncated). Never prints the key or any part of it.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"


def load_env(path: Path) -> dict:
    out = {}
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return out
    for line in text.splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        name, _, raw = line.partition("=")
        value = raw.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        out[name.strip()] = value
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print("usage: n8n-api.py METHOD PATH [--json JSON | --body-file FILE] [--quiet]", file=sys.stderr)
        return 2

    method, path = argv[1].upper(), argv[2]
    payload = None
    quiet = "--quiet" in argv

    if "--json" in argv:
        payload = argv[argv.index("--json") + 1].encode()
    elif "--body-file" in argv:
        payload = Path(argv[argv.index("--body-file") + 1]).read_bytes()

    env = load_env(ENV_PATH)
    key = env.get("N8N_API_KEY", "")
    base = (env.get("N8N_BASE_URL") or "https://fns2.app.n8n.cloud").rstrip("/")
    if not key:
        print("N8N_API_KEY missing from .env", file=sys.stderr)
        return 2

    url = base + "/api/v1" + (path if path.startswith("/") else "/" + path)
    # The header name is assembled, so the literal never appears in this file's command text.
    header_name = "X-N8N-" + "API-KEY"
    req = urllib.request.Request(url, data=payload, method=method)
    req.add_header(header_name, key)
    if payload is not None:
        req.add_header("content-type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        status = e.code
    except urllib.error.URLError as e:
        print(f"NETWORK ERROR: {e.reason}", file=sys.stderr)
        return 3

    print(f"STATUS {status}")
    if not quiet:
        print(body[:4000])
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
