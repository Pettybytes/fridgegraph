# 23 — Muse's first real call: MCP `PickupCandidates` as the caller

- Run: 2026-10-28T20:13Z (local 16:13 EDT)
- Worktree: `/Users/user/orca/workspaces/fridgegraph/muse-first-call`, branch `feat/muse-first-call`
- Client: `src/muse/` — `providers.ts` (one `chat()` behind two providers), `mcp.ts` (MCP client),
  `index.ts` (`runMuse`), `run.ts` (CLI)
- MCP: `http://127.0.0.1:5051/mcp` (Apollo MCP Server v2.1.0) → offline router `127.0.0.1:4012`
- Model that executed the call: **`meta-models/muse-spark-open-1026`** on Baseten — see the
  provider note below; the Meta Model API path is blocked in this environment.

## Identity: Muse acts AS the caller, with no credential of its own

Muse holds exactly one credential — the caller's own Supabase JWT, obtained by a real password
grant for that person. It is passed to the MCP server and nowhere else.

Call sites (quoted):

```
src/muse/mcp.ts:58
        authorization: `Bearer ${this.bearer}`,

src/muse/index.ts:139-141
export async function runMuse(options: MuseOptions): Promise<MuseResult> {
  const config = resolveProvider(options.provider);
  const mcp = new McpToolClient(options.mcpUrl, options.bearer);

src/muse/run.ts:88
  const bearer = await signIn(person);
```

There is no service-role key anywhere in `src/muse/` and no pinned user id: the only identity is
whatever the token proves. `grep -rn SERVICE_ROLE src/muse/` returns nothing.

## Request, without keys

The exact command (no key, token or password appears on the command line):

```
npx tsx src/muse/run.ts --provider baseten --person p_mom --child p_nora \
    --as-of 2026-10-26 --mcp http://127.0.0.1:5051/mcp --json
```

Prompt given to the model:

```
Nora needs an early pickup. Who should we ask first, and who else is available?

childId=p_nora asOf=2026-10-26
```

System constraint, verbatim from `src/muse/index.ts`:

```
1. You MUST call the PickupCandidates tool before answering. You have no other source of truth.
2. Use ONLY people, reasons, contact details and availability that appear in the tool result.
   Never add a person, a phone number, a vehicle or a relationship that is not in the result.
3. If the tool returns no candidates or an error, say so plainly. Do not invent alternatives.
```

## Raw tool calls

```json
[
  {
    "round": 1,
    "name": "PickupCandidates",
    "arguments": { "childId": "p_nora", "asOf": "2026-10-26" },
    "isError": false,
    "errorCodes": [],
    "candidateCount": 4,
    "latencyMs": 1989
  }
]
```

The tool result carried 4 candidates: Loretta Brooks, Bryan Brooks, Tasha Ellison, Monique Davis
(same set as evidence 16b, reached through the MCP server with Kendra's own token).

## Response

```
1. Loretta Brooks — "grandmother — transport.child offered, pickup.request grant valid 2026-10-26" — CALL +1-313-555-0103 — UNKNOWN
2. Tasha Ellison — "aunt + godmother — transport.child offered, pickup.request grant valid 2026-10-26" — SMS +1-313-555-0107 — UNKNOWN
3. Bryan Brooks — "uncle — transport.child offered, pickup.request grant valid 2026-10-26" — SMS +1-313-555-0104 — UNKNOWN
4. Monique Davis — "parent_friend — transport.child offered, pickup.request grant valid 2026-10-26" — SMS +1-313-555-0108 — UNKNOWN
Recommend first: Loretta Brooks via CALL +1-313-555-0103
```

Grounding check (`assessGrounding`, computed in `src/muse/index.ts`) — the answer contains no name,
phone number or person that was not in the tool result:

```json
{
  "namesInToolResult": ["Loretta Brooks","Bryan Brooks","Tasha Ellison","Monique Davis"],
  "namesInAnswer":     ["Loretta Brooks","Bryan Brooks","Tasha Ellison","Monique Davis"],
  "unsupportedPhoneNumbers": [],
  "possibleInventedNames": [],
  "grounded": true
}
```

Tokens: prompt 2081, completion 1512, total 3593. Two model rounds, 6503 ms total
(1261 ms tool-calling round, 3251 ms answer round).

## Negative test — a caller without pickup rights

`p_walter` is Nora's grandfather. He holds `schedule.read` and `goals.read` for her and is **not**
a parent, so `requirePickupAccess` must refuse him. Same command, same tool, different token:

```
npx tsx src/muse/run.ts --provider baseten --person p_walter --child p_nora \
    --as-of 2026-10-26 --mcp http://127.0.0.1:5051/mcp --json
```

```json
[ { "round": 1, "name": "PickupCandidates",
    "arguments": { "childId": "p_nora", "asOf": "2026-10-26" },
    "isError": true, "errorCodes": ["UNAUTHORIZED"], "candidateCount": null,
    "latencyMs": 345 } ]
```

Model answer:

```
Tool returned UNAUTHORIZED error for childId p_nora asOf 2026-10-26.
No candidates available.
```

- Result: **refused by the existing auth path**, not by a Muse-side check and not by an empty list.
  `UNAUTHORIZED` is raised by `requirePickupAccess` in `src/subgraphs/access.ts`.
- The model did not invent candidates and did not retry with different arguments.
- No auth was bypassed to make this demonstration work.

## Provider note — Meta Model API is BLOCKED here

The first-call attempt was made against the Meta Model API first. It refuses before any network
call, because the environment does not describe it:

```
$ npx tsx src/muse/run.ts --provider meta --person p_mom --child p_nora --smoke --json
BLOCKED MUSE_CONFIG_MISSING: provider "meta" requires META_BASE_URL, META_MODEL_ID
missing_fields=META_BASE_URL,META_MODEL_ID provider=meta
```

`.env` contains `META_API_KEY` but **not** `META_BASE_URL` or `META_MODEL_ID`, and no value for
either exists in the repo, docs or sibling projects. No endpoint was invented to work around it:
calling a guessed URL would not be evidence of a Meta call. The Meta call site, once configured,
is `src/muse/providers.ts:117` — `${config.baseUrl}/chat/completions` with
`Authorization: Bearer ${config.apiKey}` at line 130.

The identical loop was therefore executed on Baseten, Meta's approved open-weights host, using
`meta-models/muse-spark-open-1026`. That is a real model call through the real MCP path as the
real caller — but it is **not** a Meta-hosted Muse Spark call, and is not reported as one.

## What this proves, and what it does not

Proves: a real model, given real tools, called the graph as the signed-in caller, ranked the real
candidates with the graph's own reasons, and was refused when the caller lacked rights.

Does not prove: a Meta-hosted Muse Spark or Muse Wonder call, or the Meta plan-limit behaviour.
Those remain blocked on two missing environment values (see above).
