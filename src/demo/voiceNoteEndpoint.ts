/**
 * GET /api/demo/voice-note/:voiceNoteId — private playback, decided on EVERY request by the
 * database itself (voice_note_access, 0084). Same shape as src/rosina/photoEndpoint.ts and the
 * existing Orbit photo GET route (src/demo/server.ts): every dependency is injected so the server
 * wires real implementations and tests can force each refusal over a REAL loopback HTTP request,
 * not a faked req/res object — this endpoint's own correctness is specifically about real HTTP
 * behavior (headers, status codes, body bytes), which a mocked req/res cannot fully exercise.
 *
 * No signed URL, no cached authority: `access` is called fresh on every single request.
 */
import type { Request, Response } from 'express';

export type VoiceNoteIdentity = { ok: true } | { ok: false };
export type VoiceNoteAccessResult = { access: string; storagePath: string; contentType: string } | null;

export type VoiceNoteEndpointDeps = {
  verify: (header?: string) => Promise<VoiceNoteIdentity>;
  /** Re-run on EVERY request — the caller's bearer decides CURRENT authority, never a cached prior result. */
  access: (voiceNoteId: string, bearer: string) => Promise<VoiceNoteAccessResult>;
  /** Null for "file not found" — the route maps that to the SAME 404 as a refused access. */
  loadBytes: (storagePath: string) => Buffer | null;
};

function bearerOf(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

export function createVoiceNoteHandler(deps: VoiceNoteEndpointDeps) {
  return async function handle(req: Request, res: Response): Promise<void> {
    // Set before any check, including refusals: a cached copy would outlive the authority check.
    res.setHeader('Cache-Control', 'no-store');
    const identity = await deps.verify(req.header('authorization'));
    if (!identity.ok) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    try {
      const result = await deps.access(req.params.voiceNoteId, bearerOf(req));
      // No existence oracle: "no such voice note" and "not authorized for it" are the SAME 404.
      if (!result) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      const bytes = deps.loadBytes(result.storagePath);
      if (!bytes) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      // The database decides the asset's real type (0084: MP3 playback vs. its WAV ASR source) —
      // never hardcoded, so a future note in a different format is served correctly without a code change.
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('X-Voice-Note-Access', result.access);
      res.send(bytes);
    } catch {
      res.status(404).json({ error: 'NOT_FOUND' });
    }
  };
}
