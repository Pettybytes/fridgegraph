# Caregiver map focus

The served regression fails before the change: selecting Malik as Priya leaves the map header on Nora. The map controller already consumes the shared child focus, but the shell header uses the login scope. Priya's Malik grant is careplan.read only, so the schedule-gated world read also refuses.

The map header now uses the shared child focus. A care-plan-only world read returns the authorized child and the caller's own identity, with no household roster, places, coordinates or events. Existing schedule reads retain their original gate and projection. No grants or policies change. A resolver test checks this limited projection and refusal for another child.

The served regression checks Malik in the header and outgoing villageWorld variables, a live map without load errors, and only Priya in the limited people list. Stable automation IDs identify canvas person handles, list handles and individual place drop targets.
