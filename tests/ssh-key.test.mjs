import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import ssh2 from 'ssh2';
import {RemoteManager,HostTrustRequired} from '../src/remote.mjs';
import {localIdentity} from '../src/ssh-key.mjs';
import {validateProfile} from '../src/profile.mjs';
function temp(t){const dir=mkdtempSync(join(tmpdir(),'cloud-key-test-'));t.after(()=>{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(dir.startsWith(join(tmpdir(),'cloud-key-test-')));rmSync(dir,{recursive:true,force:true});});return dir;}
function pair(){return generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}});}
test('local identity derives matching public key and rejects public-only files or wrong passphrases',t=>{
 const dir=temp(t),keyPath=join(dir,'local-key');const {privateKey}=pair();writeFileSync(keyPath,privateKey);const identity=localIdentity({keyPath});assert.ok(identity.publicKey.startsWith('ssh-rsa '));assert.ok(!identity.publicKey.includes('PRIVATE'));
 writeFileSync(keyPath+'.pub',identity.publicKey);assert.throws(()=>localIdentity({keyPath:keyPath+'.pub'}),/私钥/);
 const encrypted=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem',cipher:'aes-256-cbc',passphrase:'synthetic-key-passphrase'},publicKeyEncoding:{type:'pkcs1',format:'pem'}});writeFileSync(keyPath,encrypted.privateKey);assert.throws(()=>localIdentity({keyPath,passphrase:'wrong'}),/密码短语/);assert.ok(localIdentity({keyPath,passphrase:'synthetic-key-passphrase'}).publicKey.startsWith('ssh-rsa '));
});
test('real SSH uploads only a public key, verifies a separate signed-key login, and preserves duplicate uploads',async t=>{
 const dir=temp(t),home=join(dir,'home');mkdirSync(home);const keyPath=join(dir,'local-key'),{privateKey}=pair();writeFileSync(keyPath,privateKey);const allowed=ssh2.utils.parseKey(privateKey),host=pair(),authorized=join(home,'.ssh','authorized_keys');let uploaded=0,signed=0,allowKey=true;const clients=new Set();
 const server=new ssh2.Server({hostKeys:[host.privateKey]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.password==='synthetic-upload-password')return ctx.accept();if(allowKey&&ctx.method==='publickey'&&existsSync(authorized)&&readFileSync(authorized,'utf8').includes(ctx.key.data.toString('base64'))&&ctx.key.data.equals(allowed.getPublicSSH())&&(!ctx.signature||allowed.verify(ctx.blob,ctx.signature,ctx.hashAlgo)===true)){if(ctx.signature)signed++;return ctx.accept();}ctx.reject();});
  client.on('ready',()=>client.on('session',accept=>accept().on('exec',(accept,reject,info)=>{
   const stream=accept();let input='';stream.on('data',d=>input+=d);stream.on('end',()=>{
    if(info.command==='printf SSH_KEY_OK'){stream.write('SSH_KEY_OK');stream.exit(0);stream.end();return;}
    const match=info.command.match(/^python3 -c 'import base64;exec\(base64.b64decode\("([A-Za-z0-9+/=]+)"\)\)'$/);if(!match){stream.exit(1);stream.end();return;}
    const packet=JSON.parse(input);assert.deepEqual(Object.keys(packet),['publicKey']);assert.ok(!input.includes(privateKey));assert.ok(!input.includes('synthetic-upload-password'));uploaded++;
    const child=spawn(process.env.CLOUD_CODEX_PYTHON||'python',['-c',Buffer.from(match[1],'base64').toString('utf8')],{env:{...process.env,HOME:home,USERPROFILE:home,PYTHONIOENCODING:'utf-8'},windowsHide:true});
    child.stdout.on('data',d=>stream.write(d));child.stderr.on('data',d=>stream.stderr.write(d));child.on('error',()=>{stream.exit(1);stream.end();});child.on('close',code=>{stream.exit(code??1);stream.end();});child.stdin.end(input);
   });
  })));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const manager=new RemoteManager();t.after(async()=>{manager.closeAll();for(const c of clients)c.end();await new Promise(resolve=>server.close(resolve));});
 const id=randomUUID();let p=validateProfile({host:'127.0.0.1',port:server.address().port,sshAuth:'password',password:'synthetic-upload-password',keyPath});
 await assert.rejects(manager.run(id,p,'install-ssh-key',()=>{}),HostTrustRequired);assert.equal(uploaded,0);p=manager.trust(id,p,manager.candidates.get(id).fingerprint);
 const events=[],update=await manager.run(id,p,'install-ssh-key',e=>events.push(e));assert.equal(update.sshAuth,'key');assert.equal(update.password,'');assert.ok(signed>0);assert.ok(existsSync(authorized));const first=readFileSync(authorized,'utf8');await manager.run(id,p,'install-ssh-key',e=>events.push(e));assert.equal(readFileSync(authorized,'utf8'),first);assert.ok(events.some(e=>e.message.includes('公钥已存在')));
 allowKey=false;await assert.rejects(manager.run(id,p,'install-ssh-key',e=>events.push(e)));assert.equal(p.sshAuth,'password');assert.ok(events.some(e=>e.message.includes('仍保留原密码配置')));
 await assert.rejects(manager.run(id,{...p,hostFingerprint:'SHA256:'+'B'.repeat(43)},'install-ssh-key',()=>{}),/指纹发生变化/);assert.equal(uploaded,3);
});
