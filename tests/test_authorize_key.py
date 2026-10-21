import base64,importlib.util,json,os,struct,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('authorize_key',Path(__file__).resolve().parents[1]/'server/authorize_key.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def key(byte=b'a'):
    kind=b'ssh-ed25519';raw=struct.pack('>I',len(kind))+kind+struct.pack('>I',32)+byte*32
    return 'ssh-ed25519 '+base64.b64encode(raw).decode()+' cloud-codex-setup'
class AuthorizeKeyTests(unittest.TestCase):
    def test_append_backs_up_and_preserves_other_key_without_final_newline(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);directory=home/'.ssh';directory.mkdir();target=directory/'authorized_keys'
            original=('# existing identity\n'+key(b'b')).encode();target.write_bytes(original)
            self.assertFalse(module.authorize(key(),home)['alreadyPresent'])
            self.assertEqual(target.read_bytes(),original+b'\n'+key().encode()+b'\n')
            backups=list(directory.glob('authorized_keys.backup-*'));self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),original)
            if os.name=='posix':
                self.assertEqual(target.stat().st_mode&0o777,0o600);self.assertEqual(directory.stat().st_mode&0o777,0o700)
    def test_repeated_upload_does_not_duplicate_or_strip_existing_restrictions(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);module.authorize(key(),home);target=home/'.ssh/authorized_keys'
            restricted='restrict,command="echo limited" '+key().replace('cloud-codex-setup','different-comment')+'\n';target.write_text(restricted)
            self.assertTrue(module.authorize(key(),home)['alreadyPresent']);self.assertEqual(target.read_text(),restricted)
            self.assertEqual(list(target.parent.glob('authorized_keys.backup-*')),[])
    def test_rejects_invalid_and_multiline_keys_before_creating_ssh_directory(self):
        for value in [None,'',key()+'\n'+key(),key().replace('ssh-ed25519','ssh-rsa',1),'ssh-ed25519 !!! cloud-codex-setup']:
            with self.subTest(value=type(value).__name__),tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ValueError):module.authorize(value,Path(tmp))
                self.assertFalse((Path(tmp)/'.ssh').exists())
    def test_rejects_symlinks_and_preserves_external_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);external=home/'outside';external.write_bytes(b'unchanged');directory=home/'.ssh';directory.mkdir();target=directory/'authorized_keys'
            try:target.symlink_to(external)
            except OSError:self.skipTest('symlink privilege unavailable')
            with self.assertRaises(ValueError):module.authorize(key(),home)
            self.assertEqual(external.read_bytes(),b'unchanged')
    def test_rejects_hardlinks_and_preserves_external_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);external=home/'outside';external.write_bytes(b'unchanged');directory=home/'.ssh';directory.mkdir();os.link(external,directory/'authorized_keys')
            with self.assertRaises(ValueError):module.authorize(key(),home)
            self.assertEqual(external.read_bytes(),b'unchanged')
if __name__=='__main__':unittest.main()
