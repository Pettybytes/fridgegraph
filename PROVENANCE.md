## Built during the hackathon (from Oct 26, 2026)

All application code, schemas, fixtures, and docs in this repository were written from scratch
during the Meta Global AI Developer Hackathon, starting Oct 26, 2026. No code was copied from
any pre-existing private repository.

## External services and libraries (not our code)

- Meta Model API (used in a later milestone)
- Apollo Router / Rover / MCP Server (local federation tooling)
- Supabase (later)
- GoHighLevel (later; agent built new this week)
- n8n (later; workflows built new this week)

## Identity (Milestone 2A)

- **Supabase Auth** issues the JWTs. No tokens, keys or signing material in this repository.
- **jose** (MIT) verifies signatures locally. It is a verifier only; it mints nothing.
- Demo credentials live in `.demo-credentials` (gitignored, mode 600) and the server-side identity
  map in `data/identity-map.json` (gitignored, mode 600). Neither is committed, and the servers never
  read `.demo-credentials`.
