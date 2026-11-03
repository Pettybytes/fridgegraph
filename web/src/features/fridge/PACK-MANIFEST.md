# Decorative pack manifest v1

Coordination proposal for Bentley: PR #175, comment 6594426012. This is decorative frontend data, not a backend permission or persistence contract. The original approved Ellison provenance manifest and responsive files remain unchanged.

The bundled registry lives at web/public/fridge/packs/manifest.v1.json. Its shape is defined by PackManifest in packManifest.ts:

- version: exactly 1; unsupported or malformed registries produce a neutral fridge.
- packs: id, familyKey, childKeys, assetRoot, assets.
- asset: stable id; kind (photo/form/drawing/keepsake/note/event); responsive sources (src + pixel width); meaningful alt text; optional domCopy (title/body/lines); optional image-relative placement (x/y/width/rotation/magnet).
- A source-free note requires DOM content; image assets use approved local responsive sources. Source URLs stay in the declared pack directory or the approved shared decorative sample directory. No arbitrary URLs or traversals.
- Placement is optional: omitted assets appear in the album, placed assets also appear on the door. No family names or adult roles are used for resolution.

The selected canonical child key selects the pack. Current seed membership maps Nora, Max and Leo's IDs into the Ellison family village. Add another approved family through manifest data and responsive files; no React or TypeScript changes are needed. No supplied pack means no inherited decorative people. Child keys in the manifest do not authorize access to private records.

The original 12 Muse assets retain their IDs and provenance. The v1 registry also explicitly lists the previously approved decorative dinner paper and Higgsfield save-the-date artwork; DOM copy never asserts a saved invitation, consent or booking.

Album pin/replace/remove is unavailable. The backend still needs authoritative pack-ID validation bound to child/family and parent/guardian authority, plus authorized subsequent attachment reads. Existing raw attachmentRef storage is insufficient. Device upload has its own separate readiness requirements. None of these capabilities are inferred from manifest presence.
