import {Vault} from './vault.mjs';
import {RemoteManager,HostTrustRequired} from './remote.mjs';
import {redact} from './profile.mjs';
const [cmd,id,action]=process.argv.slice(2),vault=new Vault(),manager=new RemoteManager();
try{
  if(cmd==='profiles'){console.log(JSON.stringify(vault.list().map(p=>({id:p.id,name:p.name,host:p.host,port:p.port,user:p.user,codexAuth:p.codexAuth})),null,2));}
  else if(cmd==='run'){
    const p=vault.read(id);try{const update=await manager.run(id,p,action||'setup',event=>console.log(JSON.stringify(event)));if(action==='install-ssh-key'){if(update?.sshAuth!=='key')throw Error('密钥验证未完成，未修改登录方式。');vault.save({...p,...update},id);}if(p.proxyMode==='local'&&action!=='install-ssh-key'){console.log('本机代理转发保持中；按 Ctrl+C 断开。');await new Promise(resolve=>process.once('SIGINT',resolve));}}
    catch(error){if(error instanceof HostTrustRequired)console.error('核实主机指纹后执行 trust 命令：'+error.fingerprint);throw Error(redact(error.message,p));}
  }else if(cmd==='trust'){
    const p=vault.read(id);try{await manager.run(id,p,'probe',()=>{});}catch(error){if(!(error instanceof HostTrustRequired))throw error;}
    vault.save(manager.trust(id,p,action),id);console.log('SSH 指纹已保存。');
  }else throw Error('命令：profiles | run PROFILE_ID probe/install/setup/login/verify/model-test/tunnel/install-ssh-key | trust PROFILE_ID SHA256:FINGERPRINT');
}catch(error){console.error(redact(error.message));process.exitCode=1;}finally{manager.closeAll();}
