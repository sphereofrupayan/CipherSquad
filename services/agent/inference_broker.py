import heapq
import os
import threading
import time
import uuid
from contextlib import contextmanager


PRIORITIES = {'interactive': 0, 'work': 1, 'automation': 2, 'background': 3}


class InferenceBroker:
    """Single-process priority queue for the shared local inference slot."""

    def __init__(self, max_active=None):
        self.max_active = max(1, int(max_active or os.getenv('MAX_ACTIVE_LLM_GENERATIONS', '1')))
        self._condition = threading.Condition()
        self._waiting = []
        self._active = {}

    @contextmanager
    def slot(self, request_kind='work'):
        kind = request_kind if request_kind in PRIORITIES else 'work'
        request_id = uuid.uuid4().hex[:12]
        queued_at = time.perf_counter()
        ticket = (PRIORITIES[kind], time.monotonic_ns(), request_id, kind)
        with self._condition:
            heapq.heappush(self._waiting, ticket)
            while len(self._active) >= self.max_active or self._waiting[0][2] != request_id:
                self._condition.wait()
            heapq.heappop(self._waiting)
            started_at = time.perf_counter()
            self._active[request_id] = {
                'request_kind': kind,
                'queue_wait_ms': round((started_at - queued_at) * 1000),
                'started_at': started_at,
            }
        try:
            yield request_id
        finally:
            with self._condition:
                self._active.pop(request_id, None)
                self._condition.notify_all()

    def status(self):
        with self._condition:
            active = next(iter(self._active.values()), None)
            return {
                'max_active': self.max_active,
                'queued_requests': len(self._waiting),
                'active_request': ({
                    'request_kind': active['request_kind'],
                    'queue_wait_ms': active['queue_wait_ms'],
                    'model_latency_ms': round((time.perf_counter() - active['started_at']) * 1000),
                } if active else None),
            }


inference_broker = InferenceBroker()
