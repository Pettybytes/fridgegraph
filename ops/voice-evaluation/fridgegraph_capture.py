#!/usr/bin/env python3
"""Evaluate captured Rosina actions and VoiceTimings without calling providers."""
import argparse
import json
from pathlib import Path

from eval_runner import evaluate_suite, load_json, write_report
from metrics import number

# Source: web/src/features/voice/useRosinaVoice.ts VoiceTimings.
# Preserve the actual boundary: these client fields start AFTER VAD decides.
TIMING_FIELDS = {
    'asrMs': 'asr_ms',
    'rosinaMs': 'rosina_ms',
    'ttsMs': 'tts_ms',
    'serverTotalMs': 'server_total_ms',
    'speechEndToReplyMs': 'decision_to_reply_ms',
    'speechEndToAudioMs': 'decision_to_playback_ms',
}


def to_suite(capture):
    if capture.get('capture_version') != 1:
        raise ValueError('capture_version must be 1')
    if capture.get('clock_basis') != 'voice_hook_end_of_speech_decision':
        raise ValueError('declare the VoiceTimings end-of-speech decision boundary')
    if capture.get('source') not in {'synthetic', 'recorded'}:
        raise ValueError('declare synthetic or recorded source')
    if not isinstance(capture.get('runtime_revision'), str) or not capture['runtime_revision']:
        raise ValueError('runtime_revision is required')
    if not isinstance(capture.get('cases'), list) or not capture['cases']:
        raise ValueError('capture requires cases')
    suite = {'schema_version': 2, 'source': capture['source'], 'required': ['tasks', 'measurements'],
             'tasks': [], 'measurements': []}
    for case in capture['cases']:
        case_id, observation = case['id'], case['observation']
        if not isinstance(case_id, str) or not case_id:
            raise ValueError('case id is required')
        if not isinstance(observation, dict) or not isinstance(observation.get('actions'), list):
            raise ValueError('observation.actions must be explicitly captured, even when empty')
        if not isinstance(case.get('expected_actions'), list):
            raise ValueError('expected_actions must be independently specified')
        timings = observation.get('timings', {})
        if not isinstance(timings, dict):
            raise ValueError('observation.timings must be an object')
        metrics = {target: number(timings[source], source) for source, target in TIMING_FIELDS.items()
                   if source in timings and timings[source] is not None}
        limits = case['limits_ms']
        if not isinstance(limits, dict) or not limits or any(name not in TIMING_FIELDS.values() for name in limits):
            raise ValueError('limits_ms must use supported, explicitly named timing metrics')
        inputs = {'scenario': case['scenario'], 'clock_basis': capture['clock_basis']}
        suite['tasks'].append({'id': f'{case_id}:actions', 'input': inputs,
                               'actual': {'actions': observation['actions']},
                               'expected': {'actions': case['expected_actions']}})
        suite['measurements'].append({'id': f'{case_id}:timings', 'input': inputs,
                                      'metrics_ms': metrics, 'limits_ms': limits})
    # The current VoiceTimings object contains no physical speech-end or barge-in
    # timestamps. Never fabricate those events by summing server durations.
    return suite


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', required=True)
    parser.add_argument('--suite-output', help='optional normalized input for baseline/tuning workflows')
    parser.add_argument('--report')
    args = parser.parse_args()
    try:
        capture = load_json(args.capture)
        suite = to_suite(capture)
        report = evaluate_suite(suite)
        report['capture_provenance'] = {'runtime_revision': capture['runtime_revision'],
                                        'clock_basis': capture['clock_basis']}
        report['limitations'] = ['No acoustic speech-end or interruption proof in VoiceTimings.',
                                 'Action contract equality does not prove a mutation or permission check occurred.']
        if args.suite_output:
            write_report(args.suite_output, suite)
        if args.report:
            write_report(args.report, report)
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, f'Invalid FridgeGraph capture: {exc}\n')
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
