import {isIP} from 'node:net';
export const DEFAULTS={name:'My server',host:'',port:22,user:'root',sshAuth:'key',keyPath:'',password:'',passphrase:'',hostFingerprint:'',codexAuth:'device',authJson:'',openaiKey:'',codexVersion:'latest',nodeVersion:'24.19.0',proxyMode:'none',proxyUrl:'',clineEnabled:false,clineKey:'',clineModel:'',clineVersion:'4.1.25',vscodeCommit:'',containerFullAccess:false};
const fail=message=>{throw Error(message);};
export function parseSsh(text){
  const words=String(text).match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map(x=>/^['"]/.test(x)?x.slice(1,-1):x)||[];
  if(words.shift()!=='ssh')fail('连接命令须以 ssh 开头。');
  let target='',port=22,keyPath='';
  while(words.length){const w=words.shift();if(w==='-p'){port=Number(words.shift());}else if(w==='-i'){keyPath=words.shift()||'';}else if(w.startsWith('-')||target)fail('仅支持 ssh user@host -p PORT -i KEY；请将其他配置填入独立字段。');else target=w;}
  const at=target.lastIndexOf('@');if(at<1)fail('连接命令须包含 user@host。');
  return {user:target.slice(0,at),host:target.slice(at+1).replace(/^\[|\]$/g,''),port,keyPath,...(keyPath?{sshAuth:'key'}:{})};
}
export function validateProfile(input,previous={}){
  const p={...DEFAULTS,...previous,...input};
  for(const key of ['password','passphrase','openaiKey','clineKey','authJson'])if(input[key]===''&&previous[key])p[key]=previous[key];
  if(input.proxyUrl===''&&previous.proxyUrl&&p.proxyMode===previous.proxyMode)p.proxyUrl=previous.proxyUrl;
  for(const key of Object.keys(DEFAULTS))if(!['port','clineEnabled','containerFullAccess'].includes(key)&&typeof p[key]!=='string')fail('字段类型不正确：'+key);
  p.host=p.host.trim();p.user=p.user.trim();p.name=p.name.trim();p.port=Number(p.port);
  if(!p.name||p.name.length>80)fail('名称须为 1–80 个字符。');
  if(!(isIP(p.host)||/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(p.host)))fail('SSH 主机名/IP 不正确。');
  if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(p.user)||!Number.isInteger(p.port)||p.port<1||p.port>65535)fail('SSH 用户名或端口不正确。');
  if(!['key','password','agent'].includes(p.sshAuth))fail('SSH 认证方式不正确。');
  if(p.sshAuth==='password'&&!p.password)fail('请选择密钥认证，或提供 SSH 密码。');
  if(p.sshAuth!=='password')p.password='';
  if(!['device','file','api','existing'].includes(p.codexAuth))fail('Codex 登录方式不正确。');
  if(p.codexAuth==='file'){try{const x=JSON.parse(p.authJson);if(!x||Array.isArray(x)||typeof x!=='object'||!Object.keys(x).length)throw Error();}catch{fail('请提供有效的 Codex auth.json 对象。');}}
  else p.authJson='';
  if(p.codexAuth==='api'&&!p.openaiKey)fail('请提供 Codex 使用的 OpenAI API Key。');
  if(p.codexAuth!=='api')p.openaiKey='';
  if(p.codexVersion!=='latest'&&!/^\d+\.\d+\.\d+$/.test(p.codexVersion))fail('Codex CLI 使用 latest 稳定版。');
  // Legacy profiles used a pinned version; all installs now track the official stable tag.
  p.codexVersion='latest';
  for(const k of ['nodeVersion','clineVersion'])if(!/^\d+\.\d+\.\d+$/.test(p[k]))fail('请填写明确版本号：'+k);
  if(!['none','remote','local'].includes(p.proxyMode))fail('代理方式不正确。');
  if(p.proxyMode!=='none'){let url;try{url=new URL(p.proxyUrl);}catch{fail('请提供完整 HTTP/HTTPS 代理 URL。');}if(!['http:','https:'].includes(url.protocol)||url.pathname!=='/'||url.search||url.hash)fail('代理仅支持 HTTP/HTTPS URL，不带路径、查询或片段。');if(p.proxyMode==='local'&&url.protocol!=='http:')fail('本机 SSH 转发模式请使用 HTTP 代理端口。');}else p.proxyUrl='';
  if(typeof p.clineEnabled!=='boolean'||typeof p.containerFullAccess!=='boolean')fail('开关字段必须为布尔值。');
  if(p.vscodeCommit&&!/^[a-f0-9]{40}$/.test(p.vscodeCommit))fail('VS Code commit 须为 40 位十六进制。');
  if(p.clineEnabled&&(!p.clineKey||!p.clineModel||!p.vscodeCommit))fail('启用 Cline 需要 DeepSeek key、模型名及 VS Code commit。');
  if(p.clineVersion!=='4.1.25'&&p.clineEnabled)fail('当前自动配置适配 Cline 4.1.25，请使用此版本。');
  if(!p.clineEnabled){p.clineKey='';p.clineModel='';}
  if(p.hostFingerprint&&!/^SHA256:[A-Za-z0-9+/]{43}$/.test(p.hostFingerprint))fail('SSH 主机指纹格式不正确。');
  if(previous.host&&(previous.host!==p.host||previous.port!==p.port))p.hostFingerprint='';
  return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,p[k]]));
}
export function publicProfile(p,id){const safe={...p,id,codexVersion:'latest'};for(const k of ['password','passphrase','openaiKey','clineKey','authJson']){safe['has'+k[0].toUpperCase()+k.slice(1)]=!!safe[k];safe[k]='';}if(safe.proxyUrl){const u=new URL(safe.proxyUrl);if(u.username||u.password){safe.proxyUrl='';safe.hasProxyUrl=true;}}return safe;}
export function redact(value,p={}){
  let s=String(value);const secrets=[p.password,p.passphrase,p.openaiKey,p.clineKey,p.proxyUrl,p.authJson];
  try{const u=new URL(p.proxyUrl);secrets.push(decodeURIComponent(u.password));}catch{}
  try{const visit=x=>{if(typeof x==='string'&&x.length>7)secrets.push(x);else if(x&&typeof x==='object')Object.values(x).forEach(visit);};visit(JSON.parse(p.authJson));}catch{}
  for(const secret of secrets.filter(x=>x&&x.length>2).sort((a,b)=>b.length-a.length))s=s.split(secret).join('[REDACTED]');
  return s.replace(/sk-[\w-]{12,}/g,'[REDACTED_KEY]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED_TOKEN]').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[REDACTED]@');
}
