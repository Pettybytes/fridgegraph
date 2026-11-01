/**
 * The driving-route pre-step for the paid-ride evaluation.
 *
 * WHY IT EXISTS
 * `_rank_and_advance` (0060) prices a paid ride from a stored ROAD distance when one matches the
 * coordinate snapshot it consumes, and from haversine with an explicit basis when one does not. Only
 * the map's route endpoint ever wrote that store, so the evaluation almost always fell back to
 * haversine — the original defect with a newer label. This module fills the gap at the only moment
 * it can: after the pickup request creates its candidate set and BEFORE the ranking that prices it
 * (ranking runs on a reply, never inside `request_pickup`).
 *
 * ORDER IS THE CONTRACT
 *   1. authorize the requesting parent for the selected child;
 *   2. only then read the store, and only then call the provider.
 * A caller who is not a parent reaches neither. There is no "warm first, check later" path, and the
 * counter-based tests assert exactly that.
 *
 * WHAT IT MAY DO
 * Bounded (at most `maxPairs`), budgeted (stop scheduling after `budgetMs`), per-caller rate limited,
 * and soft-failing: any provider or storage error leaves the store untouched and the evaluation falls
 * back to the approved, explicitly labelled haversine estimate. Nothing here throws into the
 * request path, and nothing here computes a price — 0060 owns that.
 *
 * NO HTTP IN SQL: the database never calls out; this server-side step does, and only for measurements
 * it then validates (finite, positive, plausible) before handing them to the authorized writer.
 */
import { dbFor, one, rows } from '../db';
import { isParentOf, type Ctx } from '../authz';
import { routeBetween } from './ors';

export type RidePoint = { lat: number; lng: number; placeId: string | null };
export type PricingPair = { childId: string; candidateId: string; from: RidePoint; to: RidePoint };

export type PrewarmDeps = {
  authorize: () => Promise<boolean>;
  pairs: () => Promise<PricingPair[]>;
  storedMiles: (pair: PricingPair) => Promise<number | null>;
  route: (pair: PricingPair) => Promise<{ distanceMeters: number; durationSeconds: number }>;
  store: (pair: PricingPair, measurement: { distanceMeters: number; durationSeconds: number }) => Promise<void>;
  now?: () => number;
};

export type PrewarmReport = {
  authorized: boolean;
  considered: number;
  cached: number;
  measured: number;
  rejected: number;
  failed: number;
  fallback: 'road' | 'haversine' | 'not-run';
};

export const MAX_DISTANCE_METERS = 500_000;
export const DEFAULT_MAX_PAIRS = 4;
export const DEFAULT_BUDGET_MS = 6_000;

/** A measurement is stored only when it is complete and plausible. No proxy, no rounding-up. */
export function isUsableMeasurement(m: { distanceMeters?: unknown; durationSeconds?: unknown }): boolean {
  const d = m.distanceMeters;
  const s = m.durationSeconds;
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0 || d > MAX_DISTANCE_METERS) return false;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 86_400) return false;
  return true;
}

/** Per-caller limit for the pre-step, separate from the map's route limit. */
const buckets = new Map<string, number[]>();
export function allowPrewarm(personId: string, limitPerMin = 6, now = Date.now()): boolean {
  const hits = (buckets.get(personId) ?? []).filter((t) => t > now - 60_000);
  if (hits.length >= limitPerMin) {
    buckets.set(personId, hits);
    return false;
  }
  hits.push(now);
  buckets.set(personId, hits);
  return true;
}

/** Test seam only. */
export function resetPrewarmState(): void {
  buckets.clear();
}

export async function prewarmRideDistances(
  deps: PrewarmDeps,
  options: { maxPairs?: number; budgetMs?: number } = {},
): Promise<PrewarmReport> {
  const maxPairs = options.maxPairs ?? DEFAULT_MAX_PAIRS;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = deps.now ?? Date.now;
  const started = now();
  const empty: PrewarmReport = {
    authorized: false, considered: 0, cached: 0, measured: 0, rejected: 0, failed: 0, fallback: 'not-run',
  };

  // 1. Authority first. A failure here is a refusal, not a soft failure: nothing is read or called.
  let authorized = false;
  try {
    authorized = await deps.authorize();
  } catch {
    authorized = false;
  }
  if (!authorized) return empty;

  let pairs: PricingPair[];
  try {
    pairs = (await deps.pairs()).slice(0, maxPairs);
  } catch {
    return { ...empty, authorized: true, fallback: 'haversine' };
  }

  const report: PrewarmReport = { ...empty, authorized: true, fallback: 'haversine' };

  for (const pair of pairs) {
    if (now() - started > budgetMs) break;
    report.considered += 1;

    let measured = false;
    try {
      // 2. The store is read only after authorization. A fresh match means no provider call at all.
      const stored = await deps.storedMiles(pair);
      if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) {
        report.cached += 1;
        continue;
      }
    } catch {
      // A store read failure is not a refusal and not a measurement; fall through to the provider.
    }

    try {
      const measurement = await deps.route(pair);
      if (!isUsableMeasurement(measurement)) {
        report.rejected += 1;
        continue;
      }
      await deps.store(pair, measurement);
      report.measured += 1;
      measured = true;
    } catch {
      // Provider or storage failure: soft-fail. The evaluation's own haversine basis covers it.
      report.failed += 1;
    }

    if (measured) report.fallback = 'road';
  }

  if (report.measured > 0) report.fallback = 'road';
  return report;
}

/**
 * Real wiring. Authorizes the caller for the child, then resolves the snapshots the ranking consumes:
 * the child's `locations` school point and each current candidate's `locations` point — the same two
 * rows 0060 reads, so a measurement can only ever match a snapshot that will actually be priced.
 */
export async function prewarmForPickupRequest(
  ctx: Ctx,
  childId: string,
  options: { maxPairs?: number; budgetMs?: number } = {},
): Promise<PrewarmReport> {
  const notRun: PrewarmReport = {
    authorized: false, considered: 0, cached: 0, measured: 0, rejected: 0, failed: 0, fallback: 'not-run',
  };
  if (!ctx.callerId || !allowPrewarm(ctx.callerId)) return notRun;

  const client = dbFor(ctx);

  const deps: PrewarmDeps = {
    authorize: async () => isParentOf(ctx, childId),

    pairs: async () => {
      const jobs = await rows(
        client
          .from('coordination_jobs')
          .select('id,status')
          .eq('child_id', childId)
          .eq('status', 'discovering')
          .order('created_at', { ascending: false })
          .limit(1),
      );
      if (!jobs.length) return [];
      const jobId = String(jobs[0].id);

      const evals = await rows(
        client.from('candidate_evaluations').select('candidate_id').eq('job_id', jobId),
      );
      const candidateIds = evals.map((e) => String(e.candidate_id));
      if (!candidateIds.length) return [];

      const school = await one(
        client
          .from('locations')
          .select('id,lat,lng')
          .eq('owner_type', 'CHILD')
          .eq('owner_id', childId)
          .eq('label', 'school')
          .maybeSingle(),
      );
      if (!school || school.lat == null || school.lng == null) return [];

      const origins = await rows(
        client
          .from('locations')
          .select('id,owner_id,lat,lng')
          .eq('owner_type', 'PERSON')
          .in('owner_id', candidateIds),
      );

      return origins
        .filter((o) => o.lat != null && o.lng != null)
        .map((o) => ({
          childId,
          candidateId: String(o.owner_id),
          from: { lat: Number(school.lat), lng: Number(school.lng), placeId: String(school.id ?? '') },
          to: { lat: Number(o.lat), lng: Number(o.lng), placeId: String(o.id ?? '') },
        }));
    },

    storedMiles: async (pair) => {
      const { data, error } = await client.rpc('route_distance_miles', {
        p_from_lat: pair.from.lat,
        p_from_lng: pair.from.lng,
        p_to_lat: pair.to.lat,
        p_to_lng: pair.to.lng,
        p_profile: 'driving-car',
      });
      if (error) throw error;
      const value = Array.isArray(data) ? data[0] : data;
      return value == null ? null : Number(value);
    },

    route: async (pair) =>
      routeBetween(
        'driving-car',
        pair.from.placeId ?? '',
        pair.to.placeId ?? '',
        { lat: pair.from.lat, lng: pair.from.lng },
        { lat: pair.to.lat, lng: pair.to.lng },
      ),

    store: async (pair, measurement) => {
      const { error } = await client.rpc('store_route_result_authorized', {
        p_child: pair.childId,
        p_profile: 'driving-car',
        p_from_place_id: pair.from.placeId,
        p_to_place_id: pair.to.placeId,
        p_from_lat: pair.from.lat,
        p_from_lng: pair.from.lng,
        p_to_lat: pair.to.lat,
        p_to_lng: pair.to.lng,
        p_distance_meters: measurement.distanceMeters,
        p_duration_seconds: measurement.durationSeconds,
      });
      if (error) throw error;
    },
  };

  return prewarmRideDistances(deps, options);
}
