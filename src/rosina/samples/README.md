# Notice → Plan sample kit (fictional)

Exact-text sample notices for the "Try a sample" tray. Each sample's `.html` is the single source
of truth; `ops/render-notice-samples.mjs` renders it (Playwright + headless Chromium, no network)
into PNG + PDF committed under `web/public/samples/notice-plan/` so the on-page text is **exact**
(never model-generated). Samples go through the **same** pipeline as a manual drop.

| Sample | Files | Scenario |
| --- | --- | --- |
| (a) early dismissal | `notice-a-early-dismissal.{html,txt}` → `web/public/samples/notice-plan/notice-a-early-dismissal.{png,pdf}` | Lincoln Elementary (`g_school`), early dismissal **12:30 PM** on **2026-10-26**, conflicting with `p_nora`'s recorded **15:00** dismissal |
| (b) ambiguous | _planned_ | needs the one clarifying question (§4b) |
| (c) field trip / permission slip | _planned_ | review-only (§1.2) |

- `.txt` is the pasted-text form (the verified-quote path); `.png`/`.pdf` are the image/PDF forms
  (model-transcription path). All three carry identical text.
- School matched **by id** (`g_school`), per `docs/handoff/VILLAGE-MAP-CONTRACT.md`, not by name.
- Fictional only: invented principal name, no real address/phone/logo.

Re-render: `node ops/render-notice-samples.mjs` (installs nothing; expects a resolvable `playwright`).
