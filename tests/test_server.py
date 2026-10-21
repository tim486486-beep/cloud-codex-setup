import importlib.util,json,tarfile,tempfile,unittest,io,contextlib,gzip,zipfile
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('setup',Path(__file__).resolve().parents[1]/'server/setup.py')
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
class ServerTests(unittest.TestCase):
    def test_device_login_never_exposes_token_endpoint_as_browser_url(self):
        process=mock.Mock()
        process.stdout=iter(['Open https://auth.openai.com/codex/device\n','ABCD-12345\n','HTTP 403 from https://auth.openai.com/api/accounts/deviceauth/token\n'])
        process.wait.return_value=1;process.poll.return_value=1
        output=io.StringIO()
        with mock.patch.object(setup.subprocess,'Popen',return_value=process),mock.patch.object(setup,'environment',return_value={}),contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError,'HTTP 403'):setup.device_login()
        events=[json.loads(line) for line in output.getvalue().splitlines()]
        devices=[event for event in events if event['type']=='device']
        self.assertEqual(len(devices),2)
        self.assertTrue(all(event['url']=='https://auth.openai.com/codex/device' for event in devices))
        self.assertEqual(devices[-1]['code'],'ABCD-12345')
    def test_vsix_accepts_plain_zip_and_marketplace_gzip_wrapper(self):
        payload=io.BytesIO()
        with zipfile.ZipFile(payload,'w') as z:z.writestr('extension/package.json',json.dumps({'publisher':'saoudrizwan','name':'claude-dev','version':'4.1.25'}))
        with tempfile.TemporaryDirectory() as tmp:
            source,target=Path(tmp)/'download.part',Path(tmp)/'extension.vsix'
            for data in [payload.getvalue(),gzip.compress(payload.getvalue())]:
                source.write_bytes(data);setup.normalize_vsix(source,target,'4.1.25');self.assertTrue(zipfile.is_zipfile(target))
    def test_vsix_rejects_wrong_publisher(self):
        with tempfile.TemporaryDirectory() as tmp:
            source,target=Path(tmp)/'download.part',Path(tmp)/'extension.vsix'
            with zipfile.ZipFile(source,'w') as z:z.writestr('extension/package.json',json.dumps({'publisher':'untrusted-example','name':'claude-dev','version':'4.1.25'}))
            with self.assertRaises(RuntimeError):setup.normalize_vsix(source,target,'4.1.25')
            self.assertFalse(target.exists())
    def test_repeated_import_preserves_refreshed_auth_and_new_import_replaces_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            home,base,config=setup.HOME,setup.BASE,setup.CONFIG
            try:
                setup.HOME=Path(tmp);setup.BASE=Path(tmp)/'private';setup.BASE.mkdir()
                setup.CONFIG={'codexAuth':'file','authJson':json.dumps({'tokens':{'access_token':'synthetic-original-token'}})}
                with contextlib.redirect_stdout(io.StringIO()):setup.configure_auth()
                auth=setup.HOME/'.codex/auth.json';auth.write_text(json.dumps({'tokens':{'access_token':'synthetic-refreshed-token'}}))
                with contextlib.redirect_stdout(io.StringIO()):setup.configure_auth()
                self.assertEqual(json.loads(auth.read_text())['tokens']['access_token'],'synthetic-refreshed-token')
                setup.CONFIG['authJson']=json.dumps({'tokens':{'access_token':'synthetic-new-user-import'}})
                with contextlib.redirect_stdout(io.StringIO()):setup.configure_auth()
                self.assertEqual(json.loads(auth.read_text())['tokens']['access_token'],'synthetic-new-user-import')
            finally:setup.HOME,setup.BASE,setup.CONFIG=home,base,config
    def test_refuses_archive_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive=Path(tmp)/'bad.tar.gz'
            with tarfile.open(archive,'w:gz') as tf:
                item=tarfile.TarInfo('../escaped');item.size=1;tf.addfile(item,io.BytesIO(b'x'))
            with self.assertRaises(RuntimeError):setup.safe_extract(archive,Path(tmp)/'out')
            self.assertFalse((Path(tmp)/'escaped').exists())
    def test_reply_alone_does_not_prove_shell_execution(self):
        self.assertFalse(setup.evidence('prompt asks printf TOOL_OK','TOOL_OK'))
        wrong={'type':'item.completed','item':{'type':'command_execution','status':'completed','exit_code':1,'command':"/bin/bash -lc 'printf TOOL_OK'",'aggregated_output':'TOOL_OK'}}
        self.assertFalse(setup.evidence(json.dumps(wrong),'TOOL_OK'))
    def test_real_completed_command_evidence_is_required(self):
        event={'type':'item.completed','item':{'type':'command_execution','status':'completed','exit_code':0,'command':"/bin/bash -lc 'printf TOOL_OK'",'aggregated_output':'TOOL_OK'}}
        self.assertTrue(setup.evidence(json.dumps(event),'TOOL_OK'))
        self.assertFalse(setup.evidence(json.dumps(event),'WRONG'))
if __name__=='__main__':unittest.main()
