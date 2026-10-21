import ssh2 from 'ssh2';
const {Client}=ssh2;
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {connect as netConnect} from 'node:net';
import {fileURLToPath} from 'node:url';
import {redact} from './profile.mjs';
import {localIdentity} from './ssh-key.mjs';
import {randomUUID} from 'node:crypto';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export function fingerprint(key){return 'SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'');}
export function detectVscodeCommit(){
  const bases=[process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Programs','Microsoft VS Code'),process.env.ProgramFiles&&join(process.env.ProgramFiles,'Microsoft VS Code'),process.env.PATH?.split(process.platform==='win32'?';':':').filter(p=>/VS Code[\\/]bin$/i.test(p)).map(dirname)].flat().filter(Boolean);
  for(const base of bases){if(!existsSync(base))continue;const files=[join(base,'resources','app','product.json'),...readdirSync(base).filter(x=>/^[a-f0-9]{8,40}$/.test(x)).map(x=>join(base,x,'resources','app','product.json'))];const values=[...new Set(files.filter(existsSync).map(p=>{try{return JSON.parse(readFileSync(p,'utf8')).commit;}catch{return '';}}).filter(c=>/^[a-f0-9]{40}$/.test(c)))];if(values.length===1)return values[0];}return '';
}
export class HostTrustRequired extends Error{constructor(fp){super('首次连接需核实并信任 SSH 主机指纹。');this.fingerprint=fp;}}
export class RemoteManager{
  constructor(){this.sessions=new Map();this.candidates=new Map();}
  close(id){const s=this.sessions.get(id);if(s)s.client.end();this.sessions.delete(id);}
  closeAll(){for(const id of this.sessions.keys())this.close(id);}
  async get(id,p){
    const old=this.sessions.get(id);if(old?.ready)return old;
    const client=new Client();let observed='';
    const auth={};
    if(p.sshAuth==='password')auth.password=p.password;
    else if(p.sshAuth==='agent'){auth.agent=process.env.SSH_AUTH_SOCK||(process.platform==='win32'?'\\\\.\\pipe\\openssh-ssh-agent':undefined);if(!auth.agent)throw Error('未检测到 SSH agent；请选择私钥文件。');}
    else{const path=p.keyPath||[join(homedir(),'.ssh','id_ed25519'),join(homedir(),'.ssh','id_rsa')].find(existsSync);if(!path)throw Error('未找到本机私钥，请提供路径或选择密码。');auth.privateKey=readFileSync(path);auth.passphrase=p.passphrase||undefined;}
    await new Promise((resolve,reject)=>{
      client.once('ready',resolve);client.once('error',error=>{client.end();if(!p.hostFingerprint&&observed){this.candidates.set(id,{host:p.host,port:p.port,fingerprint:observed});reject(new HostTrustRequired(observed));}else reject(Error(redact(p.hostFingerprint&&observed!==p.hostFingerprint?'SSH 主机指纹发生变化，连接已拒绝。':error.message,p)));});
      client.connect({host:p.host,port:p.port,username:p.user,...auth,readyTimeout:20000,keepaliveInterval:15000,keepaliveCountMax:3,hostVerifier:key=>{observed=fingerprint(key);return observed===p.hostFingerprint;}});
    });
    const session={client,ready:true,proxyUrl:p.proxyMode==='remote'?p.proxyUrl:''};
    client.on('error',()=>{});client.on('close',()=>{session.ready=false;if(this.sessions.get(id)===session)this.sessions.delete(id);});
    this.sessions.set(id,session);
    if(p.proxyMode==='local'){
      const local=new URL(p.proxyUrl);
      client.on('tcp connection',(details,accept,reject)=>{if(details.destIP!=='127.0.0.1'){reject();return;}const remote=accept(),socket=netConnect({host:local.hostname,port:Number(local.port)||80});socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());remote.pipe(socket).pipe(remote);});
      const port=await new Promise((resolve,reject)=>client.forwardIn('127.0.0.1',0,(error,port)=>error?reject(Error('服务器不允许 SSH 回环反向转发。')):resolve(port)));
      const auth=local.username?(local.username+(local.password?':'+local.password:'')+'@'):'';
      session.proxyUrl='http://'+auth+'127.0.0.1:'+port;
    }
    return session;
  }
  trust(id,p,fp){const found=this.candidates.get(id);if(!found||found.host!==p.host||found.port!==p.port||fp!==found.fingerprint)throw Error('指纹不匹配，请重新检查连接。');this.candidates.delete(id);return {...p,hostFingerprint:fp};}
  async exec(session,command,input,{timeout=1200000,onData=()=>{}}={}){
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{session.client.end();reject(Error('远程步骤超时；连接已关闭。'));},timeout);session.client.exec(command,(error,stream)=>{if(error){clearTimeout(timer);reject(Error('无法启动远程步骤。'));return;}let code=null;stream.on('data',data=>{try{onData(data.toString('utf8'));}catch{stream.close();clearTimeout(timer);reject(Error('远程输出超出限制或格式不正确。'));}});stream.stderr.on('data',()=>{});stream.on('exit',value=>{code=value??1;});stream.once('error',()=>{clearTimeout(timer);reject(Error('远程数据流中断。'));});stream.once('close',()=>{clearTimeout(timer);resolve(code??255);});stream.end(input);});});
  }
  async installSshKey(id,p,emit){
    if(p.sshAuth!=='password'||!p.password)throw Error('请先选择 SSH 密码认证，保存服务器密码及本机私钥路径。');
    const identity=localIdentity(p),bootstrap='key-upload-'+randomUUID(),check='key-check-'+randomUUID();
    let added=false;
    try{
      const session=await this.get(bootstrap,{...p,proxyMode:'none',proxyUrl:''});
      emit({type:'stage',message:'SSH 主机指纹及密码已核验，正在追加当前用户的公钥。'});
      const source=readFileSync(join(ROOT,'server','authorize_key.py')).toString('base64');
      const command="python3 -c 'import base64;exec(base64.b64decode(\""+source+"\"))'";
      let output='';const code=await this.exec(session,command,JSON.stringify({publicKey:identity.publicKey}),{timeout:30000,onData:d=>{output+=d;if(output.length>16384)throw Error('公钥步骤输出异常。');}});
      let result;try{result=JSON.parse(output);}catch{throw Error('服务器未返回有效的公钥操作结果；需要 Python 3。');}
      if(code!==0||typeof result.alreadyPresent!=='boolean')throw Error(result.error||'服务器未能安全追加公钥。');
      added=true;emit({type:'info',message:result.alreadyPresent?'公钥已存在，保留原有条目及其限制。':'公钥已追加，原有其他公钥已保留；修改前已备份非空原文件。'});
      const keyed={...p,sshAuth:'key',password:'',keyPath:identity.keyPath,proxyMode:'none',proxyUrl:''};
      let verified='';const keySession=await this.get(check,keyed);
      if(await this.exec(keySession,'printf SSH_KEY_OK','',{timeout:30000,onData:d=>verified+=d})||verified!=='SSH_KEY_OK')throw Error('密钥登录后的命令验证未通过。');
      this.close(id);emit({type:'success',message:'独立 SSH 连接已通过私钥认证及命令验证，将保存为密钥登录。'});
      return {sshAuth:'key',keyPath:identity.keyPath,password:''};
    }catch(error){
      if(error instanceof HostTrustRequired){this.candidates.set(id,this.candidates.get(bootstrap));this.candidates.delete(bootstrap);throw error;}
      if(added)emit({type:'info',message:'公钥条目已保留，但密钥验证未通过；本机仍保留原密码配置，请检查服务器是否允许公钥登录。'});
      throw error;
    }finally{this.close(bootstrap);this.close(check);this.candidates.delete(bootstrap);}
  }
  async run(id,p,action,emit){
    if(action==='install-ssh-key')return this.installSshKey(id,p,emit);
    const s=await this.get(id,p);
    if(action==='probe'){emit({type:'success',message:'SSH 主机指纹及认证已验证。'});return;}
    const upload='umask 077\nmkdir -p "$HOME/.local/share/cloud-codex-setup"\ncat > "$HOME/.local/share/cloud-codex-setup/setup.py.part"\nchmod 700 "$HOME/.local/share/cloud-codex-setup/setup.py.part"\nmv "$HOME/.local/share/cloud-codex-setup/setup.py.part" "$HOME/.local/share/cloud-codex-setup/setup.py"';
    if(await this.exec(s,upload,readFileSync(join(ROOT,'server','setup.py')),{timeout:60000}))throw Error('投递安装程序失败；服务器需要 Bash 和 Python 3。');
    const fields=['codexAuth','authJson','openaiKey','codexVersion','nodeVersion','clineEnabled','clineKey','clineModel','clineVersion','vscodeCommit','containerFullAccess'];const packet=Object.fromEntries(fields.map(k=>[k,p[k]]));packet.proxyUrl=s.proxyUrl;
    let pending='';const onData=data=>{pending+=data;if(pending.length>1024*1024)throw Error('远程输出过大。');const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const event=JSON.parse(line);if(['stage','success','error','login_required','device','info'].includes(event.type))emit(JSON.parse(redact(JSON.stringify(event),p)));}catch{emit({type:'info',message:'远程步骤返回了非结构化输出，已隐藏。'});}}};
    const allowed=['install','setup','login','verify','model-test','tunnel'];if(!allowed.includes(action))throw Error('未知操作。');
    const command='python3 "$HOME/.local/share/cloud-codex-setup/setup.py" '+action;
    const rc=await this.exec(s,command,JSON.stringify(packet),{onData,timeout:action==='login'?20*60*1000:60*60*1000});
    if(rc!==0)throw Error('远程步骤失败（退出码 '+rc+'）；按页面的阶段信息处理。');
  }
}
