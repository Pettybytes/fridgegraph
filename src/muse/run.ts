/**
 * Muse CLI — one real model conversation that must go through the graph.
 *
 *   tsx src/muse/run.ts --provider meta|baseten --person p_mom --child p_nora \
 *       [--as-of YYYY-MM-DD] [--mcp http://127.0.0.1:5050/mcp] [--smoke] [--json]
 *
 * Sign-in is the real Supabase password grant for the named demo person: Muse acts as that
 * caller and holds nothing else. No service-role key, no pinned identity.
 *
 * Output never contains a token or a key. The bearer is shown redacted with its length only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { runMuse } from './index';
import { chat, MuseConfigError, resolveProvider, type ProviderId } from './providers';

type Cred = { personId: string; password: string };

function loadRuntime(): void {
  if (existsSync('.env')) (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile('.env');
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`MISSING_ENV: ${name}`);
  return value.trim();
}

function emailForPerson(personId: string): { email: string; password: string } {
  const path = '.demo-credentials';
  if (!existsSync(path)) throw new Error('MISSING_FILE: .demo-credentials');
  const creds = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Cred>;
  const hit = Object.entries(creds).find(([, v]) => v.personId === personId);
  if (!hit) throw new Error(`NO_DEMO_CREDENTIAL: ${personId}`);
  return { email: hit[0], password: hit[1].password };
}

/** Password grant. The token lives in memory for this process only. */
async function signIn(personId: string): Promise<string> {
  const base = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  const apikey = requireEnv('SUPABASE_PUBLISHABLE_KEY');
  const { email, password } = emailForPerson(personId);

  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`SIGNIN_FAILED: ${personId} HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`SIGNIN_NO_TOKEN: ${personId}`);
  return body.access_token;
}

function redact(token: string): string {
  return `Bearer ${token.slice(0, 6)}…<redacted, ${token.length} chars>`;
}

async function main(): Promise<void> {
  loadRuntime();
  const args = parseArgs(process.argv.slice(2));

  const provider = String(args.provider ?? 'baseten') as ProviderId;
  const person = String(args.person ?? 'p_mom');
  const childId = String(args.child ?? 'p_nora');
  const asOf = args['as-of'] ? String(args['as-of']) : undefined;
  const mcpUrl = String(args.mcp ?? 'http://127.0.0.1:5050/mcp');
  const smoke = args.smoke === true;
  const json = args.json === true;

  const config = resolveProvider(provider);
  const bearer = await signIn(person);

  if (smoke) {
    const result = await chat(config, [{ role: 'user', content: 'Reply with exactly: MUSE_SMOKE_OK' }], undefined, {
      maxTokens: 300,
    });
    const payload = {
      kind: 'smoke',
      provider,
      model: config.model,
      identity: redact(bearer),
      content: result.content,
      reasoningField: result.reasoningField ?? null,
      reasoningChars: result.reasoning?.length ?? 0,
      reasoningPreview: result.reasoning ? result.reasoning.slice(0, 400) : null,
      messageKeys: result.messageKeys,
      usage: result.usage,
      usageKeys: result.usageKeys,
      latencyMs: result.latencyMs,
      httpStatus: result.rawSummary.status,
    };
    console.log(json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload, null, 2));
    return;
  }

  const result = await runMuse({
    question:
      String(
        args.question ??
          'Nora needs an early pickup. Who should we ask first, and who else is available?',
      ),
    childId,
    asOf,
    bearer,
    provider,
    mcpUrl,
  });

  const payload = {
    kind: 'muse',
    provider,
    model: result.model,
    identity: redact(bearer),
    childId,
    asOf: asOf ?? null,
    answer: result.answer,
    refusal: result.refusal,
    toolCalls: result.toolCalls,
    grounding: result.grounding,
    usage: result.usage,
    totalLatencyMs: result.totalLatencyMs,
    rounds: result.rounds.map((r, i) => ({
      round: i + 1,
      latencyMs: r.latencyMs,
      finishReason: r.finishReason ?? null,
      toolCallCount: r.toolCalls.length,
      reasoningField: r.reasoningField ?? null,
      reasoningChars: r.reasoning?.length ?? 0,
      usage: r.usage,
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error: unknown) => {
  const err = error as Error;
  if (err instanceof MuseConfigError) {
    console.error(`BLOCKED ${err.message}`);
    console.error(`missing_fields=${err.missing.join(',')} provider=${err.provider}`);
    process.exitCode = 2;
    return;
  }
  console.error(`ERROR ${err.name}: ${err.message}`);
  process.exitCode = 1;
});
