// CI-only real OpenSSH test. It uses synthetic keys and a disposable loopback user.
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import ssh2 from 'ssh2';
import {RemoteManager,HostTrustRequired,fingerprint} from '../src/remote.mjs';
import {localIdentity} from '../src/ssh-key.mjs';
import {validateProfile} from '../src/profile.mjs';
const dir=mkdtempSync(join(tmpdir(),'cloud-codex-openssh-')),manager=new RemoteManager();
const makeKey=()=>generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}}).privateKey;
try{
 const keyPath=join(dir,'identity');writeFileSync(keyPath,ssh2.utils.generateKeyPairSync('ed25519',{passphrase:'synthetic-openssh-passphrase',cipher:'aes256-cbc'}).private,{mode:0o600});
 const pub=localIdentity({keyPath}).publicKey,other=ssh2.utils.parseKey(makeKey());
 let p=validateProfile({host:'127.0.0.1',port:22422,user:'cloudcodexci',sshAuth:'password',password:'synthetic-local-ci-password',keyPath,passphrase:'synthetic-openssh-passphrase'});const id=randomUUID(),events=[];
 const emit=e=>{events.push(e);console.log(e.type+': '+e.message);};
 try{await manager.run(id,p,'install-ssh-key',emit);assert.fail('Unknown host was accepted');}catch(e){assert.ok(e instanceof HostTrustRequired);const expected=fingerprint(ssh2.utils.parseKey(readFileSync(process.env.CLOUD_CODEX_TEST_HOST_PUBLIC_KEY)).getPublicSSH());assert.equal(e.fingerprint,expected);p=manager.trust(id,p,expected);}
 async function python(profile,source,input={}){const session=await manager.get(id,profile);const command="python3 -c 'import base64;exec(base64.b64decode(\""+Buffer.from(source).toString('base64')+"\"))'";let output='';const rc=await manager.exec(session,command,JSON.stringify(input),{timeout:30000,onData:d=>output+=d});assert.equal(rc,0,'remote QA step failed');return JSON.parse(output);}
 const before=await python(p,`import pathlib,json,sys,hashlib
x=json.load(sys.stdin);d=pathlib.Path.home()/'.ssh';d.mkdir(mode=0o700,exist_ok=True);p=d/'authorized_keys';b=(x['other']+' existing-ci-key').encode();p.write_bytes(b);p.chmod(0o600)
print(json.dumps({'length':len(b),'sha256':hashlib.sha256(b).hexdigest()}))`,{other:other.type+' '+other.getPublicSSH().toString('base64')});
 const update=await manager.run(id,p,'install-ssh-key',emit);assert.equal(update.sshAuth,'key');const keyed=validateProfile({...p,...update});assert.equal(keyed.password,'');
 await manager.run(id,keyed,'probe',emit);
 const after=await python(keyed,`import pathlib,json,sys,hashlib,stat
x=json.load(sys.stdin);p=pathlib.Path.home()/'.ssh/authorized_keys';b=p.read_bytes();backup=list(p.parent.glob('authorized_keys.backup-*'))
print(json.dumps({'prefix':hashlib.sha256(b[:x['length']]).hexdigest(),'sha256':hashlib.sha256(b).hexdigest(),'count':sum(x['blob'].encode() in line.split() for line in b.splitlines()),'backupMatches':any(hashlib.sha256(f.read_bytes()).hexdigest()==x['sha256'] for f in backup),'mode':stat.S_IMODE(p.stat().st_mode),'directoryMode':stat.S_IMODE(p.parent.stat().st_mode)}))`,{...before,blob:pub.split(' ')[1]});
 assert.equal(after.prefix,before.sha256);assert.equal(after.count,1);assert.equal(after.backupMatches,true);assert.equal(after.mode,0o600);assert.equal(after.directoryMode,0o700);
 await manager.run(id,p,'install-ssh-key',emit);
 const repeat=await python(keyed,`import pathlib,json,hashlib
print(json.dumps({'sha256':hashlib.sha256((pathlib.Path.home()/'.ssh/authorized_keys').read_bytes()).hexdigest()}))`);assert.equal(repeat.sha256,after.sha256);assert.ok(events.some(e=>e.message.includes('公钥已存在')));
 manager.close(id);await assert.rejects(manager.run(id,{...p,hostFingerprint:'SHA256:'+'B'.repeat(43)},'install-ssh-key',emit),/指纹发生变化/);
 // A pre-existing forced command must not be bypassed by adding an unrestricted duplicate.
 await python(p,`import pathlib,json,sys
x=json.load(sys.stdin);p=pathlib.Path.home()/'.ssh/authorized_keys';p.write_text('command="false" '+x['key']+'\\n');p.chmod(0o600);print(json.dumps({'ok':True}))`,{key:pub});
 await assert.rejects(manager.run(id,p,'install-ssh-key',emit));assert.equal(p.sshAuth,'password');assert.ok(events.some(e=>e.message.includes('仍保留原密码配置')));
 console.log('REAL_OPENSSH_PASS: non-root password bootstrap, host verification, append/backup/preserve, independent key auth, repeat upload, restricted-key failure');
}finally{manager.closeAll();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(dir.startsWith(join(tmpdir(),'cloud-codex-openssh-')));rmSync(dir,{recursive:true,force:true});}
