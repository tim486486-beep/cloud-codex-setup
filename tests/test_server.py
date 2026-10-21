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
class LatestCodexTests(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self,latest=('1.2.3','1.2.3'),installed=None):
        with tempfile.TemporaryDirectory() as tmp,contextlib.ExitStack() as stack:
            base=Path(tmp)/'state';base.mkdir();home=Path(tmp)/'home';auth=home/'.codex/auth.json';auth.parent.mkdir(parents=True);auth.write_text('synthetic-auth-preserved')
            package=base/'npm/lib/node_modules/@openai/codex/package.json';entry=package.parent/'bin/codex.js'
            def package_at(version):
                entry.parent.mkdir(parents=True,exist_ok=True);entry.write_text('// fixture');package.write_text(json.dumps({'version':version}))
            if installed:package_at(installed)
            state={'queries':iter(latest),'runtime':installed,'installs':[],'events':[],'auth':auth,'base':base}
            def fake_run(args,stage,timeout=600,input=None):
                log=base/(stage+'.log')
                if stage=='codex-latest':
                    self.assertIn('--prefer-online',args);self.assertIn('--prefer-offline=false',args);self.assertIn('--offline=false',args);self.assertIn('--@openai:registry='+setup.NPM_REGISTRY,args);self.assertIn(setup.NPM_REGISTRY,args)
                    value=next(state['queries'])
                    if isinstance(value,Exception):raise value
                    log.write_text(json.dumps(value))
                elif stage=='codex-install':
                    version=str(args[-1]).split('@')[-1];state['installs'].append(version);package_at(version);state['runtime']=state.get('afterInstallRuntime',version)
                    self.assertIn(setup.NPM_REGISTRY,args);log.write_text('installed')
                elif stage=='codex-version':log.write_text('codex-cli '+str(state['runtime'])+'\n')
                else:raise AssertionError('Unexpected install stage '+stage)
                return log
            for key,value in {'BASE':base,'BIN':home/'.local/bin','HOME':home,'CONFIG':{'codexVersion':'0.163.0'}}.items():stack.enter_context(mock.patch.object(setup,key,value))
            stack.enter_context(mock.patch.object(setup,'install_node',return_value=base/'node/runtime'))
            stack.enter_context(mock.patch.object(setup,'run',side_effect=fake_run))
            stack.enter_context(mock.patch.object(setup,'emit',side_effect=lambda kind,message='',**extra:state['events'].append((kind,message))))
            yield state
            self.assertEqual(auth.read_text(),'synthetic-auth-preserved')

    def test_installs_resolved_stable_version_and_records_verified_release(self):
        with self.fixture() as s:
            setup.install_codex();self.assertEqual(s['installs'],['1.2.3'])
            self.assertEqual((s['base']/'installed-codex-version.txt').read_text().strip(),'1.2.3')
            report=json.loads((s['base']/'installed-codex-release.json').read_text())
            self.assertEqual(report['version'],'1.2.3');self.assertEqual(report['policy'],'latest')

    def test_stale_marker_does_not_skip_upgrade(self):
        with self.fixture(installed='1.2.2') as s:
            (s['base']/'installed-codex-version.txt').write_text('1.2.3')
            setup.install_codex();self.assertEqual(s['installs'],['1.2.3'])

    def test_current_install_rechecks_official_latest_and_runtime_without_reinstall(self):
        with self.fixture(installed='1.2.3') as s:
            setup.install_codex();self.assertEqual(s['installs'],[])
            self.assertEqual(list(s['queries']),[])

    def test_offline_query_does_not_fall_back_to_installed_version(self):
        with self.fixture(latest=(RuntimeError('official registry unavailable'),),installed='1.2.3') as s:
            with self.assertRaisesRegex(RuntimeError,'registry unavailable'):setup.install_codex()
            self.assertEqual(s['installs'],[]);self.assertFalse(any(k=='success' for k,_ in s['events']))

    def test_rejects_invalid_or_prerelease_latest(self):
        for value in ['1.2.3-beta.1','latest;command',{'version':'1.2.3'},['1.2.3'],'']:
            with self.subTest(value=value),self.fixture(latest=(value,)) as s:
                with self.assertRaises(RuntimeError):setup.install_codex()
                self.assertEqual(s['installs'],[])

    def test_invalid_local_package_metadata_is_reinstalled(self):
        for content in ['[]','{']:
            with self.subTest(content=content),self.fixture(installed='1.2.3') as s:
                package=s['base']/'npm/lib/node_modules/@openai/codex/package.json'
                package.write_text(content)
                setup.install_codex();self.assertEqual(s['installs'],['1.2.3'])

    def test_runtime_mismatch_after_install_is_failure(self):
        with self.fixture() as s:
            s['afterInstallRuntime']='1.2.2'
            with self.assertRaisesRegex(RuntimeError,'实际版本'):setup.install_codex()
            self.assertFalse((s['base']/'installed-codex-version.txt').exists())
            self.assertFalse(any(k=='success' for k,_ in s['events']))

    def test_corrupt_existing_runtime_is_reinstalled(self):
        with self.fixture(installed='1.2.3') as s:
            s['runtime']='broken'
            setup.install_codex();self.assertEqual(s['installs'],['1.2.3'])

    def test_release_published_during_install_triggers_upgrade(self):
        with self.fixture(latest=('1.2.3','1.2.4','1.2.4','1.2.4')) as s:
            setup.install_codex();self.assertEqual(s['installs'],['1.2.3','1.2.4'])
            self.assertEqual((s['base']/'installed-codex-version.txt').read_text().strip(),'1.2.4')

    def test_continuously_changing_latest_cannot_report_success(self):
        with self.fixture(latest=('1.2.3','1.2.4','1.2.5','1.2.6')) as s:
            with self.assertRaisesRegex(RuntimeError,'持续变化'):setup.install_codex()
            self.assertFalse(any(k=='success' for k,_ in s['events']))

    def test_failed_final_query_cannot_record_latest_success(self):
        with self.fixture(latest=('1.2.3',RuntimeError('final registry query unavailable'))) as s:
            with self.assertRaises(RuntimeError):setup.install_codex()
            self.assertFalse((s['base']/'installed-codex-version.txt').exists())
            self.assertFalse(any(k=='success' for k,_ in s['events']))

    def test_legacy_version_policy_migrates_only_valid_versions(self):
        self.assertEqual(setup.codex_version_policy('0.163.0'),'latest')
        self.assertEqual(setup.codex_version_policy(),'latest')
        for value in ['beta','1.2.3;command',None]:
            with self.assertRaises(RuntimeError):setup.codex_version_policy(value)

if __name__=='__main__':unittest.main()
