import type { InviteArt, InviteEvent, InviteProvenance } from './invite'
import { inviteCredit, validArt } from './invite'

const DETROIT = 'America/Detroit'
const DARK_INK = '#252638' // the light paper/ink palette used by the fixture and app
const LIGHT_INK = '#f5f2ee'

type Line = { text: string; font: string; height: number }
export type InviteTextLayout = { lines: Line[]; lineCount: number; totalHeight: number }

export function invitationText(event: InviteEvent): string[] {
  const date = event.date && /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    ? new Intl.DateTimeFormat('en-US', { timeZone: DETROIT, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${event.date}T12:00:00Z`))
    : 'Date to be confirmed'
  const clock = (time: string | null) => {
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
    const [hour, minute] = time.split(':').map(Number)
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
  }
  const start = clock(event.startTime), end = clock(event.endTime)
  const time = start && end ? `${start} – ${end} · Detroit time` : start ? `${start} · Detroit time` : 'Time to be confirmed'
  return [event.childFirstName.trim(), event.occasion.trim(), date, time, event.placeLabel?.trim() || 'Place to be confirmed']
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

/** One layout drives preview and PNG export. It never truncates an event field. */
export function layoutInvitation(ctx: CanvasRenderingContext2D, art: InviteArt, event: InviteEvent, footerHeight = 0): InviteTextLayout {
  const area = art.quietArea
  const contentHeight = area.h - footerHeight
  const width = area.w * 0.88
  const text = invitationText(event)
  if (!text[0] || !text[1]) throw new Error('Enter a child name and occasion before downloading.')
  const base = Math.min(area.w / 704, area.h / 704)
  const sizes = [88, 58, 42, 40, 42]
  const weights = [700, 650, 500, 500, 600]
  const gap = [22, 46, 18, 48, 0]
  for (let factor = 1; factor >= 0.4; factor -= 0.05) {
    const lines: Line[] = []
    let totalHeight = 0
    for (let index = 0; index < text.length; index++) {
      const size = Math.max(17, sizes[index] * base * factor)
      const font = `${weights[index]} ${size}px "Geist Variable", sans-serif`
      ctx.font = font
      const height = size * 1.19
      for (const segment of wrap(ctx, text[index], width)) {
        lines.push({ text: segment, font, height })
        totalHeight += height
      }
      totalHeight += gap[index] * base * factor
      if (index < text.length - 1) lines.push({ text: '', font, height: gap[index] * base * factor })
    }
    if (totalHeight <= contentHeight * 0.88) return { lines, lineCount: lines.filter(line => line.text).length, totalHeight }
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
  const footerHeight = Math.min(64, Math.max(32, art.quietArea.h * 0.12))
  const layout = layoutInvitation(ctx, art, event, footerHeight)
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let top = art.quietArea.y + (art.quietArea.h - footerHeight - layout.totalHeight) / 2
  for (const line of layout.lines) {
    if (line.text) { ctx.font = line.font; ctx.fillText(line.text, art.quietArea.x + art.quietArea.w / 2, top) }
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
  ctx.fillText(credit, art.quietArea.x + art.quietArea.w / 2,
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
  await Promise.all([700, 650, 600, 500].map(weight => document.fonts.load(`${weight} 88px "Geist Variable"`)))
  await document.fonts.ready
}

export async function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png') }
    catch (error) { reject(error) }
  })
}
