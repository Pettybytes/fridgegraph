/**
 * Image hygiene for an UPLOADED reference image (PURE, no I/O, no network). Used by the invite
 * reference pipeline: the sniff decides the real format from magic bytes (a lying mimeType cannot
 * smuggle a non-image through), the strip removes EXIF/GPS/XMP/text metadata, and the dimension read
 * lets the server bound image size itself. All three run in memory on the raw bytes before anything
 * is sent to a provider; nothing is persisted and the bytes are never logged.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Real format from magic bytes, or null if it is not one of the supported raster images. */
export function sniffImageMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// --- metadata strip (drops EXIF/GPS/XMP/text; keeps image + rendering chunks) ---

function stripJpeg(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new Error('IMAGE_STRIP_FAILED');
  const parts: Buffer[] = [input.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) { parts.push(input.subarray(i)); break; }
    const marker = input[i + 1];
    if (marker === 0xda) { parts.push(input.subarray(i)); break; } // start of scan → copy remainder
    const len = input.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (end > input.length) throw new Error('IMAGE_STRIP_FAILED');
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe; // APP1..APPF (EXIF/XMP) + COM
    if (!isMetadata) parts.push(input.subarray(i, end));
    i = end;
  }
  return Buffer.concat(parts);
}

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'pHYs', 'bKGD', 'sBIT']);
function stripPng(input: Buffer): Buffer {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIG)) throw new Error('IMAGE_STRIP_FAILED');
  const parts: Buffer[] = [input.subarray(0, 8)];
  let i = 8;
  let sawIEND = false;
  while (i + 8 <= input.length) {
    const len = input.readUInt32BE(i);
    const type = input.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > input.length) throw new Error('IMAGE_STRIP_FAILED');
    if (PNG_KEEP.has(type)) parts.push(input.subarray(i, end));
    if (type === 'IEND') { sawIEND = true; break; }
    i = end;
  }
  if (!sawIEND) throw new Error('IMAGE_STRIP_FAILED');
  return Buffer.concat(parts);
}

function stripWebp(input: Buffer): Buffer {
  if (input.length < 12 || input.subarray(0, 4).toString('latin1') !== 'RIFF' || input.subarray(8, 12).toString('latin1') !== 'WEBP') {
    throw new Error('IMAGE_STRIP_FAILED');
  }
  const kept: Buffer[] = [];
  let i = 12;
  while (i + 8 <= input.length) {
    const tag = input.subarray(i, i + 4).toString('latin1');
    const size = input.readUInt32LE(i + 4);
    const padded = size + (size % 2);
    const end = i + 8 + padded;
    if (end > input.length) throw new Error('IMAGE_STRIP_FAILED');
    if (tag !== 'EXIF' && tag !== 'XMP ') {
      const chunk = Buffer.from(input.subarray(i, end));
      if (tag === 'VP8X' && chunk.length >= 9) chunk[8] &= ~0b00001100; // clear EXIF/XMP presence flags
      kept.push(chunk);
    }
    i = end;
  }
  const payload = Buffer.concat(kept);
  const out = Buffer.concat([input.subarray(0, 12), payload]);
  out.writeUInt32LE(payload.length + 4, 4);
  return out;
}

/** Strip metadata for a sniffed image; throws IMAGE_STRIP_FAILED on a malformed/unsupported input. */
export function stripImageMetadata(buf: Buffer, mime: ImageMime): Buffer {
  switch (mime) {
    case 'image/jpeg': return stripJpeg(buf);
    case 'image/png': return stripPng(buf);
    case 'image/webp': return stripWebp(buf);
  }
}

// --- dimensions (server-side size bound) ---

/** Pixel dimensions from the header, or null if they can't be read. Server-side so a client can't
 *  lie about size. JPEG scans SOF markers; PNG reads IHDR; WebP reads VP8/VP8L/VP8X. */
export function readImageDimensions(buf: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') {
      if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF15 except DHT(0xC4)/JPG(0xC8)/DAC(0xCC) carry dimensions.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
      return null;
    }
    // WebP: VP8X (10-byte header → 24-bit w-1/h-1), VP8L (bit-packed 14-bit each), VP8 (16-bit each).
    const fourcc = buf.subarray(12, 16).toString('latin1');
    if (fourcc === 'VP8X') return { width: ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) & 0xffffff) + 1, height: ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) & 0xffffff) + 1 };
    if (fourcc === 'VP8L') {
      const b = buf.subarray(21);
      const bits = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    return null;
  } catch { return null; }
}
