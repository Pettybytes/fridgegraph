# Orbit visual replay — fictional presentation proof

The preview at `web/orbit-visual-preview.html` uses local, fixed illustrative `Alert` shapes. It has no adapter, authenticated read, activation, notification, or mutation path. Its audience IDs follow Nora's `orbit_notify_eligible` policy in `src/fixtures-simulated.ts` (`p_dad,p_gma,p_bryan`), but the responses and timestamps are a staged demonstration, not recorded history. The parent closes the fixture explicitly at the final beat.

The same `OrbitConstellation` and `OrbitResolution` presentation components render the live Orbit state. Live activation and closure remain gated by the existing controller's server-confirmed records. The recipient view remains limited to its own audience row and response; after a found-safe close, the controller strips the photo, place, descriptors, message, and other participants before rendering.

Captures from the local preview:

- Desktop active, light/dark: `desktop-active-light.png`, `desktop-active-dark.png`.
- Desktop resolution, light/dark: `desktop-resolution-light.png`, `desktop-resolution-dark.png`.
- Phone active, light/dark: `phone-active-light.png`, `phone-active-dark.png`.
- Phone resolution, light/dark: `phone-resolution-light.png`, `phone-resolution-dark.png`.
- `full-sequence.webm`: browser recording of the timed preparation → active → responses → parent close sequence. No audio is used.

The preview's Capture response and Capture resolution controls pause at deterministic fixture frames. Colors identify recorded state; response labels and times remain visible without relying on color. The media above are fixture captures, not a live alert proof.
