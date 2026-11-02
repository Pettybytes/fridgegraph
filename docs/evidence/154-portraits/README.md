# #154 — portrait set receipt (staged)

**Evidence for the reimagined 37-person cast. Staged only: production portrait files, mappings and
consumers are untouched.**

- Generated 2026-11-02 with **`muse-image-1.0`** through the existing runtime credential used in
  place. The credential is not present in this directory, its headers are not recorded, and no
  signed URL or raw base64 response is stored.
- **37 portraits**, including the three approved pilot originals (Kendra, Nora, Loretta) reused
  unchanged.
- **Cost: $0.53 CALCULATED total** from the documented $0.01/image price — 49 delivered assets plus
  4 revision calls (Loretta, Gary, Carol, kitchen candid). This is **not** an independently verified
  billing figure; the provider response carries token usage and no price field.
- **53 generation calls, zero failures** — 49 delivered assets plus 4 re-prompts. It is not a claim about any earlier
  attempt. A prior run reported 401 `invalid_api_key` from `api.meta.ai` using the `META_API_KEY`
  variable name; no request ids or timestamps were captured here, so those attempts are preserved
  as reported history **separately**, and are not included in the 49.

## Files

| Path | What |
| --- | --- |
| `portraits/<personId>.png` | 37 × 1024² originals, named by person ID |
| `contact-sheet-37.png` | labelled sheet, all 37, with a 96 px circular inset |
| `crops-32-48-96.png` | labelled 32 / 48 / 96 px circular crop comparison plus 96 px at 2× |
| `manifest.json` | person ID → name, age, group, file, model, prompt, hashes |
| `integration-map.json` | person ID → staged file → intended repo path; not applied |
| `provenance.json` | sanitized per-image provenance (model, prompt, SHA-256, usage, UTC) |
| `verification.json` | machine-checked results below |

## Verification (machine-checked)

| Check | Result |
| --- | --- |
| Portrait count | 37 |
| Unique person IDs | 37 |
| IDs exactly match `src/fixtures.ts` + `src/fixtures-cast-v2.ts` | **true** |
| `p_demo_guide` portrait present | **false** |
| Every recorded image hash matches the staged file | **true** |
| Every manifest path resolves | **true** |
| Forbidden strings in provenance (`Bearer`, `Authorization`, `sk-`, `data:image`, `b64_json`, `https://`, `secret`) | **none** |
| Cost labelled calculated, not billing-verified | **true** |

## Non-claims

- These are fictional people; no real-person reference was supplied to the model and no intentional
  impersonation is intended.
- Staging is not integration: the app still serves the old placeholder portraits, the manifest still
  maps the old files, and no consumer was touched.
- Nothing here asserts a live permission, booking, signature or graph record.
