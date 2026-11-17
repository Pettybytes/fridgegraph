"""Conversation timing from playback events on one monotonic clock."""
from metrics import number

REQUIRED = ('user_speech_started', 'user_speech_ended', 'assistant_audio_started', 'assistant_audio_stopped')
PIPELINE = ('user_speech_ended', 'stt_final', 'llm_request', 'llm_first_token',
            'tts_request', 'tts_first_byte', 'assistant_audio_started')
OPTIONAL = {'stt_final', 'llm_request', 'llm_first_token', 'tts_request', 'tts_first_byte', 'agent_cancelled'}


def evaluate_trace(case):
    """One response audio interval per turn; interruptions link two turn IDs.

    Stop events must come from the playback sink after queued audio is flushed.
    A server cancel acknowledgement is separate, not proof of silence.
    """
    limits = case['limits']
    reply_limit = number(limits['response_ms'], 'response_ms')
    stop_limit = number(limits['barge_in_ms'], 'barge_in_ms')
    if not isinstance(case['events'], list) or not case['events']:
        raise ValueError('trace requires events')
    turns = {}
    for event in case['events']:
        kind, turn_id = event['type'], event['turn_id']
        if kind not in set(REQUIRED) | OPTIONAL:
            raise ValueError(f'unsupported event: {kind}')
        if not isinstance(turn_id, str) or not turn_id:
            raise ValueError('turn_id must be nonempty')
        turn = turns.setdefault(turn_id, {})
        if kind in turn:
            raise ValueError(f'duplicate {kind} for {turn_id}; split playback intervals explicitly')
        turn[kind] = number(event['at_ms'], 'at_ms')
    results = []
    for turn_id, turn in turns.items():
        missing = set(REQUIRED) - turn.keys()
        if missing:
            raise ValueError(f'{turn_id}: missing {sorted(missing)}')
        times = [turn[kind] for kind in REQUIRED]
        if times != sorted(times):
            raise ValueError(f'{turn_id}: invalid speech/playback ordering')
        available_pipeline = [turn[kind] for kind in PIPELINE if kind in turn]
        if available_pipeline != sorted(available_pipeline):
            raise ValueError(f'{turn_id}: invalid pipeline ordering')
        latency = turn['assistant_audio_started'] - turn['user_speech_ended']
        stages = {}
        for start, end in zip(PIPELINE, PIPELINE[1:]):
            if start in turn and end in turn:
                stages[f'{start}_to_{end}_ms'] = turn[end] - turn[start]
        results.append({'turn_id': turn_id, 'response_ms': latency,
                        'passed': latency <= reply_limit, 'stages_ms': stages})
    interruptions, seen = [], set()
    for item in case.get('interruptions', []):
        speaking, interrupting = item['speaking_turn_id'], item['interrupting_turn_id']
        if speaking == interrupting or speaking not in turns or interrupting not in turns:
            raise ValueError('interruption must link two known, distinct turns')
        if speaking in seen:
            raise ValueError('a playback interval can only be interrupted once')
        seen.add(speaking)
        old, new = turns[speaking], turns[interrupting]
        onset = new['user_speech_started']
        if not old['assistant_audio_started'] <= onset < old['assistant_audio_stopped']:
            raise ValueError('interruption must start during assistant playback')
        stop_ms = old['assistant_audio_stopped'] - onset
        cancel_ms = None
        if 'agent_cancelled' in old:
            cancel_ms = old['agent_cancelled'] - onset
            number(cancel_ms, 'cancel delay')
        interruptions.append({'speaking_turn_id': speaking, 'interrupting_turn_id': interrupting,
                              'stop_ms': stop_ms, 'cancel_ms': cancel_ms,
                              'recovery_ms': new['assistant_audio_started'] - new['user_speech_ended'],
                              'passed': stop_ms <= stop_limit and
                              new['assistant_audio_started'] - new['user_speech_ended'] <= reply_limit})
    annotated = {(i['speaking_turn_id'], i['interrupting_turn_id']) for i in interruptions}
    for old_id, old in turns.items():
        for new_id, new in turns.items():
            if old_id != new_id and old['assistant_audio_started'] <= new['user_speech_started'] < old['assistant_audio_stopped']:
                if (old_id, new_id) not in annotated:
                    raise ValueError('unannotated interruption during assistant playback')
    if case.get('require_interruption', False) and not interruptions:
        raise ValueError('case requires an interruption')
    overlaps = []
    turn_items = list(turns.items())
    for index, (left_id, left) in enumerate(turn_items):
        for right_id, right in turn_items[index + 1:]:
            overlap = min(left['assistant_audio_stopped'], right['assistant_audio_stopped']) - max(
                left['assistant_audio_started'], right['assistant_audio_started'])
            if overlap > 0:
                overlaps.append({'turn_ids': [left_id, right_id], 'overlap_ms': overlap})
    return {'passed': not overlaps and all(t['passed'] for t in results) and all(i['passed'] for i in interruptions),
            'turns': results, 'interruptions': interruptions, 'audio_overlaps': overlaps}
