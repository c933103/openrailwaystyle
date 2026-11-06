"""Offline execution of the actual acquisition function through PBF promotion."""
import hashlib
import importlib.util
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

source = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path('scripts/acquire-mainline-extract.py')
spec = importlib.util.spec_from_file_location('acquisition', source)
acquisition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acquisition)


class ProcessingReached(Exception):
    pass


class Response:
    def __init__(self, chunks, clock, times=(), size=None, failure=None):
        self.chunks, self.clock, self.times = list(chunks), clock, list(times)
        self.headers = {} if size is None else {'Content-Length': str(size)}
        self.failure, self.closed = failure, False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def read(self, maximum):
        if self.times:
            self.clock[0] = self.times.pop(0)
        if self.chunks:
            value = self.chunks.pop(0)
            assert len(value) <= maximum
            return value
        if self.failure:
            raise self.failure
        return b''


class DownloadBudgetTest(unittest.TestCase):
    def run_download(self, chunks, times, *, size=3, checksum=None, failure=None,
                     error=None, expected_message=None):
        clock, calls = [0.0], []
        checksum = checksum or hashlib.md5(b'abc', usedforsecurity=False).hexdigest()
        responses = [Response([], clock, size=size),
                     Response([(checksum + '  source.osm.pbf\n').encode()], clock),
                     Response(chunks, clock, times, size=size, failure=failure)]

        def request(req, timeout):
            calls.append((req.get_method(), req.full_url))
            self.assertEqual(timeout, 90)
            return responses[len(calls) - 1]

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.object(acquisition.urllib.request, 'build_opener') as opener, \
                 patch.object(acquisition.time, 'monotonic', side_effect=lambda: clock[0]), \
                 patch.object(acquisition.shutil, 'disk_usage') as disk, \
                 patch.object(acquisition.subprocess, 'check_output', side_effect=ProcessingReached) as processing, \
                 patch.object(socket, 'socket', side_effect=AssertionError('Network forbidden')):
                opener.return_value.open.side_effect = request
                disk.return_value.free = 100 * 1024**3
                with self.assertRaises(error or ProcessingReached) as caught:
                    acquisition.acquire('asia', '2026-11-01', output)
                if expected_message:
                    self.assertEqual(str(caught.exception), expected_message)
                self.assertFalse((output / 'source.osm.pbf.part').exists())
                self.assertFalse((output / 'source.json').exists())
                if error:
                    processing.assert_not_called()
                    self.assertFalse((output / 'source.osm.pbf').exists())
                else:
                    processing.assert_called_once()
                    self.assertEqual((output / 'source.osm.pbf').read_bytes(), b'abc')
            self.assertEqual([method for method, _ in calls], ['HEAD', 'GET', 'GET'])
            self.assertTrue(calls[1][1].endswith('.osm.pbf.md5'))
            self.assertEqual(calls[0][1], calls[2][1])
            self.assertTrue(all(response.closed for response in responses))

    def test_byte_budget_reports_exact_observation_and_removes_partial(self):
        self.run_download([b'abc', b'd'], [1.0, 2.0], error=ValueError,
            expected_message='Download exceeded byte budget: received=4 bytes, expected=3 bytes, elapsed=2.000s, limit=5400s')

    def test_time_budget_reports_exact_observation_and_removes_partial(self):
        self.run_download([b'ab', b'c'], [1.0, 5401.125], error=ValueError,
            expected_message='Download exceeded time budget: received=3 bytes, expected=3 bytes, elapsed=5401.125s, limit=5400s')

    def test_both_budgets_are_identified_without_hiding_either(self):
        self.run_download([b'abcd'], [5401.0], error=ValueError,
            expected_message='Download exceeded byte and time budget: received=4 bytes, expected=3 bytes, elapsed=5401.000s, limit=5400s')

    def test_late_eof_cannot_promote_checksum_complete_download(self):
        self.run_download([b'abc'], [5399.0, 5401.0], error=ValueError,
            expected_message='Download exceeded time budget: received=3 bytes, expected=3 bytes, elapsed=5401.000s, limit=5400s')

    def test_exact_byte_and_time_boundaries_remain_accepted(self):
        self.run_download([b'a', b'bc'], [1.0, 5400.0, 5400.0])

    def test_in_budget_download_is_promoted_only_after_checksum(self):
        self.run_download([b'a', b'b', b'c'], [1.0, 2.0, 3.0, 4.0])

    def test_wrong_checksum_still_fails_closed(self):
        self.run_download([b'abc'], [1.0, 2.0], checksum='0' * 32, error=ValueError,
                          expected_message='Truncated or changed continent PBF')

    def test_truncated_download_still_fails_closed(self):
        self.run_download([b'ab'], [1.0, 2.0], error=ValueError,
                          expected_message='Truncated or changed continent PBF')

    def test_transport_failure_preserves_original_error_and_cleanup(self):
        self.run_download([b'ab'], [1.0, 2.0], failure=TimeoutError('socket deadline'),
                          error=TimeoutError, expected_message='socket deadline')


if __name__ == '__main__':
    unittest.main()
