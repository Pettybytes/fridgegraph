# Mounted judge checklist — browser proof

These are Playwright Chrome captures of the integrated Today page in the **local mock demo** at 1440×1000 and 390×844. No live model, graph or reset operation was called. The October 26, 2026 school notice is historical. The browser test opened Rosina's `Add a notice`, chose the committed PNG through `Try a sample`, reviewed the recorded 12:30 PM versus 3:00 PM conflict, and confirmed once. It observed **“Mock pickup request shown”** and **“No real record was created, and pickup is not arranged yet.”**

- [Kendra, desktop](desktop-parent.png)
- [Kendra, phone: top](phone-parent-top.png), [checklist](phone-parent-checklist.png), [checklist end](phone-parent-checklist-end.png). The phone uses a scroll container, so these are successive unmodified viewport frames.
- [Demo guide, desktop](desktop-guide.png) and [phone](phone-guide.png): one read-only step, no reset button.

The component test covers dismissal and header reopening, persona transition, storage scope changes by version/persona/child/run, and the shared-reset confirmation, failure and success paths. The real build gates notice confirmation behind `VITE_NOTICE_PLAN_LIVE`; it has no browser photo-descriptor adapter, so the photo step stays hidden. The production `web/dist` output contains no `demo-checklist-preview.html`.
