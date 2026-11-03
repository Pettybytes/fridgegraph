/**
 * pinMedia hygiene tests: the sniff trusts magic bytes not the caller's claim, and the strip removes
 * EXIF/GPS/XMP/text from JPEG, PNG and WebP while keeping the pixels. Pure; run: npm run test:rosina
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sniffImageMime, stripImageMetadata } from './pinMedia';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---- sniff ----

test('sniff trusts magic bytes, not the claimed type', () => {
  assert.equal(sniffImageMime(PNG_SIG), 'image/png');
  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), 'image/jpeg');
  assert.equal(sniffImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('%PDF-1.7\n')), null); // a PDF renamed image/png is rejected
  assert.equal(sniffImageMime(Buffer.from('<svg xmlns>')), null);
  assert.equal(sniffImageMime(Buffer.from([0x00, 0x01])), null);
});

// ---- JPEG strip ----

function jpegMarker(marker: number, payload: Buffer): Buffer {
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff; seg[1] = marker; seg.writeUInt16BE(payload.length + 2, 2); payload.copy(seg, 4);
  return seg;
}

test('JPEG strip removes APP1/EXIF + COM, keeps APP0/JFIF and the scan', () => {
  const app1 = jpegMarker(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS 42.33,-83.04 SECRET')]));
  const app0 = jpegMarker(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'));
  const com = jpegMarker(0xfe, Buffer.from('camera serial 12345'));
  const scan = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), Buffer.from([0x12, 0x34, 0x56]), Buffer.from([0xff, 0xd9])]);
  const input = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, app0, com, scan]);
  const out = stripImageMetadata(input, 'image/jpeg');
  assert.equal(out.includes(Buffer.from('SECRET')), false, 'EXIF/GPS gone');
  assert.equal(out.includes(Buffer.from('camera serial')), false, 'COM gone');
  assert.equal(out.includes(Buffer.from('JFIF')), true, 'JFIF kept');
  assert.equal(out.includes(Buffer.from([0x12, 0x34, 0x56])), true, 'scan data preserved');
  assert.deepEqual(out.subarray(out.length - 2), Buffer.from([0xff, 0xd9]), 'EOI preserved');
});

test('JPEG strip refuses a truncated segment', () => {
  const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40]); // claims 0x40 bytes, has none
  assert.throws(() => stripImageMetadata(bad, 'image/jpeg'), /PIN_MEDIA_STRIP_FAILED/);
});

// ---- PNG strip ----

function pngChunk(type: string, data: Buffer): Buffer {
  const c = Buffer.alloc(12 + data.length);
  c.writeUInt32BE(data.length, 0); c.write(type, 4, 'latin1'); data.copy(c, 8);
  c.writeUInt32BE(0, 8 + data.length); // CRC not validated by the stripper
  return c;
}

test('PNG strip removes tEXt/eXIf/iTXt, keeps IHDR/IDAT/IEND', () => {
  const input = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', Buffer.alloc(13, 1)),
    pngChunk('tEXt', Buffer.from('Comment\0GPS 42.33 SECRET')),
    pngChunk('eXIf', Buffer.from('MM\0* device serial')),
    pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp SECRET2')),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x00])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const out = stripImageMetadata(input, 'image/png');
  assert.equal(out.includes(Buffer.from('SECRET')), false);
  assert.equal(out.includes(Buffer.from('SECRET2')), false);
  assert.equal(out.includes(Buffer.from('device serial')), false);
  assert.equal(out.subarray(0, 8).equals(PNG_SIG), true);
  assert.equal(out.includes(Buffer.from('IHDR')), true);
  assert.equal(out.includes(Buffer.from('IDAT')), true);
  assert.equal(out.includes(Buffer.from('IEND')), true);
});

test('PNG strip refuses a stream with no IEND', () => {
  const bad = Buffer.concat([PNG_SIG, pngChunk('IHDR', Buffer.alloc(13, 1))]);
  assert.throws(() => stripImageMetadata(bad, 'image/png'), /PIN_MEDIA_STRIP_FAILED/);
});

// ---- WebP strip ----

function webpChunk(tag: string, data: Buffer): Buffer {
  const size = data.length;
  const padded = size + (size % 2);
  const c = Buffer.alloc(8 + padded);
  c.write(tag, 0, 'latin1'); c.writeUInt32LE(size, 4); data.copy(c, 8);
  return c;
}

test('WebP strip removes EXIF + XMP chunks, clears VP8X flags, fixes RIFF size', () => {
  const vp8x = webpChunk('VP8X', Buffer.concat([Buffer.from([0b00001100]), Buffer.alloc(9)])); // EXIF+XMP flags set
  const vp8 = webpChunk('VP8 ', Buffer.from([0x01, 0x02, 0x03]));
  const exif = webpChunk('EXIF', Buffer.from('II* GPS SECRET'));
  const xmp = webpChunk('XMP ', Buffer.from('<x:xmpmeta SECRET2'));
  const payload = Buffer.concat([vp8x, vp8, exif, xmp]);
  const input = Buffer.concat([Buffer.from('RIFF'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(payload.length + 4, 0); return b; })(), Buffer.from('WEBP'), payload]);
  const out = stripImageMetadata(input, 'image/webp');
  assert.equal(out.includes(Buffer.from('SECRET')), false);
  assert.equal(out.includes(Buffer.from('SECRET2')), false);
  assert.equal(out.includes(Buffer.from('VP8 ')), true, 'image chunk kept');
  assert.equal(out.readUInt32LE(4), out.length - 8, 'RIFF size matches new payload');
  // VP8X flags byte (offset 12 header + 8 chunk-header = 20) cleared of EXIF/XMP bits
  assert.equal(out[12 + 8] & 0b00001100, 0, 'EXIF/XMP presence flags cleared');
});
