/**
 * Server-side mirror of `web/src/features/rosina/catalog.ts` — the SAME authority the web app
 * validates against, kept here because this service cannot import across the web/src boundary
 * (different build, different path aliases). `ops/rosina-catalog-drift.mjs` diffs
 * CATALOG_MANIFEST against the real web file's source text so the two cannot silently diverge.
 *
 * This mirror only needs to REJECT what the catalog would reject — never to invent new
 * permissiveness. When in doubt, this file must be at least as strict as the web one.
 */

export type Screen = 'mission-control' | 'village' | 'care-information' | 'ask-rosina';
export type ExplainableScreen = Screen | 'calendar';

export type ActionArgs = {
  'open-calendar': { day: string; childId: string };
  'open-event': { id: string };
  'open-screen': { screen: Screen };
  'open-person': { personId: string };
  'start-pickup': { childId: string; date: string; window: 'morning' | 'afternoon' | 'evening' };
  'explain-screen': { screen: ExplainableScreen };
  'explain-recommendation': Record<string, never>;
};

export type ActionId = keyof ActionArgs;
export type CatalogAction = { [Id in ActionId]: { id: Id; args: ActionArgs[Id] } }[ActionId];

type ArgsSchema<T> = { parse(value: unknown): T | null };
type CatalogEntry<Id extends ActionId> = {
  id: Id;
  argsSchema: ArgsSchema<ActionArgs[Id]>;
  routeOrHandler: 'route' | 'person-card' | 'pickup' | 'explain';
  changesData: boolean;
  implemented: boolean;
};

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Same calendar-day check as web/src/features/calendar/time.ts#validDay, duplicated: this file
 * must have no dependency on web/. */
function validDay(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function screenArgs(value: unknown): { screen: Screen } | null {
  return record(value, ['screen']) &&
    (value.screen === 'mission-control' ||
      value.screen === 'village' ||
      value.screen === 'care-information' ||
      value.screen === 'ask-rosina')
    ? { screen: value.screen }
    : null;
}

const personId = (value: unknown): value is string =>
  typeof value === 'string' && /^p_[a-z0-9_]{1,60}$/.test(value);

function pickupArgs(value: unknown): ActionArgs['start-pickup'] | null {
  if (!record(value, ['childId', 'date', 'window']) || !personId(value.childId) || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return null;
  const date = new Date(`${value.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.date || !['morning', 'afternoon', 'evening'].includes(String(value.window))) return null;
  return { childId: value.childId, date: value.date, window: value.window as ActionArgs['start-pickup']['window'] };
}

export const catalog: { [Id in ActionId]: CatalogEntry<Id> } = {
  'open-calendar': { id: 'open-calendar', argsSchema: { parse: (value) => (record(value, ['day', 'childId']) && validDay(value.day) && personId(value.childId) ? { day: value.day, childId: value.childId } : null) }, routeOrHandler: 'route', changesData: false, implemented: true },
  'open-event': { id: 'open-event', argsSchema: { parse: (value) => (record(value, ['id']) && typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.id) ? { id: value.id } : null) }, routeOrHandler: 'route', changesData: false, implemented: true },
  'open-screen': { id: 'open-screen', argsSchema: { parse: screenArgs }, routeOrHandler: 'route', changesData: false, implemented: true },
  'open-person': { id: 'open-person', argsSchema: { parse: (value) => (record(value, ['personId']) && personId(value.personId) ? { personId: value.personId } : null) }, routeOrHandler: 'person-card', changesData: false, implemented: true },
  'start-pickup': { id: 'start-pickup', argsSchema: { parse: pickupArgs }, routeOrHandler: 'pickup', changesData: true, implemented: true },
  'explain-screen': { id: 'explain-screen', argsSchema: { parse: (value) => screenArgs(value) ?? (record(value, ['screen']) && value.screen === 'calendar' ? { screen: 'calendar' } : null) }, routeOrHandler: 'explain', changesData: false, implemented: true },
  'explain-recommendation': { id: 'explain-recommendation', argsSchema: { parse: (value) => (record(value, []) ? {} : null) }, routeOrHandler: 'explain', changesData: false, implemented: true },
};

/** Diffed against the real web catalog by ops/rosina-catalog-drift.mjs. Keep in id order. */
export const CATALOG_MANIFEST = (Object.keys(catalog) as ActionId[]).map((id) => ({
  id,
  routeOrHandler: catalog[id].routeOrHandler,
  changesData: catalog[id].changesData,
  implemented: catalog[id].implemented,
}));

/** Drop unknown ids, unimplemented ids, and anything whose args fail the schema. Never widen. */
export function validateActions(input: unknown): CatalogAction[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') return [];
    const id = (item as { id: string }).id;
    if (!Object.hasOwn(catalog, id)) return [];
    const entry = catalog[id as ActionId];
    if (!entry.implemented) return [];
    const args = entry.argsSchema.parse((item as { args?: unknown }).args);
    return args ? [{ id, args } as CatalogAction] : [];
  });
}
