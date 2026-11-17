"""Bounded process-local cache for tool schemas, never conversational answers."""
from collections import OrderedDict
from copy import deepcopy
import time
from metrics import number


class SchemaCache:
    """Key by trusted scope, schema name and immutable revision/content hash.

    Caller supplies scope from authenticated server context. Revision must change
    whenever schema/permissions change. Not a Kong semantic response cache.
    One instance per worker; concurrent callers must provide external locking.
    """
    def __init__(self, ttl_s=300, capacity=128, clock=time.monotonic):
        self.ttl_s = number(ttl_s, 'ttl_s', 0.001)
        if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
            raise ValueError('capacity must be a positive integer')
        self.capacity, self.clock, self.entries = capacity, clock, OrderedDict()

    def get_or_load(self, scope, name, revision, loader):
        if any(not isinstance(v, str) or not v for v in (scope, name, revision)):
            raise ValueError('scope, name and revision must be nonempty strings')
        key, now = (scope, name, revision), self.clock()
        if key in self.entries:
            expires, value = self.entries[key]
            if now < expires:
                self.entries.move_to_end(key)
                return deepcopy(value), True
            del self.entries[key]
        value = loader()
        if not isinstance(value, dict):
            raise ValueError('schema loader must return an object')
        self.entries[key] = (self.clock() + self.ttl_s, deepcopy(value))
        while len(self.entries) > self.capacity:
            self.entries.popitem(last=False)
        return deepcopy(value), False

    def invalidate_scope(self, scope):
        for key in list(self.entries):
            if key[0] == scope:
                del self.entries[key]
