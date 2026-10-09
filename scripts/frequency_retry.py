"""Per-endpoint Retry-After receipts in the existing, best-effort shard cache.

Receipts contain fingerprints and timing only. They are not credentials or a
global origin scheduler; cache loss can also lose the remembered deadline.
"""
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import time


SCHEMA = 1
MAX_RECEIPT_BYTES = 4096
RETRYABLE_HTTP = frozenset((408, 425, 429, 500, 502, 503, 504))


class RetryAfterDeferred(Exception):
    def __init__(self, fingerprint, status, not_before):
        self.fingerprint, self.status, self.not_before = fingerprint, status, not_before
        super().__init__('Source endpoint is awaiting its Retry-After deadline')


def finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


class RetryAfterCache:
    def __init__(self, cache, *, clock=None):
        self.directory = Path(cache) / 'retry-after'
        self.clock = clock or time.time
        self.metrics = Counter()

    @staticmethod
    def fingerprint(url):
        return hashlib.sha256(url.encode('utf-8')).hexdigest()

    def path(self, url):
        return self.directory / (self.fingerprint(url) + '.json')

    def now(self):
        value = self.clock()
        if not finite_number(value) or value < 0:
            raise ValueError('Invalid acquisition clock')
        return value

    def write(self, url, receipt):
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.path(url)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(receipt, sort_keys=True, allow_nan=False) + '\n')
        temporary.replace(path)

    def clear(self, url):
        path = self.path(url)
        if path.exists():
            path.unlink()
            self.metrics['receipts_cleared'] += 1

    def read(self, url):
        path = self.path(url)
        if not path.exists():
            return None
        try:
            with path.open('rb') as stream:
                data = stream.read(MAX_RECEIPT_BYTES + 1)
            if len(data) > MAX_RECEIPT_BYTES:
                raise ValueError('Oversized receipt')
            receipt = json.loads(data)
            allowed = {'schema', 'url_sha256', 'status', 'observed_at', 'not_before', 'rollback_anchor'}
            if (not isinstance(receipt, dict) or set(receipt) - allowed
                    or type(receipt.get('schema')) is not int or receipt['schema'] != SCHEMA
                    or receipt.get('url_sha256') != self.fingerprint(url)
                    or type(receipt.get('status')) is not int
                    or receipt['status'] not in RETRYABLE_HTTP):
                raise ValueError('Unsupported receipt')
            observed, deadline = receipt.get('observed_at'), receipt.get('not_before')
            if (not finite_number(observed) or observed < 0
                    or not finite_number(deadline) or deadline <= observed):
                raise ValueError('Invalid receipt timing')
            anchor = receipt.get('rollback_anchor')
            if anchor is not None and (not finite_number(anchor) or not 0 <= anchor < observed):
                raise ValueError('Invalid rollback anchor')
            return receipt
        except (ValueError, TypeError, UnicodeError, RecursionError):
            # Never echo untrusted receipt bytes or freeze on corrupt future data.
            self.metrics['invalid_receipts'] += 1
            self.clear(url)
            return None

    def check(self, url):
        receipt = self.read(url)
        if receipt is None:
            return
        now = self.now()
        deadline = receipt['not_before']
        if now < receipt['observed_at']:
            # A backward wall-clock step cannot justify requesting early. Rewait
            # the original full interval against the new clock once, rather than
            # freezing until an accidentally future observation catches up.
            anchor = receipt.get('rollback_anchor')
            if anchor is None or now < anchor:
                anchor = receipt['rollback_anchor'] = now
                self.write(url, receipt)
                self.metrics['clock_reanchors'] += 1
            deadline = anchor + (receipt['not_before'] - receipt['observed_at'])
        # If the clock recovers, the original absolute deadline applies again.
        if now >= deadline:
            self.metrics['expired_receipts'] += 1
            self.clear(url)
            return
        self.metrics['deferred_requests'] += 1
        raise RetryAfterDeferred(self.fingerprint(url), receipt['status'], deadline)

    def record(self, url, status, observed_at, not_before):
        if (status not in RETRYABLE_HTTP or not finite_number(observed_at)
                or not finite_number(not_before) or observed_at < 0 or not_before <= observed_at):
            return
        receipt = {'schema': SCHEMA, 'url_sha256': self.fingerprint(url), 'status': status,
                   'observed_at': observed_at, 'not_before': not_before}
        self.write(url, receipt)
        self.metrics['receipts_recorded'] += 1
