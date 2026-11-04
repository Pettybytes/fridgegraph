import type { RecorderLike } from './useRosinaVoice'
export function wavFromSamples(chunks: Float32Array[], rate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0), bytes = new ArrayBuffer(44 + length * 2), view = new DataView(bytes)
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, length * 2, true)
  let at = 44
  for (const chunk of chunks) for (const value of chunk) { view.setInt16(at, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true); at += 2 }
  return new Blob([bytes], { type: 'audio/wav' })
}
export function pcmRecorder(stream: MediaStream, onData: (blob: Blob) => void, onPrefix?: (blob: Blob) => void): RecorderLike {
  const context = new AudioContext({ sampleRate: 16000 }), chunks: Float32Array[] = []
  let state = 'inactive', source: MediaStreamAudioSourceNode, node: AudioWorkletNode, frames = 0, prefixes = 0
  const code = `class CapturePcm extends AudioWorkletProcessor {
    constructor(){super();this.port.onmessage=e=>{if(e.data.stop){this.port.postMessage({end:true});this.done=true}}}
    process(inputs){if(this.done)return false;const input=inputs[0]?.[0];if(input){const samples=new Float32Array(input);this.port.postMessage({samples},[samples.buffer])}return true}
  }registerProcessor('capture-pcm',CapturePcm)`
  const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
  const ready = context.audioWorklet.addModule(url).then(() => {
    URL.revokeObjectURL(url); source = context.createMediaStreamSource(stream); node = new AudioWorkletNode(context, 'capture-pcm')
    node.port.onmessage = event => {
      if (event.data.end) { source.disconnect(); node.disconnect(); void context.close(); onData(wavFromSamples(chunks, context.sampleRate)); stream.getTracks().forEach(t => t.stop()); return }
      chunks.push(event.data.samples); frames += event.data.samples.length
      if (state === 'recording' && onPrefix && prefixes < 2 && frames / context.sampleRate >= 1.2 * (prefixes + 1)) { prefixes++; onPrefix(wavFromSamples(chunks, context.sampleRate)) }
    }
    source.connect(node); node.connect(context.destination) // processor outputs silence; never monitor the mic
  })
  return {
    get state() { return state },
    start() { state = 'recording'; void context.resume() },
    stop() { if (state === 'inactive') return; state = 'inactive'; void ready.then(() => node.port.postMessage({ stop: true })) },
  }
}
