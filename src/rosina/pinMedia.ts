/**
 * "Pin it to the fridge" — private media hygiene (PURE, no I/O, no network).
 *
 * Two jobs, both done on the raw uploaded bytes before anything is stored:
 *   1. sniffImageMime — identify the real format from magic bytes, so a lying `mimeType` (a PDF or
 *      script renamed to image/png) cannot smuggle content past the allow-list. The sniff, never the
 *      caller's claim, decides what the bytes are.
 *   2. stripImageMetadata — remove EXIF/GPS/XMP/text metadata chunks. JPEG APP1–APPn + COM, PNG
 *      ancillary text/EXIF/time chunks, WebP EXIF/XMP chunks. The stored asset carries no location or
 *      device metadata. If the format is one we cannot prove we stripped, we REFUSE (never store
 *      unstripped bytes and claim otherwise) — the caller's upload fails closed.
 *
 * These are deliberately dependency-free so the strip is auditable and runs the same everywhere.
 */

export type SniffedMime = 'image/png' | 'image/jpeg' | 'image/webp';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Real format from magic bytes, or null if it is not one of the supported raster images. */
export function sniffImageMime(buf: Buffer): SniffedMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** JPEG: keep everything except APP1–APPF (0xE1–0xEF, incl. EXIF/XMP) and COM (0xFE). APP0/JFIF is
 *  kept (it is not identifying). Scan data is copied verbatim. */
function stripJpeg(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new Error('PIN_MEDIA_STRIP_FAILED');
  const parts: Buffer[] = [input.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) { parts.push(input.subarray(i)); break; }
    const marker = input[i + 1];
    if (marker === 0xda) { parts.push(input.subarray(i)); break; } // start of scan → copy remainder
    const len = input.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (end > input.length) throw new Error('PIN_MEDIA_STRIP_FAILED'); // truncated / malformed
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(input.subarray(i, end));
    i = end;
  }
  return Buffer.concat(parts);
}

// PNG chunks we keep — image structure + rendering hints only. Everything else (tEXt, zTXt, iTXt,
// eXIf, tIME, and any unknown/private chunk) is dropped. Each chunk is self-contained (own CRC), so
// dropping one needs no recompute.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'pHYs', 'bKGD', 'sBIT']);

function stripPng(input: Buffer): Buffer {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIG)) throw new Error('PIN_MEDIA_STRIP_FAILED');
  const parts: Buffer[] = [input.subarray(0, 8)];
  let i = 8;
  let sawIEND = false;
  while (i + 8 <= input.length) {
    const len = input.readUInt32BE(i);
    const type = input.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len; // length(4) + type(4) + data(len) + crc(4)
    if (end > input.length) throw new Error('PIN_MEDIA_STRIP_FAILED');
    if (PNG_KEEP.has(type)) parts.push(input.subarray(i, end));
    if (type === 'IEND') { sawIEND = true; break; }
    i = end;
  }
  if (!sawIEND) throw new Error('PIN_MEDIA_STRIP_FAILED');
  return Buffer.concat(parts);
}

// WebP: RIFF container of 4-byte-tagged chunks. Drop EXIF and XMP; keep image/color chunks. Clear
// the EXIF/XMP presence flags in a VP8X header so the (now absent) metadata is not advertised. The
// outer RIFF size is recomputed from the kept payload.
function stripWebp(input: Buffer): Buffer {
  if (input.length < 12 || input.subarray(0, 4).toString('latin1') !== 'RIFF' || input.subarray(8, 12).toString('latin1') !== 'WEBP') {
    throw new Error('PIN_MEDIA_STRIP_FAILED');
  }
  const kept: Buffer[] = [];
  let i = 12;
  while (i + 8 <= input.length) {
    const tag = input.subarray(i, i + 4).toString('latin1');
    const size = input.readUInt32LE(i + 4);
    const padded = size + (size % 2); // chunks are padded to even length
    const end = i + 8 + padded;
    if (end > input.length) throw new Error('PIN_MEDIA_STRIP_FAILED');
    if (tag !== 'EXIF' && tag !== 'XMP ') {
      const chunk = Buffer.from(input.subarray(i, end));
      if (tag === 'VP8X' && chunk.length >= 9) chunk[8] &= ~0b00001100; // clear EXIF(bit3)+XMP(bit2) flags
      kept.push(chunk);
    }
    i = end;
  }
  const payload = Buffer.concat(kept);
  const out = Buffer.concat([input.subarray(0, 12), payload]);
  out.writeUInt32LE(payload.length + 4, 4); // RIFF size = 'WEBP' + payload
  return out;
}

/** Strip metadata for a sniffed raster image. Throws PIN_MEDIA_STRIP_FAILED on an unsupported or
 *  malformed input — the caller must refuse rather than store unstripped bytes. */
export function stripImageMetadata(buf: Buffer, mime: SniffedMime): Buffer {
  switch (mime) {
    case 'image/jpeg': return stripJpeg(buf);
    case 'image/png': return stripPng(buf);
    case 'image/webp': return stripWebp(buf);
  }
}
