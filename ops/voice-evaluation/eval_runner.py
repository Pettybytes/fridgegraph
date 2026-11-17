#!/usr/bin/env python3
"""Evaluate captured observations; offline by default, no provider calls."""
import argparse
import hashlib
import json
from pathlib import Path

from metrics import distribution, number
from nlp_accuracy import evaluate_task, evaluate_context, word_error_rate
from rag_evaluation import evaluate_retrieval
from turn_taking_tests import evaluate_trace

SECTIONS = ('tasks', 'context', 'traces', 'asr', 'retrieval', 'measurements')
# Observation fields are intentionally excluded from benchmark identity.
CONTRACT_FIELDS = {
    'tasks': ('id', 'input', 'expected'),
    'context': ('id', 'probe_index', 'expected'),
    'traces': ('id', 'scenario', 'limits', 'require_interruption'),
    'asr': ('id', 'reference', 'max_wer'),
    'retrieval': ('id', 'query', 'relevant_ids', 'k', 'min_recall', 'require_citations'),
    'measurements': ('id', 'input', 'limits_ms'),
}


def load_json(path):
    def invalid_constant(value):
        raise ValueError(f'non-finite JSON value: {value}')
    return json.loads(Path(path).read_text(), parse_constant=invalid_constant)


def benchmark_contract(data):
    contract = {'schema_version': data['schema_version'], 'required': sorted(data['required'])}
    for section in SECTIONS:
        cases = []
        for case in data.get(section, []):
            entry = {key: case[key] for key in CONTRACT_FIELDS[section] if key in case}
            if section == 'context':
                entry['user_turns'] = [turn for turn in case['dialogue'] if turn.get('role') == 'user']
            cases.append(entry)
        contract[section] = sorted(cases, key=lambda c: c['id'])
    return contract


def benchmark_id(data):
    return hashlib.sha256(json.dumps(benchmark_contract(data), sort_keys=True).encode()).hexdigest()


def evaluate_suite(data):
    if data.get('schema_version') != 2:
        raise ValueError('schema_version must be 2; legacy overlap fixtures are not supported')
    if data.get('source') not in {'synthetic', 'recorded'}:
        raise ValueError('source must explicitly be synthetic or recorded')
    required = data.get('required')
    if not isinstance(required, list) or not required or any(s not in SECTIONS for s in required) or len(set(required)) != len(required):
        raise ValueError('required must list unique supported sections')
    rows, ids, coverage = {}, set(), {}
    for section in SECTIONS:
        cases = data.get(section, [])
        if not isinstance(cases, list):
            raise ValueError(f'{section} must be a list')
        rows[section] = []
        coverage[section] = {'count': len(cases), 'status': 'evaluated' if cases else 'not_evaluated',
                             'required': section in required}
        for case in cases:
            case_id = case.get('id')
            if not isinstance(case_id, str) or not case_id or case_id in ids:
                raise ValueError('case IDs must be nonempty and globally unique')
            ids.add(case_id)
            if section == 'tasks':
                result = evaluate_task(case['actual'], case['expected'])
            elif section == 'context':
                result = evaluate_context(case)
            elif section == 'traces':
                result = evaluate_trace(case)
            elif section == 'asr':
                threshold = number(case['max_wer'], 'max_wer')
                wer = word_error_rate(case['reference'], case['hypothesis'])
                result = {'wer': wer, 'passed': wer <= threshold}
            elif section == 'retrieval':
                result = evaluate_retrieval(case)
            else:
                limits, values = case['limits_ms'], case['metrics_ms']
                if not isinstance(limits, dict) or not limits or not isinstance(values, dict):
                    raise ValueError('measurements need nonempty limits_ms and a metrics_ms object')
                for name, value in values.items():
                    number(value, name)
                checks = {name: name in values and values[name] <= number(limit, name)
                          for name, limit in limits.items()}
                # Validate limits even when the corresponding observation is absent.
                for name, limit in limits.items():
                    number(limit, name)
                result = {'passed': all(checks.values()), 'checks': checks, 'metrics_ms': values}
            rows[section].append({'id': case_id, **result})
    if not ids:
        raise ValueError('empty evaluation suite')
    response_times = [turn['response_ms'] for row in rows['traces'] for turn in row['turns']]
    stop_times = [item['stop_ms'] for row in rows['traces'] for item in row['interruptions']]
    names = sorted({name for row in rows['measurements'] for name in row['metrics_ms']})
    named_latency = {name: distribution([row['metrics_ms'][name] for row in rows['measurements']
                                         if name in row['metrics_ms']]) for name in names}
    missing = [section for section in required if not rows[section]]
    passed = not missing and all(row['passed'] for section in SECTIONS for row in rows[section])
    return {'schema_version': 2, 'source': data['source'], 'benchmark_id': benchmark_id(data),
            'passed': passed, 'missing_required': missing, 'coverage': coverage,
            'response_latency': distribution(response_times), 'interruption_stop': distribution(stop_times),
            'named_latency': named_latency, 'results': rows}


def compare_baseline(current, baseline, max_p95_regression_ms):
    number(max_p95_regression_ms, 'max_p95_regression_ms')
    if baseline.get('schema_version') != 2 or baseline.get('benchmark_id') != current['benchmark_id']:
        raise ValueError('baseline must use the same benchmark contract')
    if baseline.get('source') != current['source']:
        raise ValueError('cannot compare synthetic and recorded baselines')
    changes = {}
    for metric in ('response_latency', 'interruption_stop'):
        before, after = baseline[metric], current[metric]
        if before['count'] != after['count']:
            raise ValueError(f'baseline sample count differs for {metric}')
        if before['p95_ms'] is not None:
            number(before['p95_ms'], 'baseline p95')
            changes[metric] = after['p95_ms'] - before['p95_ms']
    if baseline.get('named_latency', {}).keys() != current['named_latency'].keys():
        raise ValueError('baseline named measurements differ')
    for name, after in current['named_latency'].items():
        before = baseline['named_latency'][name]
        if before['count'] != after['count']:
            raise ValueError(f'baseline sample count differs for {name}')
        number(before['p95_ms'], 'baseline p95')
        changes[f'measurement:{name}'] = after['p95_ms'] - before['p95_ms']
    passed = current['passed'] and all(delta <= max_p95_regression_ms for delta in changes.values())
    return {'passed': passed, 'p95_delta_ms': changes, 'max_p95_regression_ms': max_p95_regression_ms}


def write_report(path, report):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test-set', default='test_cases/sample_eval_set.json')
    parser.add_argument('--report')
    parser.add_argument('--baseline')
    parser.add_argument('--max-p95-regression-ms', type=float, default=100)
    args = parser.parse_args()
    try:
        report = evaluate_suite(load_json(args.test_set))
        if args.baseline:
            report['regression'] = compare_baseline(report, load_json(args.baseline), args.max_p95_regression_ms)
            report['passed'] = report['passed'] and report['regression']['passed']
        if args.report:
            write_report(args.report, report)
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, f'Invalid evaluation input: {exc}\n')
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
