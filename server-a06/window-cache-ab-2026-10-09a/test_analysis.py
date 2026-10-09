from pathlib import Path
from unittest import mock
import contextlib,io,json,tempfile,unittest
import analyze_pairs as a
class AnalysisTests(unittest.TestCase):
    def case(self,change=None):
        with tempfile.TemporaryDirectory(prefix='atlas-analysis-') as tmp:
            root=Path(tmp);runs=root/'runs';runs.mkdir()
            for pair in range(1,5):
                for side in ('control','candidate'):
                    p=runs/f'pair-{pair:02d}-{side}';p.mkdir()
                    d={'run_id':p.name,'cohort':'fixture','role':side,'start_utc':f'2026-10-09T00:0{pair}:00Z','wall_seconds':10 if side=='control' else 9,'user_cpu_seconds':9,'system_cpu_seconds':1,'total_cpu_seconds':10,'peak_rss_kib':100,'exit_code':0,'termination_reason':None,'capture_errors':[],'exact_expected_match':True,'instrumented_cpu_profile':False,'start_conditions':{'load_average':[0,0,0],'memory_kib':{'MemAvailable':1000}}}
                    if change and pair==1 and side=='candidate':d.update(change)
                    (p/'metrics.json').write_text(json.dumps(d))
            with contextlib.redirect_stdout(io.StringIO()):
                if change:
                    with self.assertRaises(ValueError):a.analyze(runs,root/'out')
                else:
                    a.analyze(runs,root/'out');result=json.loads((root/'out/summary.json').read_text());self.assertEqual(result['cohort'],'fixture');self.assertEqual(result['metrics']['wall_seconds']['paired_percent_change']['median'],-10)
    def test_clean(self):self.case()
    def test_guarded_zero_exit(self):self.case({'termination_reason':'wall_limit'})
    def test_capture_error(self):self.case({'capture_errors':['error']})
    def test_mixed_cohort(self):self.case({'cohort':'different'})
    def test_output_mismatch(self):self.case({'exact_expected_match':False})
    def test_profile(self):self.case({'instrumented_cpu_profile':True})
    def test_nonzero(self):self.case({'exit_code':1})
if __name__=='__main__':unittest.main(verbosity=2)
