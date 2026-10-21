import ssh2 from 'ssh2';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
export function localIdentity(p){
  const keyPath=p.keyPath||[join(homedir(),'.ssh','id_ed25519'),join(homedir(),'.ssh','id_rsa')].find(existsSync);
  if(!keyPath)throw Error('未找到本机私钥。请先生成自己的 SSH 密钥对，再填写私钥路径。');
  let parsed;
  try{parsed=ssh2.utils.parseKey(readFileSync(keyPath),p.passphrase||undefined);}catch{throw Error('无法读取本机私钥，请检查路径和文件权限。');}
  if(parsed instanceof Error)throw Error('无法解析本机私钥，请检查格式及私钥密码短语。');
  if(Array.isArray(parsed)){if(parsed.length!==1)throw Error('请选择只包含一个身份的私钥文件。');parsed=parsed[0];}
  if(!parsed?.isPrivateKey())throw Error('请选择不带 .pub 的私钥文件；程序只上传由它推导的公钥。');
  return {keyPath,publicKey:parsed.type+' '+Buffer.from(parsed.getPublicSSH()).toString('base64')+' cloud-codex-setup'};
}
