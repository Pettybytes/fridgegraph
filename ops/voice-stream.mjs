// Experimental transport. Provisional model text may start TTS, but no bytes are released
// until the complete authoritative final response commits the same phrase.
const segments = text => [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(s => s.segment.trim()).filter(Boolean);
const sentence = text => { const first = segments(text)[0]; return first && /[.!?]$/.test(first) ? first : null; };
function quarantine(source, controller, now) {
  const queue = []; let bytes = 0, done = false, error = null, wake = () => {}, firstByteAt = null;
  const producer = (async () => {
    try {
      for await (const chunk of source) {
        controller.signal.throwIfAborted();
        firstByteAt ??= chunk.providerFirstByteAt ?? now();
        bytes += (chunk.audio ?? chunk).length;
        if (bytes > 1024 * 1024) throw new Error('SPECULATION_LIMIT');
        queue.push(chunk); wake();
      }
    } catch (e) { error = e; } finally { done = true; wake(); }
  })();
  return {
    cancel() { controller.abort(); queue.length = 0; },
    get firstByteAt() { return firstByteAt; },
    async *chunks() {
      while (!done || queue.length) {
        controller.signal.throwIfAborted();
        if (queue.length) { const chunk = queue.shift(); bytes -= (chunk.audio ?? chunk).length; yield chunk; }
        else await new Promise(resolve => { wake = resolve; });
      }
      await producer;
      if (error) throw error;
    },
  };
}
export async function* voiceTurnEvents(input, deps) {
  const now = deps.now ?? (() => performance.now()), start = now();
  const metrics = { ttsRequests: 0, discardedSpeculations: 0 };
  const controllers = new Set();
  const cancel = () => { for (const c of controllers) c.abort(); };
  input.signal?.addEventListener('abort', cancel, { once: true });
  let speculative = null, candidate = null, provisional = '', final = null;
  const synthesize = text => {
    const controller = new AbortController(); controllers.add(controller);
    if (input.signal?.aborted) controller.abort();
    metrics.ttsRequests++;
    return quarantine(deps.synthesize(text, { signal: controller.signal }), controller, now);
  };
  const discard = () => {
    if (speculative) { speculative.cancel(); metrics.discardedSpeculations++; }
    speculative = null; candidate = null; provisional = '';
  };
  try {
    input.signal?.throwIfAborted();
    const asrStart = now();
    const asr = await deps.transcribe(input.audio, input.contentType, { signal: input.signal });
    metrics.asrMs = now() - asrStart;
    Object.assign(metrics, asr.timings ?? {});
    if (typeof asr.transcript !== 'string' || !asr.transcript.trim()) throw new Error('TRANSCRIPT_EMPTY');
    // One authoritative provider transcript. Never concatenate partial snapshots or deduplicate speech.
    yield { type: 'transcript', text: asr.transcript.trim(), atMs: now() - start };
    for await (const event of deps.rosinaStream({ ...input, message: asr.transcript.trim() })) {
      input.signal?.throwIfAborted();
      if (event.event === 'token') {
        metrics.firstAnswerTokenMs ??= now() - start;
        provisional += event.data.text ?? '';
        if (!speculative) {
          const phrase = sentence(provisional);
          if (phrase && phrase.length <= 300) { candidate = phrase; speculative = synthesize(phrase); }
        }
      } else if (event.event === 'replace') discard();
      else if (event.event === 'status') yield { type: 'status', label: event.data.label };
      else if (event.event === 'meta') metrics.rosina = event.data;
      else if (event.event === 'final') { final = event.data; break; }
    }
    if (!final || typeof final.reply !== 'string') throw new Error('ROSINA_UNAVAILABLE');
    metrics.finalGuardMs = now() - start;
    const reply = final.reply.trim();
    if (!candidate || candidate !== sentence(reply)) discard();
    // Preserve every proposal field for its existing owner. No action executes in this transport.
    yield { type: 'final', data: final, atMs: now() - start };
    const first = candidate ?? sentence(reply) ?? reply;
    const phrases = [first, ...segments(reply.slice(first.length).trim())];
    for (let i = 0; i < phrases.length; i++) {
      input.signal?.throwIfAborted();
      const pending = i === 0 && speculative ? speculative : synthesize(phrases[i]);
      for await (const chunk of pending.chunks()) {
        input.signal?.throwIfAborted();
        if (pending.firstByteAt !== null) metrics.ttsFirstByteMs ??= pending.firstByteAt - start;
        metrics.firstAudioReleasedMs ??= now() - start;
        yield { type: 'audio', audioBase64: Buffer.from(chunk.audio ?? chunk).toString('base64'), alignment: chunk.alignment,
          phraseText: phrases[i], sampleRate: 24000, phrase: i, atMs: now() - start };
      }
    }
    yield { type: 'done', timings: { ...metrics, serverTotalMs: now() - start } };
  } finally { cancel(); input.signal?.removeEventListener('abort', cancel); }
}

export async function* parseRosinaEvents(response) {
  if (!response.ok || !response.body) throw new Error('ROSINA_UNAVAILABLE');
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    yield { event: 'final', data: await response.json() }; return;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', event = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, ''); buffer = buffer.slice(nl + 1);
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (!line.startsWith('data:')) continue;
        let data; try { data = JSON.parse(line.slice(5)); } catch { continue; }
        yield { event, data };
        if (event === 'final') return;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}
