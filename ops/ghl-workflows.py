#!/usr/bin/env python3
"""ops/ghl-workflows.py — list FridgeGraph GHL workflows and summarise their triggers.

Reads the token from .env inside the process, so it never appears in argv or in the output.
Only the FridgeGraph location is touched.

    python3 ops/ghl-workflows.py [--all]
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://services.leadconnectorhq.com"


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


def call(env, path):
    req = urllib.request.Request(API + path, method="GET")
    req.add_header("Authorization", "Bearer " + env["GHL_API_KEY"])
    req.add_header("Version", "2021-07-28")
    req.add_header("Accept", "application/json")
    # Cloudflare in front of GHL returns 1010 for urllib's default agent.
    req.add_header("User-Agent", "fridgegraph-ops/1.0")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main(argv):
    show_all = "--all" in argv
    env = load_env(ROOT / ".env")
    loc = env.get("GHL_LOCATION_ID", "")
    print(f"location {loc}")
    data = call(env, "/workflows/?" + urllib.parse.urlencode({"locationId": loc}))
    wfs = data.get("workflows", [])
    print(f"workflows returned: {len(wfs)}")
    want = [w for w in wfs if "fg" in (w.get("name") or "").lower()]
    for w in (wfs if show_all else want):
        print(f"  {w.get('id')}  state={w.get('status')}  {w.get('name')}")
    if not show_all and not want:
        print("  (no name contained 'fg')")
    if want:
        print("\n--- detail ---")
        for w in want:
            try:
                d = call(env, f"/workflows/{w['id']}")
            except Exception as e:  # noqa: BLE001
                print(f"{w.get('name')}: detail failed: {e}")
                continue
            print(json.dumps(d, indent=1)[:6000])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
