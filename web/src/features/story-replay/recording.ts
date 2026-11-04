import audioSrc from './assets/rosina-narration.mp3'

/** This rehearsal is deliberately marked incomplete until the public journey can finish.
 * The export pipeline replaces these three files without changing the media clock. */
export const RECORDING = {
  complete: false,
  durationSeconds: 34,
  audioSrc,
  audioEndSeconds: 19.8,
  disclosure: 'Incomplete rehearsal: the run stops before caregiver reply and final approval. The map has no shared person locations, so no pickup route is shown.',
  provenance: 'Captured from the public app with Playwright and edited in Remotion. The dark trace describes observed screen events, not server telemetry. Rosina’s existing ElevenLabs narration stops before the uncaptured steps.',
  tracks: [
    {src: '/replay/parent.mp4', poster: '/replay/parent.webp', description: 'Kendra’s recorded rehearsal'},
    {src: '/replay/trace.mp4', poster: '/replay/trace.webp', description: 'Observed events and call-chain context'},
    {src: '/replay/village.mp4', poster: '/replay/village.webp', description: 'Real map, Activity and Mission Control'},
  ],
  captions: [
    {start: 0, end: 7.1, text: 'A school notice changes Nora’s day. Early dismissal comes before her recorded pickup.'},
    {start: 7.1, end: 13.95, text: 'I check Nora’s schedule and who can help, then draft a new pickup plan for Kendra to approve.'},
    {start: 13.95, end: 19.8, text: 'With Kendra’s approval, the request goes to Loretta, a test caregiver.'},
    {start: 19.8, end: 25, text: 'The run is waiting for a caregiver reply. Final approval was not captured.'},
    {start: 25, end: 34, text: 'The recorded map has no shared person locations. Activity and Mission Control are shown as inspected, without claiming a completed plan.'},
  ],
} as const
