# "Pin it to the fridge" — sample documents (fictional)

Exact-text sample documents for the pin demo. Each `.html` is the source of truth;
`ops/render-pin-samples.mjs` renders it (Playwright + headless Chromium, **no model/stack call**)
into PNG + PDF under `web/public/samples/pin/`, so the text is **readable in the actual image/PDF**
— a valid extraction proof (blank art with browser-only overlay text would not be).

| Sample | Files | Pins as |
| --- | --- | --- |
| Permission slip | `permission-slip.html` → `…/pin/permission-slip.{png,pdf}` | `permission_slip` (parents-only; pinning does **not** sign/submit) |
| Report card | `report-card.html` → `…/pin/report-card.{png,pdf}` | `report_card` (parents-only) |
| Appointment card | `appointment-card.html` → `…/pin/appointment-card.{png,pdf}` | `appointment_card` (pinning does **not** book) |

Fictional only (child "Nora Ellison", Lincoln Elementary = `g_school`). Re-render:
`node ops/render-pin-samples.mjs`.
