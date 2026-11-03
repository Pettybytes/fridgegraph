import type { InviteArt, InviteEvent, InviteProvenance, InviteReferenceImage } from './invite'
import {
  inviteCredit, validArt, fitsRevisionLimits,
  REFERENCE_MAX_BYTES, REFERENCE_MIN_DIM, REFERENCE_MAX_DIM,
} from './invite'

const DETROIT = 'America/Detroit'
const DARK_INK = '#252638' // the light paper/ink palette used by the fixture and app
const LIGHT_INK = '#f5f2ee'
const MIN_FONT_PX = 14

/** One typographic role on the card. Order here is the reading order on the page. */
export type InviteLineRole = 'host' | 'name' | 'occasion' | 'date' | 'time' | 'place' | 'message'

type LineSpec = {
  role: InviteLineRole
  text: string
  /** Point size at scale 1, before the quiet area's own base factor is applied. */
  size: number
  weight: number
  /** Space below this line, at scale 1. */
  gapAfter: number
  /** Dropped from the layout entirely when its text is blank (host, message). */
  optional: boolean
  italic?: boolean
  /** Draw a short centred hairline under this line — width as a fraction of the text width. */
  ruleAfter?: number
}

type Line =
  | { kind: 'text'; text: string; font: string; height: number }
  | { kind: 'rule'; width: number; height: number }

export type InviteTextLayout = { lines: Line[]; lineCount: number; totalHeight: number }

/** Waits for the weights the card actually draws with, so a first paint never falls back to a
 *  system font and then reflows. Kept as a single list so the canvas and the DOM mirror agree. */
const INVITE_FONT_WEIGHTS = [700, 600, 500] as const

function clock(time: string | null): string | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const [hour, minute] = time.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

/**
 * The card's lines, in reading order, with the type treatment for each. Optional lines whose
 * text is blank are removed before anything is measured, so the remaining sizes stay correct
 * when a family leaves the host or the personal note empty.
 */
export function lineSpecs(event: InviteEvent): LineSpec[] {
  const date = event.date && /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    ? new Intl.DateTimeFormat('en-US', { timeZone: DETROIT, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${event.date}T12:00:00Z`))
    : 'Date to be confirmed'
  const start = clock(event.startTime), end = clock(event.endTime)
  const time = start && end ? `${start} – ${end} · Detroit time` : start ? `${start} · Detroit time` : 'Time to be confirmed'
  const host = (event.hostName ?? '').trim()

  const specs: LineSpec[] = [
    { role: 'host', text: host ? `Hosted by ${host}` : '', size: 30, weight: 600, gapAfter: 14, optional: true },
    { role: 'name', text: event.childFirstName.trim(), size: 92, weight: 700, gapAfter: 10, optional: false },
    { role: 'occasion', text: event.occasion.trim(), size: 54, weight: 600, gapAfter: 18, optional: false, ruleAfter: 0.18 },
    { role: 'date', text: date, size: 42, weight: 500, gapAfter: 2, optional: false },
    { role: 'time', text: time, size: 40, weight: 500, gapAfter: 20, optional: false },
    { role: 'place', text: event.placeLabel?.trim() || 'Place to be confirmed', size: 44, weight: 600, gapAfter: 16, optional: false },
    { role: 'message', text: (event.message ?? '').trim(), size: 36, weight: 500, gapAfter: 0, optional: true, italic: true },
  ]
  return specs.filter(spec => !spec.optional || spec.text.length > 0)
}

/** The card's text lines as plain strings — the accessible name, the DOM readout, and the
 *  invitation's content in order. Never truncates a field. */
export function invitationText(event: InviteEvent): string[] {
  return lineSpecs(event).map(spec => spec.text)
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!word) continue
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= width) { line = candidate; continue }
    if (line) { lines.push(line); line = '' }
    if (ctx.measureText(word).width <= width) { line = word; continue }
    let part = ''
    for (const character of Array.from(word)) {
      if (part && ctx.measureText(part + character).width > width) { lines.push(part); part = character }
      else part += character
    }
    line = part
  }
  if (line) lines.push(line)
  return lines
}

/**
 * One layout drives preview and PNG export. It never truncates an event field: it shrinks the
 * whole type scale until everything fits the art's reserved quiet area, and refuses rather than
 * clipping when it cannot.
 */
export function layoutInvitation(ctx: CanvasRenderingContext2D, art: InviteArt, event: InviteEvent, footerHeight = 0): InviteTextLayout {
  const area = art.quietArea
  const contentHeight = area.h - footerHeight
  const width = area.w * 0.88
  // name and occasion are the two non-optional lines; blanking either leaves a card that is not
  // an invitation, so refuse instead of drawing an anonymous layout.
  if (!event.childFirstName.trim() || !event.occasion.trim()) {
    throw new Error('Enter a child name and occasion before downloading.')
  }
  const specs = lineSpecs(event)
  const base = Math.min(area.w / 704, area.h / 704)
  for (let factor = 1; factor >= 0.4; factor -= 0.05) {
    const lines: Line[] = []
    let totalHeight = 0
    let lineCount = 0
    for (const spec of specs) {
      const size = Math.max(MIN_FONT_PX, spec.size * base * factor)
      const font = `${spec.italic ? 'italic ' : ''}${spec.weight} ${size}px "Geist Variable", sans-serif`
      ctx.font = font
      const height = size * 1.19
      for (const segment of wrap(ctx, spec.text, width)) {
        lines.push({ kind: 'text', text: segment, font, height })
        totalHeight += height
        lineCount++
      }
      if (spec.ruleAfter) {
        const ruleHeight = Math.max(10, size * 0.62)
        lines.push({ kind: 'rule', width: ctx.measureText(spec.text).width * spec.ruleAfter, height: ruleHeight })
        totalHeight += ruleHeight
        ctx.font = font
      }
      const gap = spec.gapAfter * base * factor
      if (gap > 0) {
        lines.push({ kind: 'text', text: '', font, height: gap })
        totalHeight += gap
      }
    }
    if (totalHeight <= contentHeight * 0.88) return { lines, lineCount, totalHeight }
  }
  throw new Error('The event text does not fit the art. Shorten a field before downloading.')
}

function textColor(ctx: CanvasRenderingContext2D, art: InviteArt): string {
  const { x, y, w, h } = art.quietArea
  let sum = 0
  for (let row = 1; row <= 3; row++) for (let col = 1; col <= 3; col++) {
    const data = ctx.getImageData(Math.floor(x + (w * col) / 4), Math.floor(y + (h * row) / 4), 1, 1).data
    sum += (0.2126 * data[0] + 0.7152 * data[1] + 0.0722 * data[2]) / 255
  }
  return sum / 9 > 0.56 ? DARK_INK : LIGHT_INK
}

export function drawInvitation(canvas: HTMLCanvasElement, image: HTMLImageElement, art: InviteArt, event: InviteEvent, provenance: InviteProvenance): InviteTextLayout {
  if (!validArt(art) || image.naturalWidth !== art.width || image.naturalHeight !== art.height) throw new Error('Invitation art is invalid.')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas export is unavailable in this browser.')
  canvas.width = art.width
  canvas.height = art.height
  ctx.drawImage(image, 0, 0, art.width, art.height)
  const ink = textColor(ctx, art)
  // Composite the event block on an opaque plate over the reserved band: model-painted lettering
  // or busy art inside the band can never show through or collide with the app's event text.
  ctx.save()
  ctx.fillStyle = ink === DARK_INK ? LIGHT_INK : DARK_INK
  ctx.fillRect(art.quietArea.x, art.quietArea.y, art.quietArea.w, art.quietArea.h)
  ctx.restore()
  const footerHeight = Math.min(64, Math.max(32, art.quietArea.h * 0.12))
  const layout = layoutInvitation(ctx, art, event, footerHeight)
  const centreX = art.quietArea.x + art.quietArea.w / 2
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let top = art.quietArea.y + (art.quietArea.h - footerHeight - layout.totalHeight) / 2
  for (const line of layout.lines) {
    if (line.kind === 'rule') {
      const ruleTop = top + line.height / 2
      ctx.save()
      ctx.globalAlpha = 0.42
      ctx.strokeStyle = ink
      ctx.lineWidth = Math.max(1, art.quietArea.w * 0.002)
      ctx.beginPath()
      ctx.moveTo(centreX - line.width / 2, ruleTop)
      ctx.lineTo(centreX + line.width / 2, ruleTop)
      ctx.stroke()
      ctx.restore()
    } else if (line.text) {
      ctx.font = line.font
      ctx.fillText(line.text, centreX, top)
    }
    top += line.height
  }
  const credit = inviteCredit(provenance)
  let footerSize = Math.min(22, Math.max(14, art.quietArea.w * 0.03))
  ctx.font = `500 ${footerSize}px "Geist Variable", sans-serif`
  while (footerSize > 12 && ctx.measureText(credit).width > art.quietArea.w * 0.88) {
    footerSize -= 1
    ctx.font = `500 ${footerSize}px "Geist Variable", sans-serif`
  }
  if (ctx.measureText(credit).width > art.quietArea.w * 0.88) throw new Error('The art credit does not fit the invitation.')
  ctx.fillText(credit, centreX,
    art.quietArea.y + art.quietArea.h - footerHeight + (footerHeight - footerSize) / 2)
  return layout
}

export async function decodeInviteArt(art: InviteArt): Promise<{ image: HTMLImageElement; dispose: () => void }> {
  if (!validArt(art)) throw new Error('Invitation art is invalid.')
  const binary = atob(art.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: art.mimeType }))
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    if (image.naturalWidth !== art.width || image.naturalHeight !== art.height) throw new Error('Invitation art dimensions do not match.')
    return { image, dispose: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export async function waitForInviteFont(): Promise<void> {
  await Promise.all(INVITE_FONT_WEIGHTS.map(weight => document.fonts.load(`${weight} 88px "Geist Variable"`)))
  await document.fonts.load('italic 500 88px "Geist Variable"').catch(() => {})
  await document.fonts.ready
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { const s = String(reader.result); const c = s.indexOf(','); resolve(c < 0 ? '' : s.slice(c + 1)) }
    reader.onerror = () => reject(new Error('Could not read the resized design.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Turn a generated result into a revision INPUT the server will accept. A generated image can be
 * larger than the reference-input limits (the generator bound is 8 MB / provider aspect ratio; the
 * reference bound is 5 MB / 16–4096 px), so an accepted result would otherwise be un-revisable. This
 * is the explicit resize path: within limits it is sent verbatim; otherwise it is downscaled to fit
 * REFERENCE_MAX_DIM and re-encoded as PNG, shrinking until it is also under REFERENCE_MAX_BYTES.
 */
export async function toRevisionReference(art: InviteArt): Promise<InviteReferenceImage> {
  if (fitsRevisionLimits(art)) return { mimeType: art.mimeType, dataBase64: art.base64 }
  const { image, dispose } = await decodeInviteArt(art)
  try {
    const maxDim = Math.max(art.width, art.height)
    let scale = Math.min(1, REFERENCE_MAX_DIM / maxDim)
    for (let attempt = 0; attempt < 7; attempt++) {
      const w = Math.max(REFERENCE_MIN_DIM, Math.round(art.width * scale))
      const h = Math.max(REFERENCE_MIN_DIM, Math.round(art.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not resize the design for revision.')
      ctx.drawImage(image, 0, 0, w, h)
      const blob = await canvasPng(canvas)
      if (blob.size <= REFERENCE_MAX_BYTES) return { mimeType: 'image/png', dataBase64: await blobToBase64(blob) }
      if (w <= REFERENCE_MIN_DIM || h <= REFERENCE_MIN_DIM) break
      scale *= 0.8
    }
    throw new Error('This design is too large to revise. Download it, then start a new request.')
  } finally { dispose() }
}

export async function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png') }
    catch (error) { reject(error) }
  })
}
