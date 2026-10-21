import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,renameSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes,createCipheriv,createDecipheriv,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {publicProfile,validateProfile} from './profile.mjs';
export function defaultDataDir(){return process.platform==='win32'?join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'CloudCodexSetup'):join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'cloud-codex-setup');}
function dpapi(text,decrypt=false){
  const code='Add-Type -AssemblyName System.Security; $raw=[Console]::In.ReadToEnd(); '+(decrypt?'$bytes=[Convert]::FromBase64String($raw); $value=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($value))':'$bytes=[Text.Encoding]::UTF8.GetBytes($raw); $value=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($value))');
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{input:text,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4*1024*1024});
  if(r.status!==0)throw Error('Windows 当前用户加密失败；未降级保存明文。');return r.stdout.replace(/^\uFEFF/,'');
}
export class Vault{
  constructor(dir=defaultDataDir()){this.dir=dir;mkdirSync(dir,{recursive:true,mode:0o700});}
  path(id){if(!/^[0-9a-f-]{36}$/.test(id))throw Error('无效配置 ID。');return join(this.dir,id+'.vault.json');}
  protect(data){const text=JSON.stringify(data);if(process.platform==='win32')return {kind:'windows-dpapi',data:dpapi(text)};const keyPath=join(this.dir,'vault.key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',readFileSync(keyPath),nonce);const value=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return {kind:'local-key-aes256gcm',data:value.toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64')};}
  unprotect(box){if(box.kind==='windows-dpapi'){if(process.platform!=='win32')throw Error('此配置需要原 Windows 账户解密。');return JSON.parse(dpapi(box.data,true));}if(box.kind!=='local-key-aes256gcm')throw Error('未知配置加密格式。');const cipher=createDecipheriv('aes-256-gcm',readFileSync(join(this.dir,'vault.key')),Buffer.from(box.nonce,'base64'));cipher.setAuthTag(Buffer.from(box.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(box.data,'base64')),cipher.final()]).toString('utf8'));}
  read(id){return this.unprotect(JSON.parse(readFileSync(this.path(id),'utf8')));}
  save(input,id){id=id||randomUUID();const old=existsSync(this.path(id))?this.read(id):{};const p=validateProfile(input,old);const target=this.path(id),tmp=target+'.tmp-'+randomBytes(4).toString('hex');writeFileSync(tmp,JSON.stringify(this.protect(p)),{mode:0o600,flag:'wx'});renameSync(tmp,target);if(process.platform!=='win32')chmodSync(target,0o600);return {id,profile:p};}
  list(){return readdirSync(this.dir).filter(x=>x.endsWith('.vault.json')).map(n=>{const id=n.slice(0,-11);return publicProfile(this.read(id),id);});}
}
