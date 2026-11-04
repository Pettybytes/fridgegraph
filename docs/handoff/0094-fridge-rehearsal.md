# Fridge migration 0094: rehearsal and apply handoff

Migration: `supabase/migrations/0094_fridge_item_preferences.sql`.
Apply owner: Bentley. Verification owner: Claude. No shared database apply was performed by this PR.

This is one new forward-only transaction. It adds child-scoped item preferences and replaces
`pin_media_access` with a same-child reference check. Applied migrations, including 0090, are unchanged.
The existing goals and note content, audiences, and grants are unchanged. Preferences contain only
item IDs, normalized geometry, and validated marker choices. They do not contain captions or media.

## Rehearse locally

Run from the repository root with Docker available:

```sh
node --import tsx src/rosina/pinPreferences.proof.ts
```

The script creates its own loopback-only disposable Postgres container, applies the curated real
schema/auth/Fridge migration prerequisites, and seeds fictional identities. It reproduces the old
cross-child media authorization before applying 0094, then verifies the corrected refusal, legitimate
media access, co-parent persistence, scoped reads, write refusals, geometry/style validation,
direct-DML refusal, revoked note visibility, and Tidy preserving marker styles. It removes its own
container on completion. It neither reads project environment files nor connects to the shared DB.

Browser rehearsal uses the production preference HTTP handler against another disposable Postgres:

```sh
node --import tsx src/rosina/pin-fixtures/preferences-server.ts
npm --prefix web run dev -- --host 127.0.0.1 --port 5195 --strictPort
npx --prefix web playwright test -c web/src/features/fridge/preferences.playwright.config.ts
```

Run the first two commands in separate terminals. The fixture API binds only to `127.0.0.1:5197`.
The browser test bridges the fixture page's preference requests to that API, without mocking database
responses. It verifies photo/sticky drag, keyboard arrangement, marker color/font, full reload,
Andre in a separate browser context, and Tidy on desktop and 390x844. Stop the fixture API with Ctrl-C
to remove its container. The fixture HTML is a development-only source entry, not a public build entry.

## Bentley's established catalog apply path

1. Reserve the normal apply window and identify the intended database through the established
   catalog workflow. Do not use `db push` or assume the migration ledger matches deployed objects.
2. Read the prerequisite catalog: `children`, `fridge_notes`, `goals`, `pin_media`, `is_parent_of`,
   `has_scope`, and `pin_media_access(text)` must exist. Confirm their signatures and Fridge column
   types match this branch. Confirm `fridge_item_preferences` and both new RPCs are absent. Stop on
   drift or an already-present 0094 object; do not edit an old migration or blindly rerun CREATEs.
3. Rehearse using the disposable commands above. Review 0094, then apply that exact file as one
   transaction through the established catalog path. No content backfill or reset is required.
4. Verify the post-apply catalog with read-only checks:

```sql
select relrowsecurity, relforcerowsecurity
from pg_class where oid='public.fridge_item_preferences'::regclass;
select has_table_privilege('authenticated','public.fridge_item_preferences','SELECT') as read_allowed,
       has_table_privilege('authenticated','public.fridge_item_preferences','INSERT') as direct_insert,
       has_table_privilege('authenticated','public.fridge_item_preferences','UPDATE') as direct_update,
       has_table_privilege('authenticated','public.fridge_item_preferences','DELETE') as direct_delete;
select proname, prosecdef, proconfig
from pg_proc where oid in (
 'public.read_fridge_preferences(text)'::regprocedure,
 'public.save_fridge_preference(text,text,text,jsonb,text,text,boolean)'::regprocedure,
 'public.pin_media_access(text)'::regprocedure);
select has_function_privilege('anon','public.pin_media_access(text)','EXECUTE') as anon_media,
       has_function_privilege('anon','public.read_fridge_preferences(text)','EXECUTE') as anon_read,
       has_function_privilege('anon','public.save_fridge_preference(text,text,text,jsonb,text,text,boolean)','EXECUTE') as anon_write;
```

Expect both RLS flags true; authenticated SELECT true and direct writes false; read RPC invoker,
save/media RPCs definer with fixed public search path; all anonymous execution flags false.
Inspect `pg_get_functiondef('public.pin_media_access(text)'::regprocedure)` to confirm the reference
join requires both the asset ID and its actual child ID. Authenticated RPC execution must be present.

5. Deploy/restart the Rosina pin service and frontend from the merged SHA together. The new
   `/api/rosina/pin/preferences` GET/POST routes use the caller's bearer. Until this migration and
   API are available, arrangement controls stay disabled with a retry message. There is no browser
   storage fallback or silent migration of old browser-local layouts.
6. On the served build at 5189, run the existing live acceptance suite:

```sh
FRIDGE_TEST_URL=http://127.0.0.1:5189 npx --prefix web playwright test -c web/src/features/fridge/playwright.config.ts
```

Record the served SHA, not just the checkout SHA. Kendra's photo upload must show preview/caption/Add
without document extraction; caption edits, sticky CRUD and whiteboard changes must survive reload.
Move a photo and sticky, reload, then inspect as Andre in a separate browser. Change a goal's marker
and font and verify in both browsers. Tidy must reset positions across browsers without clearing
marker styles. Verify a denied cross-child media ID returns no bytes. Keep exposure local until
these checks pass. This note records a rehearsal procedure, not a claim that 0094 was applied live.

## Recovery

If the transaction fails, inspect the catalog and error before retrying; PostgreSQL rolls the
transaction back. After a successful apply, leave the additive table/functions in place if the app
must be rolled back. Do not roll back the child-binding fix. Any corrective SQL is another reviewed
forward migration. Tidy is the authorized parent action for resetting positions; it does not delete
notes, goals, media, or marker choices. Deleted content has no visible preference entry because reads
remain bound to the existing item's visibility. No reset machinery is changed by this migration.
