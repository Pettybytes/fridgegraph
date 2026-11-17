import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock
import urllib.error

from eval_runner import evaluate_suite, load_json, compare_baseline
from metrics import distribution
from nlp_accuracy import evaluate_task, evaluate_context, word_error_rate
from rag_evaluation import evaluate_retrieval
from schema_cache import SchemaCache
from trace_capture import TraceRecorder
from turn_taking_tests import evaluate_trace
from tune import select_candidate, plan_grid

ROOT = Path(__file__).resolve().parents[1]


def sample():
    return load_json(ROOT / 'test_cases/sample_eval_set.json')


def experiment():
    return load_json(ROOT / 'test_cases/tuning_example.json')


class TaskTests(unittest.TestCase):
    def test_negation_is_not_correct_because_words_overlap(self):
        self.assertFalse(evaluate_task({'outcome': 'not confirmed'}, {'outcome': 'confirmed'})['passed'])

    def test_missing_or_incorrect_tool_arguments_fail(self):
        expected = {'tool_calls': [{'name': 'book', 'arguments': {'day': 'Thursday'}}]}
        self.assertFalse(evaluate_task({}, expected)['passed'])
        self.assertFalse(evaluate_task({'tool_calls': [{'name': 'book', 'arguments': {'day': 'Tuesday'}}]}, expected)['passed'])

    def test_json_types_and_extra_nested_arguments_are_checked(self):
        self.assertFalse(evaluate_task({'amount': True}, {'amount': 1})['passed'])
        self.assertFalse(evaluate_task({'slots': {'day': 'Thursday', 'cancel': True}}, {'slots': {'day': 'Thursday'}})['passed'])

    def test_correct_intent_with_extra_telemetry_passes(self):
        self.assertTrue(evaluate_task({'intent': 'book', 'duration_ms': 5}, {'intent': 'book'})['passed'])

    def test_empty_ground_truth_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_task({}, {})

    def test_context_cannot_pass_on_user_input(self):
        case = sample()['context'][0]
        case['dialogue'][3]['output'] = {'facts': {'day': 'Tuesday'}}
        self.assertFalse(evaluate_context(case)['passed'])
        case['dialogue'][3]['output'] = {}
        self.assertFalse(evaluate_context(case)['passed'])

    def test_context_probe_cannot_be_a_user_turn(self):
        case = sample()['context'][0]
        case['probe_index'] = 2
        with self.assertRaises(ValueError):
            evaluate_context(case)

    def test_wer_counts_substitutions_deletions_insertions(self):
        self.assertAlmostEqual(word_error_rate('a b c', 'a x c d'), 2 / 3)
        self.assertEqual(word_error_rate('a b c', 'a c'), 1 / 3)
        self.assertEqual(word_error_rate('a', 'a b c'), 2)
        self.assertEqual(word_error_rate('Thursday!', 'thursday'), 0)
        with self.assertRaises(ValueError):
            word_error_rate('', 'something')


class TraceTests(unittest.TestCase):
    def test_exact_playback_latency_and_barge_in(self):
        result = evaluate_trace(sample()['traces'][0])
        self.assertTrue(result['passed'])
        self.assertEqual([t['response_ms'] for t in result['turns']], [600, 600])
        self.assertEqual(result['interruptions'][0]['stop_ms'], 150)
        self.assertEqual(result['interruptions'][0]['cancel_ms'], 50)
        self.assertEqual(result['interruptions'][0]['recovery_ms'], 600)
        self.assertEqual(result['turns'][0]['stages_ms']['llm_request_to_llm_first_token_ms'], 130)

    def test_cancel_ack_does_not_hide_late_playback_stop(self):
        case = sample()['traces'][0]
        next(e for e in case['events'] if e['type'] == 'assistant_audio_stopped' and e['turn_id'] == 'turn-1')['at_ms'] = 2400
        result = evaluate_trace(case)
        self.assertFalse(result['passed'])
        self.assertEqual(result['interruptions'][0]['cancel_ms'], 50)
        self.assertEqual(result['interruptions'][0]['stop_ms'], 400)

    def test_missing_stopped_event_and_missing_recovery_are_rejected(self):
        for kind in ['assistant_audio_stopped', 'assistant_audio_started']:
            case = sample()['traces'][0]
            case['events'] = [e for e in case['events'] if not (e['type'] == kind and e['turn_id'] == 'turn-2')]
            with self.assertRaises(ValueError):
                evaluate_trace(case)

    def test_invalid_nan_negative_and_duplicate_events(self):
        for value in [-1, float('nan'), float('inf'), True]:
            case = sample()['traces'][0]
            case['events'][0]['at_ms'] = value
            with self.assertRaises(ValueError):
                evaluate_trace(case)
        case = sample()['traces'][0]
        case['events'].append(case['events'][0])
        with self.assertRaises(ValueError):
            evaluate_trace(case)

    def test_unannotated_barge_in_rejected(self):
        case = sample()['traces'][0]
        case['interruptions'] = []
        with self.assertRaises(ValueError):
            evaluate_trace(case)

    def test_audio_overlap_fails_even_with_generous_limits(self):
        case = sample()['traces'][0]
        case['limits']['barge_in_ms'] = 5000
        next(e for e in case['events'] if e['type'] == 'assistant_audio_stopped' and e['turn_id'] == 'turn-1')['at_ms'] = 3200
        result = evaluate_trace(case)
        self.assertFalse(result['passed'])
        self.assertEqual(result['audio_overlaps'][0]['overlap_ms'], 100)

    def test_pipeline_order_rejected(self):
        case = sample()['traces'][0]
        next(e for e in case['events'] if e['type'] == 'llm_first_token')['at_ms'] = 999
        with self.assertRaises(ValueError):
            evaluate_trace(case)

    def test_recorder_uses_elapsed_monotonic_ms_and_copies(self):
        recorder = TraceRecorder(clock=Mock(side_effect=[5_000_000, 7_500_000]))
        recorder.mark('user_speech_started', 't1')
        snapshot = recorder.snapshot()
        self.assertEqual(snapshot[0]['at_ms'], 2.5)
        snapshot[0]['at_ms'] = 999
        self.assertEqual(recorder.snapshot()[0]['at_ms'], 2.5)

    def test_empty_distribution_is_unavailable(self):
        self.assertEqual(distribution([]), {'count': 0, 'p50_ms': None, 'p95_ms': None, 'max_ms': None})
        self.assertEqual(distribution(list(range(1, 101)))['p95_ms'], 95)


class RagAndCacheTests(unittest.TestCase):
    def test_retrieval_ranks_and_unsupported_citation(self):
        case = sample()['retrieval'][0]
        case['retrieved_ids'].reverse()
        result = evaluate_retrieval(case)
        self.assertEqual(result['recall_at_k'], 1)
        self.assertEqual(result['precision_at_k'], 1 / 3)
        self.assertEqual(result['mrr_at_k'], .5)
        case['citation_ids'] = ['invented']
        self.assertFalse(evaluate_retrieval(case)['passed'])

    def test_empty_retrieval_does_not_pass(self):
        case = sample()['retrieval'][0]
        case['retrieved_ids'] = []
        case['citation_ids'] = []
        self.assertFalse(evaluate_retrieval(case)['passed'])

    def test_duplicate_retrieval_does_not_inflate_scores(self):
        case = sample()['retrieval'][0]
        case['retrieved_ids'] *= 2
        with self.assertRaises(ValueError):
            evaluate_retrieval(case)

    def test_cache_hit_revision_scope_ttl_and_copy(self):
        now = [0]
        cache = SchemaCache(ttl_s=10, clock=lambda: now[0])
        loader = Mock(return_value={'tools': ['book']})
        first, hit = cache.get_or_load('tenant-a:reader', 'tools', 'v1', loader)
        self.assertFalse(hit)
        first['tools'].clear()
        value, hit = cache.get_or_load('tenant-a:reader', 'tools', 'v1', loader)
        self.assertTrue(hit)
        self.assertEqual(value['tools'], ['book'])
        self.assertFalse(cache.get_or_load('tenant-b:reader', 'tools', 'v1', loader)[1])
        self.assertFalse(cache.get_or_load('tenant-a:reader', 'tools', 'v2', loader)[1])
        now[0] = 10
        self.assertFalse(cache.get_or_load('tenant-a:reader', 'tools', 'v1', loader)[1])
        cache.invalidate_scope('tenant-a:reader')
        self.assertFalse(cache.get_or_load('tenant-a:reader', 'tools', 'v1', loader)[1])

    def test_cache_bounds_and_loader_failures(self):
        cache = SchemaCache(capacity=1)
        cache.get_or_load('a', 'tools', 'v1', lambda: {})
        cache.get_or_load('b', 'tools', 'v1', lambda: {})
        self.assertFalse(cache.get_or_load('a', 'tools', 'v1', lambda: {})[1])
        with self.assertRaises(RuntimeError):
            cache.get_or_load('broken', 'tools', 'v1', Mock(side_effect=RuntimeError('offline')))
        self.assertFalse(cache.get_or_load('broken', 'tools', 'v1', lambda: {})[1])


class RunnerAndTuningTests(unittest.TestCase):
    def test_named_measurements_missing_and_invalid_values(self):
        suite = sample()
        suite['required'].append('measurements')
        suite['measurements'] = [{'id': 'client-duration', 'input': {'basis': 'decision to playback'},
                                  'limits_ms': {'decision_to_playback_ms': 3000},
                                  'metrics_ms': {'decision_to_playback_ms': 1200}}]
        report = evaluate_suite(suite)
        self.assertTrue(report['passed'])
        self.assertEqual(report['named_latency']['decision_to_playback_ms']['p95_ms'], 1200)
        suite['measurements'][0]['metrics_ms'] = {}
        self.assertFalse(evaluate_suite(suite)['passed'])
        suite['measurements'][0]['metrics_ms'] = {'decision_to_playback_ms': -1}
        with self.assertRaises(ValueError):
            evaluate_suite(suite)

    def test_named_measurement_tuning_and_regression(self):
        data = experiment()
        data['latency_metric'] = 'measurement:decision_to_playback_ms'
        for index, candidate in enumerate(data['candidates']):
            for split in ('calibration', 'holdout'):
                suite = candidate[split]
                suite['required'].append('measurements')
                suite['measurements'] = [{'id': split + '-timing', 'limits_ms': {'decision_to_playback_ms': 3000},
                                          'metrics_ms': {'decision_to_playback_ms': 1500 - index * 200}}]
        self.assertEqual(select_candidate(data)['selected'], 'balanced')
        suite = data['candidates'][0]['calibration']
        before = evaluate_suite(suite)
        suite['measurements'][0]['metrics_ms']['decision_to_playback_ms'] += 200
        after = evaluate_suite(suite)
        self.assertFalse(compare_baseline(after, before, 100)['passed'])

    def test_holdout_cannot_drop_quality_requirement(self):
        data = experiment()
        data['candidates'][0]['holdout']['required'] = ['traces']
        with self.assertRaises(ValueError):
            select_candidate(data)

    def test_sample_and_failure_suite(self):
        self.assertTrue(evaluate_suite(sample())['passed'])
        result = evaluate_suite(load_json(ROOT / 'test_cases/failing_eval_set.json'))
        self.assertFalse(result['passed'])
        for rows in result['results'].values():
            if rows:
                self.assertTrue(any(not row['passed'] for row in rows))

    def test_missing_coverage_cannot_pass(self):
        suite = sample()
        suite['retrieval'] = []
        report = evaluate_suite(suite)
        self.assertFalse(report['passed'])
        self.assertEqual(report['missing_required'], ['retrieval'])
        with self.assertRaises(ValueError):
            evaluate_suite({'schema_version': 2, 'source': 'synthetic', 'required': ['tasks']})

    def test_duplicate_ids_rejected(self):
        suite = sample()
        suite['tasks'].append(copy.deepcopy(suite['tasks'][0]))
        with self.assertRaises(ValueError):
            evaluate_suite(suite)

    def test_baseline_latency_regression_and_contract_mismatch(self):
        baseline = evaluate_suite(sample())
        suite = sample()
        for e in suite['traces'][0]['events']:
            if e['type'] == 'assistant_audio_started':
                e['at_ms'] += 150
        current = evaluate_suite(suite)
        self.assertTrue(current['passed'])
        self.assertFalse(compare_baseline(current, baseline, 100)['passed'])
        suite['tasks'][0]['expected']['outcome'] = 'changed'
        with self.assertRaises(ValueError):
            compare_baseline(evaluate_suite(suite), baseline, 100)

    def test_tuning_rejects_fast_but_wrong_and_uses_holdout(self):
        result = select_candidate(experiment())
        self.assertEqual(result['selected'], 'balanced')
        self.assertTrue(result['accepted'])
        data = experiment()
        data['candidates'][1]['holdout']['tasks'][0]['actual']['outcome'] = 'failed'
        result = select_candidate(data)
        self.assertEqual(result['selected'], 'balanced')
        self.assertFalse(result['accepted'])  # No fallback selected on holdout.

    def test_tuning_rejects_split_leakage_and_different_cases(self):
        data = experiment()
        data['candidates'][0]['holdout']['tasks'][0]['id'] = 'appointment-confirmed'
        with self.assertRaises(ValueError):
            select_candidate(data)
        data = experiment()
        data['candidates'][1]['calibration']['tasks'][0]['expected']['outcome'] = 'changed'
        with self.assertRaises(ValueError):
            select_candidate(data)

    def test_tuning_cannot_mix_synthetic_and_recorded(self):
        data = experiment()
        data['candidates'][0]['holdout']['source'] = 'recorded'
        with self.assertRaises(ValueError):
            select_candidate(data)

    def test_grid_and_no_candidate_passes(self):
        self.assertEqual(len(plan_grid({'silence_ms': [250, 500], 'cache': [False, True]})), 4)
        data = experiment()
        for c in data['candidates']:
            c['calibration']['tasks'][0]['actual']['outcome'] = 'failed'
        self.assertIsNone(select_candidate(data)['selected'])

    def test_cli_uses_requested_file_and_exit_codes(self):
        for filename, expected in [('sample_eval_set.json', 0), ('failing_eval_set.json', 1)]:
            result = subprocess.run([sys.executable, 'eval_runner.py', '--test-set', f'test_cases/{filename}'], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, expected, result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'bad.json'
            file.write_text('{"schema_version":NaN}')
            result = subprocess.run([sys.executable, 'eval_runner.py', '--test-set', str(file)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('non-finite', result.stderr)


if __name__ == '__main__':
    unittest.main()
