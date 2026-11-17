#!/usr/bin/env python3
"""Plan parameter sweeps and select from captured runs without tuning on holdout."""
import argparse
from itertools import product
import json

from eval_runner import SECTIONS, benchmark_id, evaluate_suite, load_json, write_report


def plan_grid(grid):
    """Emit run specifications. The runtime adapter must apply these parameters."""
    if not isinstance(grid, dict) or not grid or any(not isinstance(v, list) or not v for v in grid.values()):
        raise ValueError('grid must map parameter names to nonempty lists')
    count = 1
    for values in grid.values():
        count *= len(values)
    if count > 1000:
        raise ValueError('grid exceeds 1000 configurations')
    return [{'id': f'config-{i:03d}', 'parameters': dict(zip(grid, values))}
            for i, values in enumerate(product(*grid.values()), 1)]


def case_ids(suite):
    return {case['id'] for key in SECTIONS for case in suite.get(key, [])}


def objective(report, suite, metric):
    if metric == 'response_latency':
        if 'traces' not in suite['required'] or report['response_latency']['count'] == 0:
            raise ValueError('tuning requires trace cases for response_latency')
        return report['response_latency']
    if not metric.startswith('measurement:'):
        raise ValueError('latency_metric must be response_latency or measurement:<name>')
    name = metric.split(':', 1)[1]
    cases = suite.get('measurements', [])
    if 'measurements' not in suite['required'] or not cases or any(name not in c['limits_ms'] for c in cases):
        raise ValueError('the tuning objective must be gated in every measurement case')
    result = report['named_latency'].get(name)
    if not result or result['count'] != len(cases):
        raise ValueError('tuning objective has missing samples')
    return result


def select_candidate(experiment):
    """All quality gates must pass; then minimize calibration response p95.

    Evaluate only the selected candidate's holdout for acceptance. Never choose
    a different winner because its holdout looks better. Output is a suggestion,
    not a runtime config change. Captures can be synthetic or recorded, not mixed.
    """
    candidates = experiment['candidates']
    metric = experiment.get('latency_metric', 'response_latency')
    if not isinstance(candidates, list) or not candidates:
        raise ValueError('experiment needs candidates')
    seen, signatures, sources, rows = set(), None, set(), []
    for candidate in candidates:
        name = candidate['id']
        if not isinstance(name, str) or not name or name in seen:
            raise ValueError('candidate IDs must be unique and nonempty')
        if not isinstance(candidate['parameters'], dict) or not candidate['parameters']:
            raise ValueError('candidate needs actual runtime parameters')
        seen.add(name)
        calibration, holdout = candidate['calibration'], candidate['holdout']
        if set(calibration['required']) != set(holdout['required']):
            raise ValueError('holdout must retain the calibration coverage requirements')
        if not set(calibration['required']).intersection({'tasks', 'context', 'asr', 'retrieval'}):
            raise ValueError('tuning needs at least one required quality section')
        if case_ids(calibration) & case_ids(holdout):
            raise ValueError('calibration and holdout case IDs overlap')
        current_signatures = (benchmark_id(calibration), benchmark_id(holdout))
        if signatures is not None and current_signatures != signatures:
            raise ValueError('all candidates must use identical benchmark contracts')
        signatures = current_signatures
        sources.update((calibration['source'], holdout['source']))
        report = evaluate_suite(calibration)
        timing = objective(report, calibration, metric)
        rows.append({'id': name, 'passed': report['passed'],
                     'objective_p95_ms': timing['p95_ms']})
    if len(sources) != 1:
        raise ValueError('cannot mix synthetic and recorded experiments')
    eligible = [row for row in rows if row['passed']]
    if not eligible:
        return {'source': next(iter(sources)), 'accepted': False, 'selected': None,
                'reason': 'No configuration passes calibration gates', 'calibration': rows}
    winner = min(eligible, key=lambda row: (row['objective_p95_ms'], row['id']))['id']
    candidate = next(c for c in candidates if c['id'] == winner)
    holdout_report = evaluate_suite(candidate['holdout'])
    objective(holdout_report, candidate['holdout'], metric)
    return {'source': next(iter(sources)), 'latency_metric': metric, 'selected': winner, 'parameters': candidate['parameters'],
            'accepted': holdout_report['passed'], 'calibration': rows, 'holdout': holdout_report,
            'reason': 'Holdout passed' if holdout_report['passed'] else 'Holdout failed; no automatic fallback'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--grid', help='JSON parameter grid; emits plan only, no paid calls')
    mode.add_argument('--experiments', help='JSON candidate captures with calibration and holdout')
    parser.add_argument('--report')
    args = parser.parse_args()
    try:
        result = {'status': 'plan_only', 'candidates': plan_grid(load_json(args.grid))} if args.grid else select_candidate(load_json(args.experiments))
        if args.report:
            write_report(args.report, result)
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, f'Invalid tuning input: {exc}\n')
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0 if args.grid or result['accepted'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
