# Tunnel — draft configuration (NOT RUNNING)

> **STATUS: DRAFT. Nothing in this document has been started, installed or exposed.** It is the
> configuration to approve, not a record of something running.

## Shape

Two loopback HTTP servers, one Caddy in front of them, one Cloudflare Tunnel to Caddy. Nothing
else is reachable, and every unlisted path is denied at the tunnel *and* at Caddy.

```
GHL ──► Cloudflare edge ──► cloudflared (host) ──► Caddy 127.0.0.1:9080 ──┬─► /webhooks/coordination/reply  127.0.0.1:4117
                                                                          └─► /voice-turn                   127.0.0.1:4118
```

- The two Node servers bind `127.0.0.1` only (already the case in `webhook-reply-server.mjs` and
  `voice-turn-server.mjs`).
- Caddy binds `127.0.0.1:9080`. No `0.0.0.0`, no LAN.
- The tunnel's ingress list has exactly two hostname rules plus a terminal `http_status: 404`.
- The GraphQL router, the subgraphs, n8n and the GHL UI are **not** exposed.

## Caddyfile

```caddyfile
{
  auto_https off
  admin 127.0.0.1:2019
}

:9080 {
  # default deny: no route, no handler
  handle /webhooks/coordination/reply {
    reverse_proxy 127.0.0.1:4117 {
      header_up X-Real-IP {remote_host}
    }
  }

  handle /voice-turn {
    reverse_proxy 127.0.0.1:4118
  }

  handle {
    respond "not found" 404
  }
}
```

`auto_https off` because TLS terminates at Cloudflare; Caddy never holds a public certificate.

## cloudflared config

```yaml
tunnel: <tunnel-id>
credentials-file: /etc/cloudflared/<tunnel-id>.json

ingress:
  - hostname: fg.example.invalid
    path: ^/webhooks/coordination/reply$
    service: http://127.0.0.1:9080
  - hostname: fg.example.invalid
    path: ^/voice-turn$
    service: http://127.0.0.1:9080
  - service: http_status:404
```

The final catch-all is mandatory: without it cloudflared refuses to start, and with it every other
path is a 404 at the edge before Caddy is reached.

## Hostname and credentials

- A hostname owned by Bryan, not a shared or client domain. Placeholder above is intentionally
  invalid so it cannot be copy-pasted live by accident.
- Tunnel credentials live outside the repo (`/etc/cloudflared/`), never committed.
- `N8N_WEBHOOK_SECRET` and `VOICE_TURN_SECRET` stay in the servers' environment files; the Custom
  Action holds the voice-turn secret in its own secret setting.

## Why this shape

- **Separate from any client tunnel.** A LOOM/client tunnel is never reused or reconfigured.
- **Only two paths.** The reply path is HMAC-signed; the voice-turn path is the documented weaker
  boundary (§3b) and is availability-only.
- **Default deny at two layers.** Edge 404 and Caddy 404.
- **Loopback only.** If the tunnel is stopped, nothing is exposed at all.
