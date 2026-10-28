#!/usr/bin/env node
/**
 * check-secrets.mjs — offline secret scan for FridgeGraph.
 *
 * Scans tracked files plus the staged diff. No network, no credentials, no dependencies.
 * Exits 1 on any finding, 0 when clean.
 *
 * Never prints a secret, a preview, a partial value or a length. Each finding prints as exactly
 * one line: `path:line [rule-id]`.
 *
 * Usage:  node scripts/check-secrets.mjs [--all|--staged] [--quiet]
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'

const args = new Set(process.argv.slice(2))
const STAGED_ONLY = args.has('--staged')
const QUIET = args.has('--quiet')

const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.venv|venv)(\/|$)/
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.DS_Store)$/
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf', '.woff', '.woff2',
  '.ttf', '.eot', '.mp4', '.mov', '.mp3', '.wav', '.zip', '.gz', '.dmg', '.wasm', '.map',
])
const MAX_BYTES = 1_500_000

// Lines that mention a name, a shape, or a deliberate placeholder are not leaks.
const ALLOW = [
  /REDACTED/i, /\*\*\*/, /<[A-Za-z_][A-Za-z0-9_]*>/, /example/i, /placeholder/i,
  /not-a-real/i, /test-only/i, /dummy/i, /\.invalid\b/i, /xxxx/i, /your[_-]/i,
  /process\.env\./, /os\.environ/, /\$\{/, /%[A-Z_]+%/, /^\s*#/, /^\s*\/\//,
]

const RULES = [
  {
    id: 'private-key-block',
    re: /-----BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
    why: 'private key material',
  },
  {
    id: 'aws-access-key',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    why: 'AWS access key id',
  },
  {
    id: 'postgres-url-with-password',
    re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@/,
    why: 'database URL with inline password',
  },
  {
    id: 'jwt-literal',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    why: 'JWT literal in source',
  },
  {
    id: 'known-secret-assignment',
    re: /\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|SUPABASE_JWKS_URL|APOLLO_KEY|META_API_KEY|SUPABASE_PUBLISHABLE_KEY|VITE_SUPABASE_PUBLISHABLE_KEY)\b\s*[:=]\s*["']?([A-Za-z0-9._:\/-]{16,})/,
    why: 'known secret variable assigned a literal value',
    group: 2,
  },
  {
    id: 'generic-assignment',
    re: /\b(api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|pwd)\b\s*[:=]\s*["']([^"'\s]{16,})["']/i,
    why: 'generic credential assignment',
    group: 2,
  },
]

const SENSITIVE_FILENAMES = [
  { re: /(^|\/)\.env$/, why: 'real .env file is tracked' },
  { re: /(^|\/)\.env\.(?!example$)[A-Za-z0-9_.-]+$/, why: 'real .env.* file is tracked' },
  { re: /(^|\/)\.demo-credentials$/, why: 'demo credentials file is tracked' },
  { re: /(^|\/)identity-map\.json$/, why: 'identity map is tracked' },
  { re: /\.(pem|p12|pfx|key)$/, why: 'key material file is tracked' },
]

function git(listArgs) {
  try {
    return execFileSync('git', listArgs, { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function skipped(path) {
  if (SKIP_DIRS.test(path) || SKIP_FILES.test(path)) return true
  if (SKIP_EXT.has(extname(path).toLowerCase())) return true
  return false
}

function gather() {
  const files = new Set()
  const listed = STAGED_ONLY
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
    : git(['ls-files'])
  for (const f of listed) files.add(f)
  if (!STAGED_ONLY) {
    for (const f of git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])) files.add(f)
  }
  return [...files].filter((f) => !skipped(f))
}

function scanFile(path) {
  const findings = []
  const base = path.split('/').pop()

  for (const { re } of SENSITIVE_FILENAMES) {
    if (re.test(base) || re.test(path)) findings.push({ path, line: 0, rule: 'sensitive-filename' })
  }

  let text
  try {
    if (statSync(path).size > MAX_BYTES) return findings
    text = readFileSync(path, 'utf8')
  } catch {
    return findings
  }
  if (text.includes('\u0000')) return findings // binary

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 4000) continue
    if (ALLOW.some((a) => a.test(line))) continue

    for (const rule of RULES) {
      if (!rule.re.test(line)) continue
      findings.push({ path, line: i + 1, rule: rule.id })
      break // one finding per line is enough
    }
  }
  return findings
}

const files = gather()
const findings = files.flatMap(scanFile)

if (!QUIET) {
  console.log(`check-secrets: scanned ${files.length} file(s)${STAGED_ONLY ? ' (staged)' : ''}`)
}

if (findings.length === 0) {
  if (!QUIET) console.log('check-secrets: clean — 0 findings')
  process.exit(0)
}

console.error(`check-secrets: ${findings.length} finding(s)`)
for (const f of findings) {
  console.error(`${f.path}:${f.line} [${f.rule}]`)
}
process.exit(1)
