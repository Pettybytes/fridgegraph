"""Validation and aggregation helpers."""
import math


def number(value, name, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum:
        raise ValueError(f'{name} must be a finite number >= {minimum}')
    return value


def percentile(values, percent):
    """Nearest-rank percentile; empty samples are unavailable, never zero."""
    if not values:
        return None
    ordered = sorted(number(v, 'sample') for v in values)
    return ordered[max(0, math.ceil(percent / 100 * len(ordered)) - 1)]


def distribution(values):
    return {'count': len(values), 'p50_ms': percentile(values, 50),
            'p95_ms': percentile(values, 95), 'max_ms': max(values) if values else None}
