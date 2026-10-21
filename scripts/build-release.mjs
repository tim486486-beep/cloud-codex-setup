import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const out=resolve(process.argv[2]||join(root,'..','public-releases'));
mkdirSync(out,{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const dirs=['src','public','server','tests','scripts'];
const top=['package.json','package-lock.json','README.md','使用教程.md','AGENTS.md','SECURITY.md','THIRD_PARTY.md','LICENSE','.gitignore','.gitattributes','start.cmd','start.sh'];
function tree(dir){return readdirSync(dir).sort().flatMap(n=>{const p=join(dir,n);if(lstatSync(p).isSymbolicLink())throw Error('Release symlink rejected');if(['__pycache__','test','examples','bench'].includes(n))return [];return lstatSync(p).isDirectory()?tree(p):[p];});}
const own=[...top.map(n=>join(root,n)),...dirs.flatMap(n=>tree(join(root,n)))].filter(p=>!p.endsWith('.pyc'));
for(const p of own){const s=readFileSync(p,'utf8');if(/sk-[a-f0-9]{32,}|-----BEGIN (?:OPENSSH |RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{32}/i.test(s))throw Error('Credential-like content rejected: '+relative(root,p));}
function stage(name,portable){
  const folder=join(out,name),zip=folder+'.zip';if(existsSync(folder)||existsSync(zip))throw Error('Release target exists; use a fresh output folder');mkdirSync(folder);
  let files=[...own];
  if(portable){const exe=join(root,'runtime','node.exe');if(hash(exe)!=='3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237')throw Error('Bundled Node hash mismatch');files.push(...tree(join(root,'runtime')),...['ssh2','asn1','bcrypt-pbkdf','safer-buffer','tweetnacl'].flatMap(n=>tree(join(root,'node_modules',n))));}
  else files.push(...tree(join(root,'runtime')).filter(p=>!p.endsWith('.exe')));
  for(const p of files){const target=join(folder,relative(root,p));mkdirSync(dirname(target),{recursive:true});copyFileSync(p,target);}
  const staged=tree(folder);writeFileSync(join(folder,'MANIFEST.sha256'),staged.map(p=>hash(p)+'  '+relative(folder,p).replaceAll('\\','/')).join('\n')+'\n');
  const py='import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for p in sorted(root.rglob("*")):\n  if p.is_file(): z.write(p,p.relative_to(root.parent))\n';
  const result=spawnSync(process.env.CLOUD_CODEX_PYTHON||'python',['-c',py,folder,zip],{encoding:'utf8',windowsHide:true,timeout:180000});if(result.status!==0)throw Error('ZIP build failed; Python 3 required');
  writeFileSync(zip+'.sha256',hash(zip)+'  '+name+'.zip\n');console.log(name+' READY '+(staged.length+1)+' files');
}
stage('cloud-codex-setup-source-v'+version,false);
if(existsSync(join(root,'runtime','node.exe')))stage('cloud-codex-setup-windows-x64-v'+version,true);
