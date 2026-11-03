# sky-backdrop provenance

- Source: the FridgeGraph public landing's cloud-sky image, downloaded 2026-11-03 from
  `https://framerusercontent.com/images/FzdC14gXmToAITCtvyUakmsjgwI.png` on Bryan's explicit
  instruction (QA pristine task, item 1) to self-host it under `web/public`.
- `sky-backdrop.png` is the original (3344x1882). The `-640/-1280/-2000.webp` variants were
  generated locally with cwebp -q 82 for the responsive srcset and the body background.
- Used as the ONE app-wide backdrop: `body` in `src/index.css` and the Mission Control pulse
  (`features/mission-control/pulse/VillagePulse.tsx`). Replaced the previous
  `src/assets/pulse-backdrop-*.webp` mountain photo, removed with this change.
