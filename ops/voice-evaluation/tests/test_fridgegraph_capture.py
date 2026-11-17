import copy
from pathlib import Path
import unittest

from eval_runner import evaluate_suite, load_json
from fridgegraph_capture import to_suite
from tune import select_candidate

ROOT = Path(__file__).resolve().parents[1]


def capture():
    return load_json(ROOT / 'test_cases/fridgegraph_capture.json')


class FridgeGraphCaptureTests(unittest.TestCase):
    def test_real_field_names_keep_decision_boundary(self):
        report = evaluate_suite(to_suite(capture()))
        self.assertTrue(report['passed'])
        self.assertEqual(report['named_latency']['decision_to_playback_ms']['p95_ms'], 1800)
        self.assertEqual(report['response_latency']['count'], 0)
        self.assertIsNone(report['interruption_stop']['p95_ms'])
        self.assertEqual(report['coverage']['traces']['status'], 'not_evaluated')

    def test_missing_browser_timing_fails_instead_of_summing_stages(self):
        data = capture()
        del data['cases'][0]['observation']['timings']['speechEndToAudioMs']
        self.assertFalse(evaluate_suite(to_suite(data))['passed'])

    def test_wrong_child_or_corrected_day_fails(self):
        for field, value in [('childId', 'p_jax'), ('day', '2026-11-18')]:
            data = capture()
            data['cases'][1]['observation']['actions'][0]['args'][field] = value
            self.assertFalse(evaluate_suite(to_suite(data))['passed'])

    def test_mistaken_clock_boundary_rejected(self):
        data = capture()
        data['clock_basis'] = 'physical_speech_end'
        with self.assertRaises(ValueError):
            to_suite(data)

    def test_missing_actions_cannot_pass_as_empty(self):
        data = capture()
        del data['cases'][0]['observation']['actions']
        with self.assertRaises(ValueError):
            to_suite(data)

    def test_capture_does_not_export_tokens_or_audio(self):
        data = capture()
        data['cases'][0]['observation']['audioBase64'] = 'not-real-audio'
        data['cases'][0]['observation']['session'] = {'access_token': 'test-only'}
        normalized = str(to_suite(data))
        self.assertNotIn('audioBase64', normalized)
        self.assertNotIn('access_token', normalized)

    def test_latency_failure_is_visible(self):
        data = capture()
        data['cases'][0]['observation']['timings']['speechEndToAudioMs'] = 9000
        self.assertFalse(evaluate_suite(to_suite(data))['passed'])

    def test_tuning_accepts_normalized_captures_and_rejects_wrong_actions(self):
        data = capture()
        calibration = to_suite(data)
        holdout_capture = copy.deepcopy(data)
        for case in holdout_capture['cases']:
            case['id'] = 'holdout-' + case['id']
            case['scenario'] = 'Separate held-out demo observation: ' + case['scenario']
        holdout = to_suite(holdout_capture)
        experiment = {'latency_metric': 'measurement:decision_to_playback_ms',
                      'candidates': [{'id': 'baseline', 'parameters': {'ELEVENLABS_TTS_MODEL': 'baseline'},
                                      'calibration': calibration, 'holdout': holdout}]}
        self.assertTrue(select_candidate(experiment)['accepted'])
        experiment['candidates'][0]['calibration']['tasks'][1]['actual']['actions'] = []
        self.assertFalse(select_candidate(experiment)['accepted'])


if __name__ == '__main__':
    unittest.main()
