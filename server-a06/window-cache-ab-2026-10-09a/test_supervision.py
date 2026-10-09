#!/usr/bin/env python3
"""Owned short-child controls; these are not Atlas performance measurements."""
from pathlib import Path
from unittest import mock
import os,sys,tempfile,time,unittest
import measure_replay as m

class SupervisionTests(unittest.TestCase):
    def child(self,script,**kwargs):
        with tempfile.TemporaryDirectory(prefix='atlas-supervision-') as tmp:
            root=Path(tmp);result=m.supervise([sys.executable,'-c',script],root,root,**kwargs)
            self.assertTrue(result['completion_method'].startswith('blocking os.wait4'))
            with self.assertRaises(ChildProcessError):os.waitpid(result['pid'],os.WNOHANG)
            return result,(root/'stdout.log').read_bytes(),(root/'stderr.log').read_bytes()
    def test_short_child_does_not_wait_for_one_second_sample_tick(self):
        result,_,_=self.child('import time;time.sleep(0.04)',sample_interval=1.0)
        self.assertEqual(result['returncode'],0);self.assertLess(result['wall_seconds'],0.8)
    def test_stdout_stderr_preserved(self):
        result,out,err=self.child('import sys;print("out");print("err",file=sys.stderr)')
        self.assertEqual(out,b'out\n');self.assertEqual(err,b'err\n');self.assertEqual(result['errors'],[])
    def test_nonzero_exit_reaped(self):
        result,_,_=self.child('raise SystemExit(7)');self.assertEqual(result['returncode'],7)
    def test_raw_non_utf8_stdout_preserved(self):
        result,out,_=self.child('import os;os.write(1,b"\\xff\\n")');self.assertEqual(out,b'\xff\n');self.assertEqual(result['returncode'],0)
    def test_wall_guard_terminates_and_reaps(self):
        result,_,_=self.child('import time;time.sleep(30)',sample_interval=0.02,wall_limit=0.08)
        self.assertEqual(result['reason'],'wall_limit');self.assertNotEqual(result['returncode'],0)
    def test_rss_guard_terminates_and_reaps(self):
        with mock.patch.object(m,'child_status',return_value={'VmRSS':100}):
            result,_,_=self.child('import time;time.sleep(30)',sample_interval=0.02,rss_limit_kib=1)
        self.assertEqual(result['reason'],'rss_limit');self.assertNotEqual(result['returncode'],0)
    def test_guarded_zero_exit_is_rejected(self):
        result,_,_=self.child('import signal,time;signal.signal(signal.SIGTERM,lambda *a:exit(0));time.sleep(30)',sample_interval=0.02,wall_limit=0.15)
        self.assertEqual(result['returncode'],0);self.assertEqual(result['reason'],'wall_limit')
        with self.assertRaises(RuntimeError):m.enforce_result_gate(result['returncode'],result['reason'],[],result['errors'])
    def test_any_non_null_guard_reason_is_rejected(self):
        for reason in ('wall_limit','rss_limit','monitor_failure',''):
            with self.subTest(reason=reason):
                with self.assertRaises(RuntimeError):m.enforce_result_gate(0,reason,[],[])
        m.enforce_result_gate(0,None,[],[])
    def test_descendant_holding_stdout_is_terminated(self):
        script='import subprocess,sys;child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]);print(child.pid,flush=True)'
        started=time.monotonic();result,out,_=self.child(script)
        self.assertLess(time.monotonic()-started,3)
        self.assertEqual(result['returncode'],0)
        self.assertIn('unexpected_owned_descendants_terminated',result['errors'])
        pid=int(out.strip())
        deadline=time.monotonic()+2
        while time.monotonic()<deadline:
            try: state=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[0]
            except FileNotFoundError: break
            if state=='Z':break  # Dead descendant awaiting its system reaper, not runnable.
            time.sleep(0.01)
        else:self.fail('Owned descendant survived cleanup')
        with self.assertRaises(RuntimeError):m.enforce_result_gate(0,None,[],result['errors'])
    def test_blocking_wait4_is_used(self):
        original=m.os.wait4;flags=[]
        def wait(pid,flag):flags.append(flag);return original(pid,flag)
        with mock.patch.object(m.os,'wait4',side_effect=wait):self.child('pass')
        self.assertEqual(flags,[0])
    def test_interruption_cleanup_reaps(self):
        original=m.os.wait4;seen=[]
        def wait(pid,flag):
            seen.append(pid)
            if len(seen)==1:raise KeyboardInterrupt()
            return original(pid,flag)
        with tempfile.TemporaryDirectory(prefix='atlas-supervision-interrupt-') as tmp:
            with mock.patch.object(m.os,'wait4',side_effect=wait):
                with self.assertRaises(KeyboardInterrupt):m.supervise([sys.executable,'-c','import time;time.sleep(30)'],Path(tmp),Path(tmp))
            self.assertEqual(len(seen),2)
            with self.assertRaises(ChildProcessError):os.waitpid(seen[0],os.WNOHANG)
if __name__=='__main__':unittest.main(verbosity=2)
