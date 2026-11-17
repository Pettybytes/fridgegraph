"""Deterministic task correctness and ASR error rate, not semantic word overlap."""
import re


def normalized_words(text):
    if not isinstance(text, str):
        raise ValueError('transcripts must be strings')
    return re.findall(r'\w+', text.casefold())


def word_error_rate(reference, hypothesis):
    """Levenshtein edits / reference words. Can exceed 1; not task accuracy."""
    ref, hyp = normalized_words(reference), normalized_words(hypothesis)
    if not ref:
        raise ValueError('WER requires a nonempty reference')
    previous = list(range(len(hyp) + 1))
    for i, expected in enumerate(ref, 1):
        current = [i]
        for j, actual in enumerate(hyp, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1] / len(ref)


def evaluate_task(actual, expected):
    """Exact JSON contracts; never infer factual accuracy from shared words.

    Expected top-level fields match in full, including nested values. Extra
    top-level telemetry is allowed. Free-text meaning needs a separate rubric.
    """
    if not isinstance(actual, dict) or not isinstance(expected, dict) or not expected:
        raise ValueError('task checks require actual and nonempty expected objects')

    def equal(left, right):
        if type(left) is not type(right):
            return False  # JSON true must not equal 1.
        if isinstance(right, dict):
            return left.keys() == right.keys() and all(equal(left[k], v) for k, v in right.items())
        if isinstance(right, list):
            return len(left) == len(right) and all(equal(a, b) for a, b in zip(left, right))
        return left == right

    checks = {key: key in actual and equal(actual[key], value) for key, value in expected.items()}
    return {'passed': all(checks.values()), 'checks': checks}


def evaluate_context(case):
    """Score only the designated assistant probe, never the input history."""
    dialogue, probe = case['dialogue'], case['probe_index']
    if not isinstance(probe, int) or isinstance(probe, bool) or not 0 <= probe < len(dialogue):
        raise ValueError('probe_index must identify a dialogue turn')
    if dialogue[probe].get('role') != 'assistant':
        raise ValueError('context probe must be an assistant turn')
    if not any(t.get('role') == 'user' for t in dialogue[:probe]):
        raise ValueError('context probe needs preceding user context')
    return evaluate_task(dialogue[probe].get('output', {}), case['expected'])
