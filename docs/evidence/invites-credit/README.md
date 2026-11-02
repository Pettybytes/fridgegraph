# Invitation provenance in exported PNG — fixture proof

Follow-up to merged #129. This is a local fictional fixture, not Muse-generated art or a live invite. The preview uses Nora from the demo cast, with a birthday at Riverside Park. The parent can still edit the event text without another art request.

The card now draws the response's provenance credit inside the quiet area, below the event details. Both the preview and the PNG download use the same canvas draw. For `FIXTURE` the line is **Sample art**; for `MUSE_IMAGE` it is **Art generated with Muse Image**, whether cached or not.

Playwright Chrome ran at 1440×1000 and 390×844. It clicked Download PNG at both widths, saved the **downloaded files**, checked the PNG signature and 1000×1400 dimensions, and inspected the footer pixel region in each downloaded PNG. I visually inspected the desktop export and phone preview for legible credit and text wrapping. The desktop and phone exports are byte-identical (SHA-256 `c6c289fe2bf02be06c90705879c4875c76bdd909da2cce4bba89a186d95a3ebe`). The unit test checks the exact footer text drawn for fixture and Muse provenance.

- [Desktop exported PNG](desktop-export.png) · [desktop light](desktop-light.png) · [desktop dark](desktop-dark.png)
- [Phone exported PNG](phone-export.png) · [phone light](phone-light.png) · [phone dark](phone-dark.png)
