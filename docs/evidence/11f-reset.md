# Reset restores the fixtures

- endpoint: `http://127.0.0.1:4001/__reset` (same Node process, shared in-memory store)
- HTTP status: 200

## Response

```json
{"ok":true,"reset":true,"db":{"deleted":{"grants":1,"approvals":2}}}
```
