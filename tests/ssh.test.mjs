import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import ssh2 from 'ssh2';
const {Server}=ssh2;
import {RemoteManager,HostTrustRequired} from '../src/remote.mjs';
import {validateProfile} from '../src/profile.mjs';
test('real loopback SSH rejects unknown and changed host keys; approved trust permits password authentication and streamed deployment',async t=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}});
 let authCount=0,uploaded=false,packet;const sockets=new Set();
 const server=new Server({hostKeys:[privateKey]},client=>{sockets.add(client);client.on('close',()=>sockets.delete(client));client.on('error',()=>{});client.on('authentication',ctx=>{authCount++;if(ctx.method==='password'&&ctx.password==='synthetic-ssh-password')ctx.accept();else ctx.reject();});client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('exec',(accept,_reject,info)=>{const stream=accept();let input='';stream.on('data',chunk=>input+=chunk);stream.on('end',()=>{if(info.command.startsWith('umask 077')){uploaded=input.includes('def main():');}else{packet=JSON.parse(input);stream.write(JSON.stringify({type:'success',message:'synthetic setup complete'})+'\n');}stream.exit(0);stream.end();});});}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const manager=new RemoteManager();t.after(async()=>{manager.closeAll();for(const c of sockets)c.end();await new Promise(resolve=>server.close(resolve));});
 const id=randomUUID();let p=validateProfile({host:'127.0.0.1',port:server.address().port,sshAuth:'password',password:'synthetic-ssh-password'}),fp='';
 try{await manager.run(id,p,'probe',()=>{});assert.fail('Unknown host must be rejected');}catch(e){assert.ok(e instanceof HostTrustRequired);fp=e.fingerprint;}
 assert.equal(authCount,0);p=manager.trust(id,p,fp);const events=[];await manager.run(id,p,'install',e=>events.push(e));assert.ok(uploaded);assert.ok(authCount>0);assert.equal(packet.password,undefined);assert.equal(events.at(-1).type,'success');manager.close(id);await assert.rejects(manager.run(id,{...p,hostFingerprint:'SHA256:'+'B'.repeat(43)},'probe',()=>{}),/指纹发生变化/);
});
