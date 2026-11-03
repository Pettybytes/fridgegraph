#!/usr/bin/env node
/**
 * ops/serve-web.mjs — stack-owned static server for the pinned web build (P-3).
 *
 * Replaces `vite preview` on the public path. Deliberately does NOT proxy /graphql or /api/*:
 * behind the tunnel those are separate edge routes to 4010 / 4008 / 4200 (plan §4). Locally,
 * `/graphql` on 5189 therefore 404s by design.
 *
 * Spec (docs/handoff/hosting-execution-plan.md §3):
 *  - binds 127.0.0.1 only;
 *  - root = WEB_ROOT, must exist, be a directory and contain index.html;
 *  - GET/HEAD only, anything else 405 + Allow;
 *  - normalise before filesystem access: decode, collapse, reject `..`, NUL, escapes;
 *  - fixed content-type map, unknown -> application/octet-stream;
 *  - /assets/* immutable; index.html and SPA fallback no-store;
 *  - SPA fallback only for extensionless paths; a missing file with an extension is 404;
 *  - no directory listing, no dotfiles;
 *  - SIGTERM closes the listener and exits 0.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const PORT = Number(process.env.PORT ?? 5189);
const ROOT_ENV = process.env.WEB_ROOT;

function fatal(msg) {
  process.stderr.write(`[serve-web] ${msg}\n`);
  process.exit(2);
}

if (!ROOT_ENV) fatal('WEB_ROOT is required');
let root;
try {
  root = realpathSync(ROOT_ENV);
} catch {
  fatal(`WEB_ROOT does not exist: ${ROOT_ENV}`);
}
if (!statSync(root).isDirectory()) fatal(`WEB_ROOT is not a directory: ${root}`);
if (!existsSync(resolve(root, 'index.html'))) fatal(`WEB_ROOT has no index.html: ${root}`);

const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}));

/** Map a request URL to an on-disk path, or null when it must be refused. */
function resolvePath(url) {
  const raw = String(url ?? '').split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  if (decoded.includes('\0')) return null;
  if (decoded.includes('..')) return null;
  if (decoded.split('/').some((seg) => seg.startsWith('.') && seg !== '')) return null;
  const rel = decoded.replace(/\/+/g, '/');
  const abs = resolve(root, `.${rel}`);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

function headersFor(abs, isFallback = false) {
  const ext = extname(abs).toLowerCase();
  const type = TYPES.get(ext) ?? 'application/octet-stream';
  const immutable = abs.startsWith(resolve(root, 'assets') + sep);
  return {
    'Content-Type': type,
    'Cache-Control': immutable && !isFallback ? 'public, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function sendFile(req, res, abs, status = 200, isFallback = false) {
  const headers = headersFor(abs, isFallback);
  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found\n');
    return;
  }
  res.writeHead(status, { ...headers, 'Content-Length': String(size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(abs);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Method not allowed\n');
    return;
  }

  const abs = resolvePath(req.url);
  if (!abs) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Forbidden\n');
    return;
  }

  let stat = null;
  try {
    stat = statSync(abs);
  } catch {
    stat = null;
  }

  if (stat?.isFile()) {
    sendFile(req, res, abs);
    return;
  }

  // Directory or missing: only extensionless paths fall back to the SPA shell.
  if (stat?.isDirectory() || extname(abs) === '') {
    sendFile(req, res, resolve(root, 'index.html'), 200, true);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found\n');
});

server.on('error', (err) => {
  process.stderr.write(`[serve-web] ${err.code === 'EADDRINUSE' ? `port ${PORT} already in use` : err.message}\n`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[serve-web] listening on 127.0.0.1:${PORT} root=${root}\n`);
});

function shutdown(signal) {
  process.stdout.write(`[serve-web] ${signal} received, closing\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
