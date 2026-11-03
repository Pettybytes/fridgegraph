#!/usr/bin/env node
/**
 * ops/serve-web.mjs — stack-owned static server + local API proxy (P-3).
 *
 * Serves the pinned build on 127.0.0.1 and proxies the SAME ordered path rules the public edge
 * applies, so the local origin Bryan tests (127.0.0.1:5189) is a working app, not a static shell:
 *
 *   /graphql                     -> 127.0.0.1:4010
 *   /api/rosina, /api/rosina/*   -> 127.0.0.1:4200
 *   /api/demo,  /api/demo/*      -> 127.0.0.1:4008
 *   /api/village, /api/village/* -> 127.0.0.1:4008
 *   /api/orbit, /api/orbit/*     -> 127.0.0.1:4008
 *   everything else              -> static (SPA fallback for extensionless paths)
 *
 * Why a proxy here is safe: the server binds 127.0.0.1 only, every target is loopback, and the
 * browser talks to one origin (so no CORS surface). The public edge still owns these paths and
 * never reaches this proxy for them. `/voice/*` is refused locally (voice stays off).
 *
 * Static rules (plan §3): GET/HEAD only; decode/collapse/reject `..`, NUL, dotfiles, escapes;
 * fixed content types; /assets immutable; shell + SPA fallback no-store; extension-only missing
 * files are real 404s; no listings; SIGTERM closes cleanly.
 */
import { createServer, request as httpRequest } from 'node:http';
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

/** Ordered local API routes — most specific first, exactly as the edge table. */
const PROXY = [
  { match: (p) => p === '/graphql', port: 4010, name: 'graphql' },
  { match: (p) => p === '/api/rosina' || p.startsWith('/api/rosina/'), port: 4200, name: 'rosina' },
  { match: (p) => p === '/api/demo' || p.startsWith('/api/demo/'), port: 4008, name: 'demo' },
  { match: (p) => p === '/api/village' || p.startsWith('/api/village/'), port: 4008, name: 'village' },
  { match: (p) => p === '/api/orbit' || p.startsWith('/api/orbit/'), port: 4008, name: 'orbit' },
];

function pathOnly(url) {
  return String(url ?? '').split('?')[0].split('#')[0];
}

function proxyTarget(path) {
  if (path === '/voice' || path.startsWith('/voice/')) return { deny: true };
  for (const rule of PROXY) if (rule.match(path)) return rule;
  return null;
}

function proxy(req, res, rule) {
  const headers = { ...req.headers, host: `127.0.0.1:${rule.port}` };
  // Hop-by-hop headers must not be forwarded.
  if (headers.connection) delete headers.connection;
  const upstream = httpRequest(
    { host: '127.0.0.1', port: rule.port, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.setTimeout(120_000, () => {
    upstream.destroy(new Error('upstream timeout'));
  });
  upstream.on('error', (err) => {
    process.stderr.write(`[serve-web] proxy ${rule.name} -> ${rule.port} failed: ${err.message}\n`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'UPSTREAM_UNAVAILABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

function resolvePath(url) {
  const raw = pathOnly(url);
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
  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found\n');
    return;
  }
  res.writeHead(status, { ...headersFor(abs, isFallback), 'Content-Length': String(size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(abs);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = createServer((req, res) => {
  const path = pathOnly(req.url);
  const target = proxyTarget(path);

  if (target?.deny) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found\n');
    return;
  }

  if (target) {
    // API routes accept the methods the services do; the proxy forwards the method unchanged.
    proxy(req, res, target);
    return;
  }

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
  process.stdout.write(`[serve-web] listening on 127.0.0.1:${PORT} root=${root} (local API proxy on)\n`);
});

function shutdown(signal) {
  process.stdout.write(`[serve-web] ${signal} received, closing\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
