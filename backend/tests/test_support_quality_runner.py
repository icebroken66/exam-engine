import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('support_quality_runner',ROOT/'scripts/evaluate_support_quality.py')
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def test_plan_has_no_app_import_or_network_side_effect(tmp_path):
    code="import runpy,sys;sys.argv=['runner'];runpy.run_path('scripts/evaluate_support_quality.py',run_name='__main__')"
    response=subprocess.run([sys.executable,'-c',code],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
    assert response.returncode==0,response.stderr
    output=json.loads(response.stdout)
    assert output['status']=='plan_only' and output['network_calls']==0 and output['quality_passed'] is False
    assert len(output['cases'])==4


def test_mock_packet_uses_production_prompt_and_correction_history():
    # This subprocess keeps app.database and environment isolation out of the test runner.
    code="""import runpy,json,sys
def guard(event,args):
    if event in ('socket.connect','socket.getaddrinfo'):
        raise AssertionError('offline runner attempted network access')
    if event=='open' and str(args[0]).endswith('.env'):
        raise AssertionError('offline runner attempted dotenv read')
sys.addaudithook(guard)
ns=runpy.run_path('scripts/evaluate_support_quality.py')
cases=json.loads(ns['CASES'].read_text(encoding='utf-8'))
print(json.dumps(ns['run_mock'](cases),ensure_ascii=True))
"""
    response=subprocess.run([sys.executable,'-c',code],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
    assert response.returncode==0,response.stderr
    packet=json.loads(response.stdout)
    assert packet['quality_passed'] is False and packet['model_quality_evaluated'] is False
    assert packet['network_calls']==0
    assert len(packet['system_sha256'])==64 and len(packet['code_sha256'])==64
    assert [r['provider_calls'] for r in packet['cases']]==[1,1,1,0]
    assert all(r['state']=='published' for r in packet['cases'])
    assert all(all(count==0 for count in r['learning_records'].values()) for r in packet['cases'])
    by_id={r['case_id']:r for r in packet['cases']}
    p=json.loads(by_id['S02']['prompt']['user'].split('<output_json_schema>')[0])
    assert p['support_mode']=='different' and len(p['history'])==1
    assert by_id['S02']['reference_notes'] not in by_id['S02']['prompt']['user']
    p=json.loads(by_id['S03']['prompt']['user'].split('<output_json_schema>')[0])
    assert '容量现在是3' in p['user_text'] and '容量为1' in p['history'][0]['user']
    assert by_id['S04']['messages'][-1]['system_generated'] is True


def test_review_rejects_blank_stale_duplicate_and_incomplete_marks():
    packet={'mode':'mock','cases':[{'case_id':'S01','messages':[{'text':'sample'}],'checks':['不提供完整解法']}]}
    blank={'packet_sha256':runner.fingerprint(packet),'reviewer':None,'cases':[]}
    assert runner.check_review(packet,blank)['review_valid'] is False
    review={'packet_sha256':runner.fingerprint(packet),'reviewer':'developer','cases':[{'case_id':'S01','output_sha256':runner.fingerprint(packet['cases'][0]['messages']),'checks':[{'check':'不提供完整解法','verdict':'uncertain','reason':'Mock没有实际讲解，不可评分'}]}]}
    result=runner.check_review(packet,review)
    assert result['review_valid'] and result['quality_passed'] is False
    assert result['model_quality_evaluated'] is False
    review['cases'].append(review['cases'][0]);assert not runner.check_review(packet,review)['review_valid']
    review['cases'].pop();review['cases'][0]['output_sha256']='stale';assert not runner.check_review(packet,review)['review_valid']


def test_live_argument_cannot_dispatch_or_create_output(tmp_path):
    output=tmp_path/'must-not-exist'
    response=subprocess.run([sys.executable,str(ROOT/'scripts/evaluate_support_quality.py'),'--live','--output',str(output)],cwd=ROOT,capture_output=True)
    assert response.returncode!=0 and not output.exists()
