"""Record callback events at the client playback boundary, without transcripts."""
import time
from turn_taking_tests import REQUIRED, OPTIONAL


class TraceRecorder:
    """Single-threaded recorder. Marshal callbacks to the same event loop.

    Use mark() when the event actually occurs, not after an awaited operation.
    Forwarded server events need clock synchronization before combining them.
    """
    def __init__(self, clock=time.perf_counter_ns):
        self.clock = clock
        self.started = clock()
        self.events = []

    def mark(self, kind, turn_id):
        if kind not in set(REQUIRED) | OPTIONAL:
            raise ValueError('unknown event type')
        self.events.append({'type': kind, 'turn_id': turn_id,
                            'at_ms': (self.clock() - self.started) / 1_000_000})

    def snapshot(self):
        return [dict(event) for event in self.events]
