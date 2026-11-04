// PCM playback is driven by the audio rendering thread. It never exposes or holds a provider key.
export type StreamPlayer = { push(base64: string, phrase?: number): void; finish(): Promise<void>; stop(): void }
export async function createStreamPlayer(onFirstSpeech: () => void): Promise<StreamPlayer> {
  const context = new AudioContext({ sampleRate: 24000 })
  await context.resume() // called from the mic gesture, before the asynchronous provider turn
  const source = `class VoicePcm extends AudioWorkletProcessor {
    constructor(){super();this.q=[];this.offset=0;this.started=false;this.ended=false;this.sentEnd=false;
      this.phrase=null;this.port.onmessage=e=>{if(e.data.end)this.ended=true;else this.q.push(e.data)}}
    process(_inputs,outputs){const out=outputs[0][0];let at=0;
      while(at<out.length&&this.q.length){const item=this.q[0],q=item.samples,n=Math.min(out.length-at,q.length-this.offset);
        if(item.phrase!==undefined&&item.phrase!==this.phrase){this.phrase=item.phrase;this.port.postMessage({phrase:item.phrase})}
        out.set(q.subarray(this.offset,this.offset+n),at);this.offset+=n;at+=n;
        if(this.offset===q.length){this.q.shift();this.offset=0}}
      if(!this.started&&out.some(x=>Math.abs(x)>0.01)){this.started=true;this.port.postMessage({speech:true})}
      if(this.ended&&!this.q.length&&!this.sentEnd){this.sentEnd=true;this.port.postMessage({end:true})}
      return !this.sentEnd;
    }}registerProcessor('voice-pcm',VoicePcm)`
  const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
  try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
  const node = new AudioWorkletNode(context, 'voice-pcm', { outputChannelCount: [1] })
  node.connect(context.destination)
  let stopped = false, odd: number | null = null, ended: () => void = () => {}
  const completion = new Promise<void>(resolve => { ended = resolve })
  node.port.onmessage = e => {
    if (stopped) return
    if (e.data.speech) onFirstSpeech()
    if (e.data.phrase !== undefined) performance.mark('voice-lab:phrase-' + e.data.phrase)
    if (e.data.end) { ended(); node.disconnect(); void context.close() }
  }
  return {
    push(base64, phrase) {
      if (stopped) return
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const all = odd === null ? bytes : new Uint8Array([odd, ...bytes])
      odd = all.length % 2 ? all[all.length - 1] : null
      const samples = new Float32Array(Math.floor(all.length / 2))
      for (let i = 0; i < samples.length; i++) { const v = all[i * 2] | (all[i * 2 + 1] << 8); samples[i] = (v >= 32768 ? v - 65536 : v) / 32768 }
      node.port.postMessage({ samples, phrase }, [samples.buffer])
    },
    async finish() { if (stopped) return; node.port.postMessage({ end: true }); await completion },
    stop() { if (stopped) return; stopped = true; node.disconnect(); void context.close(); ended() },
  }
}
export async function* voiceStreamEvents(response: Response) {
  if (!response.body) throw new Error('VOICE_STREAM_EMPTY')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (line.trim()) yield JSON.parse(line) as Record<string, unknown>
      }
    }
  } finally { await reader.cancel().catch(() => {}) }
}
