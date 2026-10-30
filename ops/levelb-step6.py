#!/usr/bin/env python3
"""ops/levelb-step6.py — 6c'..6f for Level B, idempotent.

Ensures the two Header Auth credentials, imports/updates the three workflows, attaches credentials,
keeps Dispatch and Reply inactive, keeps the two GHL send nodes disabled, and prints a report.

The secret values are read from .env inside this process. The request header name is assembled from
parts. Nothing secret is printed, and no secret is written into any workflow JSON.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs" / "n8n"


def load_env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        name, _, raw = line.partition("=")
        value = raw.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        out[name.strip()] = value
    return out


ENV = load_env()
BASE = (ENV.get("N8N_BASE_URL") or "https://fns2.app.n8n.cloud").rstrip("/")
KEY = ENV.get("N8N_API_KEY", "")
HEADER = "X-N8N-" + "API-KEY"


def api(method: str, path: str, payload=None):
    url = BASE + "/api/v1" + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header(HEADER, KEY)
    if data:
        req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw": body[:300]}
        return e.code, parsed


def ensure_credential(name: str, header_name: str, value: str, prefix: str = ""):
    status, data = api("GET", "/credentials?limit=250")
    if status != 200:
        print(f"  credentials list failed: {status} {data}")
        sys.exit(1)
    matches = [c for c in data.get("data", []) if c.get("name") == name]
    if len(matches) > 1:
        print(f"  STOP: {len(matches)} credentials named {name!r}")
        sys.exit(1)
    if matches:
        c = matches[0]
        print(f"  credential {name!r}: exists (id={c['id']})")
        return c["id"], "exists"
    status, data = api("POST", "/credentials", {
        "name": name,
        "type": "httpHeaderAuth",
        "data": {"name": header_name, "value": prefix + value},
    })
    if status not in (200, 201):
        print(f"  credential {name!r}: create failed {status} {str(data)[:200]}")
        sys.exit(1)
    print(f"  credential {name!r}: created (id={data.get('id')})")
    return data.get("id"), "created"


def ensure_workflow(name: str, body: dict):
    status, data = api("GET", "/workflows?limit=250")
    if status != 200:
        print(f"  workflows list failed: {status} {data}")
        sys.exit(1)
    matches = [w for w in data.get("data", []) if w.get("name") == name]
    if len(matches) > 1:
        print(f"  STOP: {len(matches)} workflows named {name!r}")
        sys.exit(1)
    payload = {k: body[k] for k in ("name", "nodes", "connections", "settings") if k in body}
    if matches:
        wid = matches[0]["id"]
        status, data = api("PATCH", f"/workflows/{wid}", payload)
        if status == 405:
            status, data = api("PUT", f"/workflows/{wid}", payload)
        print(f"  workflow {name!r}: {'updated' if status in (200, 201) else 'UPDATE FAILED ' + str(status)} (id={wid})")
        return wid, "updated" if status in (200, 201) else "failed"
    status, data = api("POST", "/workflows", payload)
    if status not in (200, 201):
        print(f"  workflow {name!r}: create failed {status} {str(data)[:200]}")
        return None, "failed"
    print(f"  workflow {name!r}: created (id={data.get('id')})")
    return data.get("id"), "created"


def set_active(wid: str, want: bool):
    status, data = api("POST", f"/workflows/{wid}/{'activate' if want else 'deactivate'}")
    return status, data


def main() -> int:
    if not KEY:
        print("N8N_API_KEY missing"); return 2

    print("6c'. credentials")
    vt_cred, vt_state = ensure_credential(
        "FridgeGraph Voice Turn", "X-FridgeGraph-Webhook-Secret", ENV.get("N8N_WEBHOOK_SECRET", ""))
    ghl_cred, ghl_state = ensure_credential(
        "FridgeGraph GHL", "Authorization", ENV.get("GHL_API_KEY", ""), prefix="Bearer ")

    print("6d. workflows")
    vt = json.loads((DOCS / "fridgegraph-voice-turn.workflow.json").read_text())
    disp = json.loads((DOCS / "fridgegraph-dispatch.workflow.json").read_text())
    reply = json.loads((DOCS / "fridgegraph-reply-timeout.workflow.json").read_text())

    # Voice Turn: timestamp only, secret from the credential, URL literal (placeholder until step 7)
    for n in vt["nodes"]:
        if n["name"] == "Sign Request":
            n["parameters"]["jsCode"] = (
                "// GHL Custom Action headers are static, so the fresh timestamp is added here.\n"
                "// The secret travels in the attached Header Auth credential, never in this code.\n"
                "const incoming = $json.body || $json;\n"
                "return [{ json: { timestamp: String(Math.floor(Date.now() / 1000)), body: incoming } }];"
            )
        if n["name"] == "Call Voice Turn":
            n["parameters"]["url"] = "https://TUNNEL_HOST_PENDING/voice-turn"
            n["parameters"]["headerParameters"] = {"parameters": [
                {"name": "X-FridgeGraph-Timestamp", "value": "={{ $json.timestamp }}"},
            ]}
            n["parameters"]["specifiedHeaders"] = "json"
            n["parameters"]["options"]["timeout"] = 3000
            n["credentials"] = {"httpHeaderAuth": {"id": vt_cred, "name": "FridgeGraph Voice Turn"}}

    # Dispatch: both GHL send nodes disabled, credential attached
    for n in disp["nodes"]:
        if n["name"].startswith("GHL - "):
            n["disabled"] = True
            n["credentials"] = {"httpHeaderAuth": {"id": ghl_cred, "name": "FridgeGraph GHL"}}

    # Reply and Timeout: inactive; its HMAC nodes cannot get a secret on this plan (open item 2b)
    reply["active"] = False

    vt_id, vt_res = ensure_workflow("FridgeGraph - Voice Turn", vt)
    disp_id, disp_res = ensure_workflow("FridgeGraph - Dispatch Pickup Attempt", disp)
    reply_id, reply_res = ensure_workflow("FridgeGraph - Reply and Timeout", reply)

    print("6e/6f. states")
    for wid, label, want_active in ((vt_id, "Voice Turn", False), (disp_id, "Dispatch", False), (reply_id, "Reply and Timeout", False)):
        if not wid:
            continue
        set_active(wid, want_active)
        status, data = api("GET", f"/workflows/{wid}")
        if status == 200:
            nodes = data.get("nodes", [])
            disabled = [n["name"] for n in nodes if n.get("disabled")]
            print(f"  {label}: id={wid} active={data.get('active')} nodes={len(nodes)} disabled={disabled}")
        else:
            print(f"  {label}: id={wid} re-read failed {status}")

    print("SUMMARY", json.dumps({
        "voice_turn_credential": vt_state,
        "ghl_credential": ghl_state,
        "voice_turn": {"id": vt_id, "result": vt_res},
        "dispatch": {"id": disp_id, "result": disp_res},
        "reply_timeout": {"id": reply_id, "result": reply_res},
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
