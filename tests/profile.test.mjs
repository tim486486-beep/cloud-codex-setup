import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile,parseSsh,publicProfile,redact} from '../src/profile.mjs';
const valid={host:'example.com',sshAuth:'password',password:'synthetic-password-only'};
test('SSH paste parser handles quoted key path and custom port without shell evaluation',()=>{assert.deepEqual(parseSsh('ssh user@example.com -p 2222 -i "C:\\keys\\test key"'),{user:'user',host:'example.com',port:2222,keyPath:'C:\\keys\\test key',sshAuth:'key'});assert.throws(()=>parseSsh('ssh user@example.com -o ProxyCommand=anything'));assert.throws(()=>parseSsh('ssh user@example.com; echo anything'));});
test('profile rejects host shell injection, malformed port and invalid versions',()=>{assert.throws(()=>validateProfile({...valid,host:'example.com;whoami'}));assert.throws(()=>validateProfile({...valid,port:0}));assert.throws(()=>validateProfile({...valid,codexVersion:'latest;anything'}));});
test('password is optional for existing key and profile UI never returns secrets',()=>{const p=validateProfile({host:'example.com',keyPath:'sample-key-path',clineEnabled:false});assert.equal(p.password,'');const s=publicProfile(validateProfile(valid),'sample-id');assert.equal(s.password,'');assert.equal(s.hasPassword,true);assert.ok(!JSON.stringify(s).includes(valid.password));});
test('edits preserve blank secrets but reset trust when the target changes',()=>{const p=validateProfile({...valid,hostFingerprint:'SHA256:'+'A'.repeat(43),proxyMode:'remote',proxyUrl:'http://user:synthetic-proxy-password@example.com:8080'});const next=validateProfile({password:'',proxyUrl:''},p);assert.equal(next.password,p.password);assert.equal(next.proxyUrl,p.proxyUrl);assert.equal(validateProfile({host:'other.example.com'},p).hostFingerprint,'');});
test('proxy mode rejects accidental local TLS forwarding and path-bearing URLs',()=>{assert.throws(()=>validateProfile({...valid,proxyMode:'local',proxyUrl:'https://localhost:8888'}));assert.throws(()=>validateProfile({...valid,proxyMode:'remote',proxyUrl:'http://example.com/subscription'}));});
test('redactor removes supplied password, API key, proxy password and auth token',()=>{const p={password:'synthetic-password-only',clineKey:'synthetic-model-key-only',proxyUrl:'http://user:synthetic-proxy-secret@example.com:8080',authJson:JSON.stringify({tokens:{access_token:'synthetic-access-token-only'}})};const text=redact([p.password,p.clineKey,p.proxyUrl,'synthetic-access-token-only'].join(' '),p);for(const s of ['synthetic-password-only','synthetic-model-key-only','synthetic-proxy-secret','synthetic-access-token-only'])assert.ok(!text.includes(s));});


test('new and legacy profiles both track latest Codex without losing credentials or trust',()=>{
  const p=validateProfile({...valid,hostFingerprint:'SHA256:'+'A'.repeat(43)});assert.equal(p.codexVersion,'latest');
  const old={...p,codexVersion:'0.163.0'};const current=validateProfile({},old);assert.equal(current.codexVersion,'latest');assert.equal(current.password,p.password);assert.equal(current.hostFingerprint,p.hostFingerprint);
  assert.equal(publicProfile(old,'legacy-id').codexVersion,'latest');
  for(const codexVersion of ['next','1.2.3-beta.1','latest;anything','https://example.com/package'])assert.throws(()=>validateProfile({...valid,codexVersion}));
});
