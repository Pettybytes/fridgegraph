/** Per-source read state for Activity.
 *
 * Activity fans out to several independent reads (mission control, permission slips, Orbit status,
 * check-in, Add-a-Villager, school reports). Before this existed, ONE failing read rejected the whole
 * Promise.all and blanked the page with "Activity unavailable" — so a single missing grant hid five
 * healthy sources.
 *
 * The states are deliberately distinct:
 *   ready        — the read succeeded (an empty list is a real, empty answer)
 *   refused      — the caller is known and not allowed (authorization decision)
 *   privilege    — the server cannot read its own object (a deployment/privilege defect)
 *   unavailable  — anything else (transport, transient)
 *
 * `privilege` is NOT `refused` and NOT `UNAUTHORIZED`: a missing table grant is an infrastructure
 * defect, and telling a parent "not shared with you" for it would be a lie about their access.
 */
export type ReadState = 'ready' | 'unavailable' | 'privilege' | 'refused'
export type Source<T> = { state: ReadState; data: T }

const AUTH_CODES = new Set(['UNAUTHORIZED', 'UNAUTHENTICATED', 'AUTH_ERROR'])
const PRIVILEGE_CODES = new Set(['DB_PRIVILEGE'])

/** Apollo can bury the extension code in one of several shapes; read them all, then fall back to a
 * bare code-as-message (the server's opaque convention). */
export function errorCode(error: unknown): string | null {
  const candidate = error as {
    message?: string
    code?: string
    graphQLErrors?: { extensions?: { code?: string } }[]
    errors?: { extensions?: { code?: string } }[]
    networkError?: { result?: { errors?: { extensions?: { code?: string } }[] } }
    result?: { errors?: { extensions?: { code?: string } }[] }
    bodyText?: string
  } | null
  const fromArray = (list?: { extensions?: { code?: string } }[]) =>
    list?.map(e => e.extensions?.code).find((code): code is string => typeof code === 'string' && code.length > 0)
  const found =
    candidate?.code ??
    fromArray(candidate?.graphQLErrors) ??
    fromArray(candidate?.errors) ??
    fromArray(candidate?.networkError?.result?.errors) ??
    fromArray(candidate?.result?.errors)
  if (found) return found
  const message = String(candidate?.message ?? candidate?.bodyText ?? '')
  const bare = /\b([A-Z][A-Z0-9_]{3,})\b/.exec(message)
  return bare ? bare[1] : null
}

export function classifyReadError(error: unknown): Exclude<ReadState, 'ready'> {
  const code = errorCode(error)
  if (code && AUTH_CODES.has(code)) return 'refused'
  if (code && PRIVILEGE_CODES.has(code)) return 'privilege'
  return 'unavailable'
}

export async function attempt<T>(read: () => Promise<T>, fallback: T): Promise<Source<T>> {
  try {
    return { state: 'ready', data: await read() }
  } catch (error) {
    return { state: classifyReadError(error), data: fallback }
  }
}

/** Copy for a failed source. Never contains database text, table names or error codes, and never
 * the release-gate banned words (unavailable / could not be loaded / no records). */
export function sourceNotice(what: string, state: Exclude<ReadState, 'ready'>): { heading: string; body: string } {
  if (state === 'refused') {
    return { heading: `${what} not shared`, body: `This perspective cannot read ${what.toLowerCase()}.` }
  }
  if (state === 'privilege') {
    return {
      heading: `${what} did not answer`,
      body: `${what} hit a server permission problem, not a restriction on your access. It retries on the next refresh.`,
    }
  }
  return { heading: `${what} did not answer`, body: `${what} retries on the next refresh. Other authorized activity is shown below.` }
}
