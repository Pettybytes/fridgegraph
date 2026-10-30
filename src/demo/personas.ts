/**
 * The demo persona allow-list — server code, never client input.
 *
 * WHY A SERVER LIST: the web picker sends a `personaId`. It must never be able to name an identity
 * by `personId`, by email, or by any other selector. This file is the only place a personaId becomes
 * a person, and anything not listed here is UNAVAILABLE rather than "close enough".
 *
 * READY is derived, never hardcoded: a persona is ready when the identity map (the same server-side
 * map verifyBearer() resolves against) already contains its personId, which only happens when the
 * seed created a real Supabase Auth user for it. The four Cast v2 personas with no seeded user are
 * therefore UNAVAILABLE, and no other identity is ever substituted for them.
 *
 * This module holds no secret: the emails are fictional example.com addresses, and a session is only
 * ever minted for one that exists in Supabase Auth.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type DemoPersona = {
  id: string;
  personId: string;
  email: string;
  name: string;
  role: string;
  childId: string;
  childName: string;
  villageId: string;
  grants: readonly string[];
  parent: boolean;
  guardian?: boolean;
  initialRoute?: 'calendar' | 'village';
};

/** Cast v2 personas plus the Demo guide. Order matches the picker. */
export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    id: 'demo-guide',
    personId: 'p_demo_guide',
    email: 'demo.guide@example.com',
    name: 'Demo guide',
    role:
      'Demo guide: sees the whole fictional ecosystem. No real family would have this view.',
    childId: 'p_nora',
    childName: 'Nora Ellison',
    villageId: 'v_nora',
    grants: [],
    parent: false,
    initialRoute: 'village',
  },
  {
    id: 'kendra',
    personId: 'p_mom',
    email: 'kendra.ellison@example.com',
    name: 'Kendra',
    role: "Nora's mom",
    childId: 'p_nora',
    childName: 'Nora Ellison',
    villageId: 'v_nora',
    grants: [],
    parent: true,
  },
  {
    id: 'andre',
    personId: 'p_dad',
    email: 'andre.ellison@example.com',
    name: 'Andre',
    role: "Nora's dad",
    childId: 'p_nora',
    childName: 'Nora Ellison',
    villageId: 'v_nora',
    grants: [],
    parent: true,
  },
  {
    id: 'loretta',
    personId: 'p_gma',
    email: 'loretta.brooks@example.com',
    name: 'Loretta',
    role: "Nora's grandma · pickup, schedule and goals",
    childId: 'p_nora',
    childName: 'Nora Ellison',
    villageId: 'v_nora',
    grants: ['pickup.request', 'schedule.read', 'goals.read'],
    parent: false,
  },
  {
    id: 'priya',
    personId: 'p_priya',
    email: 'priya.nair@example.com',
    name: 'Priya',
    role: "Nora's sitter · schedule and care information",
    childId: 'p_nora',
    childName: 'Nora Ellison',
    villageId: 'v_nora',
    grants: ['supervise.request', 'schedule.read', 'careplan.read'],
    parent: false,
  },
  {
    id: 'dana',
    personId: 'p_dana',
    email: 'dana.coleman@example.com',
    name: 'Dana',
    role: "New to Nora's village · Jax's mom",
    childId: 'p_jax',
    childName: 'Jax Coleman',
    villageId: 'v_jax',
    grants: [],
    parent: true,
  },
  {
    id: 'jax-family',
    personId: 'p_ray',
    email: 'ray.coleman@example.com',
    name: "Jax's family",
    role: "Ray · Jax's dad",
    childId: 'p_jax',
    childName: 'Jax Coleman',
    villageId: 'v_jax',
    grants: [],
    parent: true,
  },
  {
    id: 'rosa',
    personId: 'p_rosa',
    email: 'rosa.castellano@example.com',
    name: 'Rosa Castellano',
    role: "Emma's grandmother and guardian",
    childId: 'p_emma',
    childName: 'Emma',
    villageId: 'v_emma',
    grants: [],
    parent: false,
    guardian: true,
    initialRoute: 'calendar',
  },
  {
    id: 'felicia',
    personId: 'p_felicia',
    email: 'felicia.reyes@example.com',
    name: 'Felicia Reyes',
    role: "Taylor's mom",
    childId: 'p_taylor',
    childName: 'Taylor',
    villageId: 'v_taylor',
    grants: [],
    parent: true,
    initialRoute: 'village',
  },
  {
    id: 'simone',
    personId: 'p_simone',
    email: 'simone.lee@example.com',
    name: 'Simone Lee',
    role: 'Micah and Avery’s mom',
    childId: 'p_micah',
    childName: 'Micah',
    villageId: 'v_micah',
    grants: [],
    parent: true,
    initialRoute: 'village',
  },
  {
    id: 'dwayne',
    personId: 'p_dwayne',
    email: 'dwayne.ferris@example.com',
    name: 'Dwayne Ferris',
    role: "Malik's dad",
    childId: 'p_malik',
    childName: 'Malik',
    villageId: 'v_malik',
    grants: [],
    parent: true,
    initialRoute: 'calendar',
  },
];

export function personaById(id: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find((p) => p.id === id);
}

export function identityMapPath(): string {
  return process.env.IDENTITY_MAP_PATH ?? join(process.cwd(), 'data', 'identity-map.json');
}

/**
 * The personIds that actually have a Supabase Auth user, read from the same map the verifier uses.
 * Re-read on change so a seed run is picked up without a restart.
 */
let cachedPersonIds = new Set<string>();
let cachedMtimeMs = -1;

export function readyPersonIds(): Set<string> {
  const path = identityMapPath();
  if (!existsSync(path)) return new Set();
  const mtimeMs = statSync(path).mtimeMs;
  if (mtimeMs !== cachedMtimeMs) {
    try {
      const map = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
      cachedPersonIds = new Set(Object.values(map));
      cachedMtimeMs = mtimeMs;
    } catch {
      cachedPersonIds = new Set();
    }
  }
  return cachedPersonIds;
}

export function isReady(persona: DemoPersona): boolean {
  return readyPersonIds().has(persona.personId);
}

/** The response shape the web AuthAdapter consumes. Tokens are present on READY only. */
export type DemoLoginResponse =
  | {
      status: 'READY';
      personaId: string;
      personId: string;
      persona: {
        id: string;
        personId: string;
        name: string;
        role: string;
        childId: string;
        childName: string;
        villageId: string;
        grants: readonly string[];
        parent: boolean;
        guardian?: boolean;
        initialRoute?: 'calendar' | 'village';
      };
      scope: { childId: string; childName: string; parentName: string; villageId: string };
      session: {
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        expires_at: number;
      };
      marks: { demo: true; demoGuide: boolean };
    }
  | { status: 'UNAVAILABLE'; personaId: string; reason: string };

export function readyPersona(id: string): DemoPersona | null {
  const persona = personaById(id);
  if (!persona) return null;
  return isReady(persona) ? persona : null;
}
