import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Vault} from './vault.mjs';
import {DEFAULTS,parseSsh,publicProfile,redact} from './profile.mjs';
import {RemoteManager,HostTrustRequired,detectVscodeCommit} from './remote.mjs';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const ACTIONS=new Set(['probe','install','setup','login','verify','model-test','tunnel','install-ssh-key']);
export async function startApp({vault=new Vault(),manager=new RemoteManager(),port=0,open=false}={}){
  const token=randomBytes(32).toString('hex'),jobs=new Map();let origin='';
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2*1024*1024)throw Error('请求超过 2MB。');}return JSON.parse(text||'{}');}
  function authorized(req){const supplied=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(req.headers.host!==new URL(origin).host)return send(res,403,{error:'Host 拒绝。'});
    if(req.headers.origin&&req.headers.origin!==origin)return send(res,403,{error:'跨来源请求已拒绝。'});
    const url=new URL(req.url,origin);
    if(!url.pathname.startsWith('/api/')){
      const routes={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
      if(req.method!=='GET'||!routes[url.pathname])return send(res,404,{error:'Not found'});
      const [name,type]=routes[url.pathname];res.setHeader('Content-Type',type);res.end(readFileSync(join(ROOT,'public',name)));return;
    }
    if(!authorized(req))return send(res,401,{error:'会话验证失败，请使用启动程序给出的页面。'});
    if(req.method==='POST'&&!String(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'需要 JSON。'});
    try{
      if(req.method==='GET'&&url.pathname==='/api/profiles')return send(res,200,{profiles:vault.list(),defaults:{...DEFAULTS,vscodeCommit:detectVscodeCommit()},dataDir:vault.dir});
      if(req.method==='GET'&&url.pathname.startsWith('/api/jobs/')){const job=jobs.get(url.pathname.split('/').pop());if(!job)return send(res,404,{error:'操作不存在。'});return send(res,200,job);}
      if(req.method==='POST'&&url.pathname==='/api/parse-ssh')return send(res,200,parseSsh((await body(req)).command));
      if(req.method==='POST'&&url.pathname==='/api/profiles'){
        const {profile,id}=await body(req);if(id&&[...jobs.values()].some(j=>j.profileId===id&&j.status==='running'))throw Error('此配置正在执行操作，请等待结束。');
        const result=vault.save(profile,id);manager.close(result.id);return send(res,200,publicProfile(result.profile,result.id));
      }
      if(req.method==='POST'&&url.pathname==='/api/trust'){
        const {id,fingerprint}=await body(req);const p=vault.read(id);const trusted=manager.trust(id,p,fingerprint);vault.save(trusted,id);return send(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/disconnect'){const {id}=await body(req);if([...jobs.values()].some(j=>j.profileId===id&&j.status==='running'))throw Error('请等待当前操作结束。');manager.close(id);return send(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/jobs'){
        const {id,action}=await body(req);if(!ACTIONS.has(action))throw Error('无效操作。');const p=vault.read(id);
        if([...jobs.values()].some(j=>j.profileId===id&&j.status==='running'))throw Error('此配置已有进行中的操作。');
        // Keep only a bounded number of in-memory histories. No logs are written into the project.
        if(jobs.size>100){const old=[...jobs].find(([,j])=>j.status!=='running');if(old)jobs.delete(old[0]);}
        const job={id:randomUUID(),profileId:id,action,status:'running',events:[]};jobs.set(job.id,job);send(res,202,{id:job.id});
        void (async()=>{let loginRequired=false;try{const update=await manager.run(id,p,action,event=>{if(event.type==='login_required')loginRequired=true;if(job.events.length<250)job.events.push({...JSON.parse(redact(JSON.stringify(event),p)),time:new Date().toISOString()});});if(action==='install-ssh-key'){if(update?.sshAuth!=='key')throw Error('密钥验证未完成，未修改登录方式。');vault.save({...p,...update},id);}job.status=loginRequired?'needs_login':'succeeded';}catch(error){job.status='failed';job.events.push({type:'error',message:redact(error.message,p)});if(error instanceof HostTrustRequired)job.trustFingerprint=error.fingerprint;}})();return;
      }
      return send(res,404,{error:'Not found'});
    }catch(error){return send(res,400,{error:/ENOENT/.test(error.message)?'配置或文件不存在。':redact(error.message)});}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const url=origin+'/#'+token;
  const close=()=>{manager.closeAll();return new Promise(resolve=>server.close(resolve));};
  if(open){if(process.platform==='win32')spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true}).unref();else spawn(process.platform==='darwin'?'open':'xdg-open',[url],{detached:true,stdio:'ignore'}).on('error',()=>{}).unref();}
  return {server,url,origin,token,close};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const app=await startApp({open:!process.argv.includes('--no-open')});console.log('本地配置向导：'+app.url);console.log('关闭此窗口会断开本机代理转发。配置会加密保存在当前用户的数据目录。');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
