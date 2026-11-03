# Fridge personalization — offline review

Base: 674cb8dab462f887d5cd1005b8410a38ed647052.
Branch/worktree: feat/fridge-personalization / fridgegraph-fridge-personalization.
Capture UI: 9df74a9 (frozen source; final manifest and navigation follow-ups included).
Own preview 5244. Zero backend requests; memory mock adapters only. One offline-preview label and the app demo banner identify the evidence. No live, deployment, HANDOFF, backend, permission or dependency changes.

## Family mapping and artwork

The supplied approved Ellison manifest is copied unchanged from docs/evidence/154-pack/pack-manifest.json to web/public/fridge/packs/ellison/manifest.json. All 12 existing responsive Muse assets appear in its album. The versioned registry also explicitly lists the prior dinner paper and save-the-date artwork (13 image previews, one DOM-only note). The 12-asset source/provenance/hashes/prompts remain unchanged. The curated door subset is unchanged.

Canonical seed household membership in src/fixtures.ts: p_nora / p_max / p_leo -> h_a -> v_nora. h_b shares that village. Pack selection takes the currently selected child ID, not names, the adult, a relationship label or an inferred permission. Co-parents viewing the same child and siblings therefore resolve consistently; caregiver selection uses that same child mapping. No other pack was supplied in the available manifest. All unknown/new family IDs get an empty decorative collection and warm neutral fridge, never generic people from another family. No art is passed into Rosina or a factual reader.

## Album persistence gap

Inspected merged src/subgraphs/village.ts postFridgeNote/updateFridgeNote and FridgeNote reads, plus docs/contracts/fridge-notes.md §§2, 4. attachmentRef is currently a nullable raw string copied into storage and returned. There is no pack asset-ID validation, child/family association check or authorized attachment loader. The reserved column and deployed UI are insufficient.

Smallest proposed backend addition (not implemented here): validate existing attachmentRef values against an authoritative pack/asset registry and the target child's family before existing post/update mutations accept them; authorize parent/guardian changes and refuse guide writes; on subsequent fridgeNotes/attachment reads revalidate caller-child access and resolve only those validated IDs. Preserve null for explicit removal, immutable child/author ownership, server-confirmed replace/remove results and idempotency. Never accept arbitrary URLs or foreign-pack references. Backend owner must publish the final wire semantics before browser persistence is enabled.

The album browser therefore selects a large preview only. Pin is disabled for parents; guide/caregiver have no pin controls. No local pin/save simulation or note mutation occurs. Device upload retains its separate unavailable gate. Existing goal/note editing rollout remains off in production.

## Navigation profile

Local Vite at 1440×900, no network/CPU throttling, mounted mock App, memory adapters; meaningful content = recorded-goal DOM. Not a live-backend or hosted-production benchmark. Ten same-context warm transitions each run.

Before: cold 535.2 ms; warm 17.1–89.7 ms (median 33.2 ms).
Early after: cold 533.7 ms after a 500 ms hover preparation; warm 21.9–115.3 ms (median 52.1 ms).
The cached-navigation <150 ms target was met in both runs. Cold results did not materially improve, and warm times regressed in this sample; no broader latency claim is made. Other local tasks were active. Raw resource/timing receipts are navigation-before.txt and navigation-after.txt.

Measured image benefit: matching dog/Navy/kitchen overview transfers 299,858 -> 108,574 bytes (~64% less), using the existing 360px tier instead of 720px. Full-resolution zoom/enlarged views remain available.

Hover/focus imports the fridge module only; no adapter method or family read runs from prefetch. Existing React.lazy/module caching is reused. No private record cache or retained mounted route was introduced. Data readers still use current authorization and cancel/discard on unmount. The new key includes session, viewer, selected child, role and observed authorization state, so a permission change immediately removes old content/dialogs and rejects late responses.

## Verification

- Six desktop/phone captures: family door, large album preview and neutral missing-pack fridge. Preview pin stays disabled; switch to Jax reveals no Ellison artwork.
- Targeted tests cover canonical siblings/unknown IDs, album capability absence/read-only guide, immediate permission-change clearing/late response rejection, and mounted confirmed post/edit/remove/failure/persona behavior.
- Existing navigation, capability, confirmed-edit, empty/refused/failure and privacy assertions remain. Copy expectations reflect the requested badge removal and neutral missing-pack behavior.
- An initial concurrent focused run timed out waiting for mounted notes; initial-mounted-timeout.txt preserves it. The unchanged mounted test passes when rerun on its own; final full-suite results are recorded separately.
- Build/typecheck and root typecheck pass. Existing bundle-size warning remains.
- Preview entries are outside production dist. No third-party font or art requests were added.

## Final versioned loader and navigation follow-up

Bryan confirmed there is no newer multi-family manifest. The v1 registry and parser now accept family/child keys, stable asset IDs, kind, responsive sources, alt text, optional DOM-copy and placement. New-family additions are tested as data only. Exact shape and persistence dependency were posted for Bentley at https://github.com/Pettybytes/fridgegraph/pull/175#issuecomment-6594426012. See PACK-MANIFEST.md.

The frozen v1 profile under concurrent local tests had warm outliers up to 488.5 ms (navigation-loaded-v1.txt); this is preserved and does not meet the target uniformly. A route-only React transition avoids waiting on the lazy route fallback while authorization/session changes remain urgent. Final profile (navigation-final.txt): cold 198.5 ms after 500 ms hover preparation; cached warm 15.6–113.8 ms, median 50.4 ms. All ten final cached transitions meet the <150 ms target under those measured local mock conditions. No hosted/live-backend guarantee is claimed.

Two full-suite attempts exited 137 before completion. The second coincided with another worktree invoking the global pkill -9 -f vitest command. Partial receipts are preserved. An interim run overlapped the requested v1 shape change and saw its old 12-preview expectation versus the new 13-image collection; it was cancelled on this worktree alone and restarted after freezing source. No assertions were weakened.

The complete earlier run had 583/584 passing, with RosinaPanel scripted acceptance “What can I do here?” timing out at the unchanged 5000 ms limit. first-complete-suite.txt preserves it. An unchanged isolated rerun passed 16/16; the final full-suite result is recorded in web-tests.txt. Timeouts and assertions were not increased or weakened.

Final frozen-source verification: 584/584 tests across 97 files pass (two workers; 1024 MB heap; original assertions and timeouts). Web build/typecheck, root typecheck and secret scan pass. Final capture revision 9df74a9; subsequent evidence commits do not change its UI. All six captures are offline, with zero backend request attempts.
