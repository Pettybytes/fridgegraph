/**
 * Deterministic, clearly-labelled FIXTURE art for the Invites slice — the default when the live Muse
 * Image path is off. It is a 1024×1024 PNG built here (no binary committed, no network): a muted
 * lavender card with a visible frame and a lighter rectangle marking the quiet area the app fills
 * with text. No people, no text/lettering — a placeholder, never model output. `provenance.source =
 * FIXTURE` + the fixture disclaimer label it at the API level.
 */
import { deflateSync } from 'node:zlib';

export const INVITE_FIXTURE_WIDTH = 1024;
export const INVITE_FIXTURE_HEIGHT = 1024;
export const INVITE_QUIET_AREA = { x: 96, y: 600, w: 832, h: 328 } as const;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

type RGB = [number, number, number];
const BG: RGB = [230, 224, 245]; // muted lavender — obviously a placeholder
const QUIET: RGB = [246, 244, 251]; // lighter: the reserved text area
const FRAME: RGB = [176, 162, 212];

function pixel(x: number, y: number): RGB {
  if (x < 24 || y < 24 || x >= INVITE_FIXTURE_WIDTH - 24 || y >= INVITE_FIXTURE_HEIGHT - 24) return FRAME;
  const q = INVITE_QUIET_AREA;
  if (x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) return QUIET;
  return BG;
}

function buildPng(width: number, height: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolour RGB
  // ihdr[10..12] = 0 (compression, filter, interlace)
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = rowStart + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

export const INVITE_FIXTURE_PNG: Buffer = buildPng(INVITE_FIXTURE_WIDTH, INVITE_FIXTURE_HEIGHT);
export const INVITE_FIXTURE_BASE64: string = INVITE_FIXTURE_PNG.toString('base64');
