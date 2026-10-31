# Reset restores the fixtures

- endpoint: `http://127.0.0.1:4101/__reset` (same Node process, shared in-memory store)
- HTTP status: 200

## Response

```json
{"ok":true,"reset":true,"db":{"deleted":{"relationships":14,"grants":4,"approvals":2,"events":90,"coordination_jobs":2}}}
```
