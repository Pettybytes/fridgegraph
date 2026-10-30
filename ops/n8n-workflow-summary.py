#!/usr/bin/env python3
"""ops/n8n-workflow-summary.py — summarise one n8n workflow without dumping its body.

The generic helper truncates responses at 20 KB, which is enough to break JSON parsing on a large
workflow. This reads the key from .env inside the process (never in argv) and prints only the fields
an operator needs to confirm a deploy:

    python3 ops/n8n-workflow-summary.py <workflow-id>
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path) -> dict:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        name, _, raw = line.partition("=")
        value = raw.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        out[name.strip()] = value
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    wf_id = argv[1]
    env = load_env(ROOT / ".env")
    key = env.get("N8N_API_KEY", "")
    base = (env.get("N8N_BASE_URL") or "https://fns2.app.n8n.cloud").rstrip("/")
    if not key:
        print("N8N_API_KEY missing from .env", file=sys.stderr)
        return 2

    req = urllib.request.Request(f"{base}/api/v1/workflows/{wf_id}")
    req.add_header("X-N8N-" + "API-KEY", key)
    with urllib.request.urlopen(req, timeout=30) as resp:
        w = json.loads(resp.read().decode())

    print(f"id      {w.get('id')}")
    print(f"name    {w.get('name')}")
    print(f"active  {w.get('active')}")
    print(f"updated {w.get('updatedAt')}")
    print(f"nodes   {len(w.get('nodes', []))}")
    for n in w.get("nodes", []):
        creds = n.get("credentials") or {}
        cred = next(iter(creds.values()), {}).get("name") if creds else "-"
        p = n.get("parameters", {})
        target = p.get("path") or p.get("url") or ""
        extra = []
        if n.get("type", "").endswith("webhook"):
            extra.append(f"auth={p.get('authentication', 'none')}")
        if "Sign" in n.get("name", "") or "UNSET" in json.dumps(p):
            extra.append("LEGACY-HMAC")
        print(f"  - {n.get('name'):32} {n.get('type').split('.')[-1]:14} cred={cred:26} {target} {' '.join(extra)}")
    body = json.dumps(w)
    print(f"legacy UNSET marker present: {'UNSET_SESSION_2B' in body}")
    print(f"signature nodes present    : {'Sign reply' in body or 'Sign no-answer' in body}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
