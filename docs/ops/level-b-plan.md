# Level B — plan, ownership, and the commands Bryan runs

> **Hard constraint (see `docs/handoff/HANDOFF.md` §11):** Bentley cannot call authenticated
> third-party APIs from scripts he writes — the redaction layer damages the script on save. Every
> authenticated GHL or n8n call below is therefore **run by Bryan**. Bentley owns everything that
> needs no third-party auth.

Status: drafts complete in PR #9 (`feat/level-b-drafts`), nothing imported, nothing attached,
no tunnel. n8n is on hold pending the plan check.

## Ownership

| # | Step | Who | Why |
|---|---|---|---|
| 1 | Verify the six `fg_` fields in Dreemzy | **run by Bryan** | authenticated GHL read |
| 2 | Read Rosina's recording / transcription / retention | **run by Bryan** | authenticated GHL read; done in the GHL screen |
| 3 | Import the two n8n drafts, inactive | **run by Bryan** | authenticated n8n write |
| 4 | Confirm both workflows are inactive | **run by Bryan** | authenticated n8n read |
| 5 | Create the n8n Header Auth credential for GHL | **run by Bryan** | UI only; the secret never leaves the screen |
| 6 | Start Caddy + the tunnel | **Bentley** | local, no third-party auth — needs tunnel approval |
| 7 | Verify both paths answer 200 from outside | **run by Bryan** | external vantage point |
| 8 | Attach the Pickup Decision Custom Action to Rosina | **run by Bryan** | authenticated GHL write, live number |
| 9 | Web Call rehearsal | **run by Bryan** drives; **Bentley** verifies the DB/GraphQL side | call control is GHL-authenticated |

Bentley can still do, without auth: the endpoint code and tests, the tunnel config, GraphQL
verification, database checks, compose/rover work, and git.

## Commands for Bryan

Run from `~/Desktop/bentley/fridgegraph`. Each reads the secret from `.env` at runtime; none embeds
a value. Nothing here activates, calls or messages anyone unless stated.

### 1. Verify the six `fg_` fields in Dreemzy

```bash
curl -s -H "Authorization: Bearer $(grep '^GHL_API_KEY=' .env | cut -d= -f2-)" \
     -H "Version: 2021-07-28" \
     "https://services.leadconnectorhq.com/locations/$(grep '^GHL_LOCATION_ID=' .env | cut -d= -f2-)/customFields" \
| python3 -c "import sys,json; d=json.load(sys.stdin); print(sorted(f['name'] for f in d.get('customFields',[]) if f['name'].startswith('fg_')))"
```

Expect all six: `fg_attempt_id, fg_child_name, fg_pickup_place, fg_pickup_time, fg_reason, fg_requester_name`.

### 2. Rosina's settings

GHL screen: AI Agents → Rosina → settings. Record **recording** (expect off), **transcription**
(expect on, needed for the reply pipeline), **retention** (expect shortest available). No command
needed; tell Bentley the three values and he'll record them in the contract docs.

### 3. Import both drafts, inactive

```bash
for f in docs/n8n/fridgegraph-dispatch.workflow.json docs/n8n/fridgegraph-reply-timeout.workflow.json; do
  curl -s -X POST \
    -H "X-N8N-API-KEY: $(grep '^N8N_API_KEY=' .env | cut -d= -f2-)" \
    -H "content-type: application/json" \
    --data @"$f" "https://fns2.app.n8n.cloud/api/v1/workflows" \
  | python3 -c "import sys,json; w=json.load(sys.stdin); print(w.get('id'), '|', w.get('name'), '| active =', w.get('active'))"
done
```

Each line prints an id — **send Bentley those two ids**. The drafts carry `"active": false`; if any
line prints `active = True`, deactivate it before doing anything else:

```bash
curl -s -X POST -H "X-N8N-API-KEY: $(grep '^N8N_API_KEY=' .env | cut -d= -f2-)" \
  "https://fns2.app.n8n.cloud/api/v1/workflows/<ID>/deactivate"
```

### 4. Confirm both are inactive

```bash
for id in <ID1> <ID2>; do
  curl -s -H "X-N8N-API-KEY: $(grep '^N8N_API_KEY=' .env | cut -d= -f2-)" \
    "https://fns2.app.n8n.cloud/api/v1/workflows/$id" \
  | python3 -c "import sys,json; w=json.load(sys.stdin); print(w['id'], w['name'], 'active =', w['active'])"
done
```

Expect `active = False` twice.

### 5. Create the GHL Header Auth credential (UI)

n8n → Credentials → New → **Header Auth**:
- Name: `FridgeGraph GHL`
- Header Name: `Authorization`
- Header Value: `Bearer` + a space + the Dreemzy PIT

Attach it to the two GHL nodes in the dispatch workflow. They remain **disabled**.

## After import — what Bentley still needs

- The two workflow ids (step 3), to record in this plan.
- Confirmation both are inactive (step 4).
- The three Rosina settings values (step 2).

## Still gated on approval

- Tunnel start (step 6) — Bentley runs it only after explicit approval.
- Custom Action attach (step 8) — only after step 7 passes and one rehearsal has succeeded.

Nothing in this plan places a call, sends an SMS, or activates a workflow.
