#!/usr/bin/env python3
"""Per-user Linux installer. Configuration is read from stdin; never print it."""
import base64,gzip,hashlib,io,json,os,platform,posixpath,re,shlex,shutil,subprocess,sys,tarfile,tempfile,time,threading,urllib.request,zipfile
from pathlib import Path

HOME=Path.home()
BASE=HOME/'.local/share/cloud-codex-setup'
BIN=HOME/'.local/bin'
CONFIG={}

def emit(kind,message='',**extra):
    print(json.dumps({'type':kind,'message':message,**extra}),flush=True)

def atomic(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temp=path.with_name(path.name+'.setup-tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data.encode() if isinstance(data,str) else data)
    os.chmod(temp,0o600);os.replace(temp,path)

def backup(path):
    path=Path(path)
    if path.exists():
        dest=path.with_name(path.name+'.backup-'+str(time.time_ns()))
        shutil.copy2(path,dest);os.chmod(dest,0o600)

def environment():
    env=dict(os.environ)
    for k in list(env):
        if k.lower() in ('http_proxy','https_proxy','all_proxy','npm_config_proxy','npm_config_https_proxy'):env.pop(k,None)
    proxy=CONFIG.get('proxyUrl','')
    if proxy:
        for k in ('HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','npm_config_proxy','npm_config_https_proxy'):env[k]=proxy
    env['NO_PROXY']='127.0.0.1,localhost,::1';env['no_proxy']=env['NO_PROXY']
    node=BASE/'node'/('node-v'+CONFIG['nodeVersion']+'-linux-'+arch())/'bin'
    env['PATH']=str(node)+os.pathsep+str(BIN)+os.pathsep+env.get('PATH','')
    return env

def arch():
    value=platform.machine()
    if value in ('x86_64','amd64'):return 'x64'
    if value in ('aarch64','arm64'):return 'arm64'
    raise RuntimeError('仅支持 Linux x86_64 / ARM64。')

def run(args,stage,timeout=600,input=None):
    log=BASE/(stage+'.private.log')
    fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    try:
        with os.fdopen(fd,'wb') as output:
            result=subprocess.run([str(x) for x in args],input=input,stdout=output,stderr=subprocess.STDOUT,env=environment(),timeout=timeout)
    except subprocess.TimeoutExpired:raise RuntimeError(stage+' 超时；原始日志仅留在远端私有目录。')
    if result.returncode:raise RuntimeError(stage+' 失败，退出码 '+str(result.returncode)+'；未回显原始日志。')
    return log

def download(url,target):
    proxy=CONFIG.get('proxyUrl','')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({'http':proxy,'https':proxy} if proxy else {}))
    req=urllib.request.Request(url,headers={'User-Agent':'CloudCodexSetup/1.0','Accept-Encoding':'identity'})
    with opener.open(req,timeout=90) as response,open(target,'wb') as out:shutil.copyfileobj(response,out)

def safe_extract(archive,destination):
    destination=Path(destination).resolve()
    with tarfile.open(archive,'r:gz') as tf:
        for item in tf.getmembers():
            name=posixpath.normpath(item.name)
            if name.startswith('/') or name=='..' or name.startswith('../') or item.isdev() or item.isfifo():raise RuntimeError('拒绝不安全的压缩包路径。')
            if item.issym() or item.islnk():
                target=posixpath.normpath(posixpath.join(posixpath.dirname(name),item.linkname)) if item.issym() else posixpath.normpath(item.linkname)
                if item.linkname.startswith('/') or target=='..' or target.startswith('../'):raise RuntimeError('拒绝不安全的压缩包链接。')
        # Python's data filter prevents link-based escapes as well as lexical traversal.
        if hasattr(tarfile,'data_filter'):tf.extractall(destination,filter='data')
        else:
            # Old Python cannot safely extract arbitrary symlink archives.
            if any(x.issym() or x.islnk() for x in tf.getmembers()):raise RuntimeError('此档案含符号链接，请升级服务器 Python 至 3.12+。')
            tf.extractall(destination)

def install_node():
    version=CONFIG['nodeVersion'];name='node-v'+version+'-linux-'+arch()
    parent=BASE/'node';target=parent/name
    if (target/'bin/node').exists():return target
    emit('stage','下载并校验官方 Node.js 运行时。')
    parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='node-download-',dir=BASE) as tmp:
        temp=Path(tmp);file=name+'.tar.gz';base='https://nodejs.org/dist/v'+version+'/'
        download(base+'SHASUMS256.txt',temp/'sums');download(base+file,temp/file)
        sums=dict(line.split()[::-1] for line in (temp/'sums').read_text().splitlines() if len(line.split())==2)
        expected=sums.get(file)
        if not expected or hashlib.sha256((temp/file).read_bytes()).hexdigest()!=expected:raise RuntimeError('Node.js 官方 SHA-256 校验失败。')
        safe_extract(temp/file,temp/'extract')
        if target.exists():raise RuntimeError('Node 目标目录已存在且不完整，保留原目录。')
        shutil.move(str(temp/'extract'/name),target)
    return target

def write_proxy():
    proxy=CONFIG.get('proxyUrl','')
    text=''
    if proxy:
        text='export HTTP_PROXY='+shlex.quote(proxy)+'\nexport HTTPS_PROXY='+shlex.quote(proxy)+'\nexport ALL_PROXY='+shlex.quote(proxy)+'\nexport NO_PROXY=127.0.0.1,localhost,::1\n'
    atomic(BASE/'proxy.env',text)

NPM_REGISTRY='https://registry.npmjs.org'
STABLE_VERSION=r'\d+\.\d+\.\d+'

def codex_version_policy(value='latest'):
    if value!='latest' and (not isinstance(value,str) or not re.fullmatch(STABLE_VERSION,value)):
        raise RuntimeError('Codex 版本参数不正确；仅使用 latest 稳定版。')
    return 'latest'


def latest_codex_version(node):
    emit('stage','查询 npm 官方源的 Codex CLI 最新稳定版。')
    log=run([node/'bin/node',node/'lib/node_modules/npm/bin/npm-cli.js','view','@openai/codex','dist-tags.latest','--json','--registry',NPM_REGISTRY,'--prefer-online','--prefer-offline=false','--offline=false','--@openai:registry='+NPM_REGISTRY,'--fetch-retries=1','--fetch-timeout=30000'],'codex-latest',120)
    try:
        value=json.loads(log.read_text(encoding='utf-8'))
    except (OSError,ValueError):raise RuntimeError('npm latest 响应无效，未使用缓存版本代替最新版。')
    if not isinstance(value,str) or not re.fullmatch(STABLE_VERSION,value):
        raise RuntimeError('npm latest 未返回有效稳定版本，安装未通过。')
    return value


def codex_runtime_version(node,entry):
    log=run([node/'bin/node',entry,'--version'],'codex-version',120)
    match=re.fullmatch(r'codex-cli ('+STABLE_VERSION+r')',log.read_text(encoding='utf-8').strip())
    if not match:raise RuntimeError('Codex CLI 未返回有效的实际版本号。')
    return match.group(1)


def codex_package_version(package):
    try:
        value=json.loads(package.read_text(encoding='utf-8'))
        return value.get('version') if isinstance(value,dict) else None
    except (OSError,ValueError):return None


def install_codex():
    node=install_node();npm=BASE/'npm'
    package=npm/'lib/node_modules/@openai/codex/package.json'
    entry=package.parent/'bin/codex.js'
    # Query on every run; an old marker or cached package cannot establish latest.
    for attempt in range(2):
        version=latest_codex_version(node)
        emit('info','本次查询的 Codex CLI 最新稳定版：'+version+'。')
        actual=None
        if entry.exists() and codex_package_version(package)==version:
            try:actual=codex_runtime_version(node,entry)
            except RuntimeError:emit('info','现有 Codex 无法通过版本检查，重新安装。')
        if actual!=version:
            emit('stage','从 npm 官方源安装 / 升级 Codex CLI '+version+'。')
            run([node/'bin/node',node/'lib/node_modules/npm/bin/npm-cli.js','install','--global','--prefix',npm,'--registry',NPM_REGISTRY,'--prefer-online','--prefer-offline=false','--offline=false','--@openai:registry='+NPM_REGISTRY,'--no-audit','--no-fund','@openai/codex@'+version],'codex-install',2400)
            actual=codex_runtime_version(node,entry)
        if actual!=version or codex_package_version(package)!=version:
            raise RuntimeError('Codex CLI 实际版本与官方目标版本不一致，安装未通过。')
        if latest_codex_version(node)==version:break
        emit('info','安装期间 npm latest 已更新，重新查询并升级。')
    else:raise RuntimeError('npm latest 在安装期间持续变化，请重新安装；未宣告最新版验收成功。')
    BIN.mkdir(parents=True,exist_ok=True)
    wrapper=BIN/'codex';text='#!/usr/bin/env bash\nset -e\n'
    text+='export PATH='+shlex.quote(str(node/'bin'))+':"$PATH"\n'
    text+='source '+shlex.quote(str(BASE/'proxy.env'))+'\n'
    text+='exec '+shlex.quote(str(node/'bin/node'))+' '+shlex.quote(str(entry))+' "$@"\n'
    if wrapper.exists() and 'cloud-codex-setup' not in wrapper.read_text(errors='replace'):backup(wrapper)
    atomic(wrapper,text);os.chmod(wrapper,0o700)
    atomic(BASE/'installed-codex-version.txt',version+'\n')
    atomic(BASE/'installed-codex-release.json',json.dumps({'policy':'latest','version':version,'registry':NPM_REGISTRY,'verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})+'\n')
    emit('success','Codex CLI 最新稳定版 '+version+' 已安装并核对；运行路径 ~/.local/bin/codex。')


def configure_auth():
    mode=CONFIG['codexAuth']
    auth=HOME/'.codex/auth.json'
    if mode=='file':
        value=json.loads(CONFIG['authJson'])
        if not isinstance(value,dict) or not value:raise RuntimeError('Codex 登录文件不是有效对象。')
        digest=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        marker=BASE/'imported-auth.sha256'
        if auth.exists() and marker.exists() and marker.read_text().strip()==digest:
            emit('info','已导入同一登录文件，保留服务器当前已续期的登录状态。')
            return
        backup(auth);atomic(auth,json.dumps(value)+'\n')
        atomic(marker,digest+'\n')
        emit('success','用户提供的 Codex 登录文件已写入，已有文件已备份。')
    elif mode=='api':
        if not CONFIG.get('openaiKey'):raise RuntimeError('未提供 OpenAI API Key。')
        backup(auth)
        run([BIN/'codex','login','--with-api-key'],'codex-api-login',120,input=(CONFIG['openaiKey']+'\n').encode())
        if auth.exists():os.chmod(auth,0o600)
        emit('success','已通过标准输入完成 Codex API Key 登录。')
    else:emit('info','保留服务器现有登录；需要时使用设备码登录。')

def vscode_server():
    commit=CONFIG['vscodeCommit'];parent=HOME/'.vscode-server/cli/servers';target=parent/('Stable-'+commit)/'server'
    if (target/'bin/code-server').exists():return target
    if target.exists():raise RuntimeError('VS Code Server 目录不完整，未覆盖原目录。')
    emit('stage','从微软官方地址引导安装匹配的 VS Code Server。')
    parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='vscode-download-',dir=BASE) as tmp:
        tmp=Path(tmp);download('https://update.code.visualstudio.com/commit:'+commit+'/server-linux-'+arch()+'/stable',tmp/'server.tar.gz')
        safe_extract(tmp/'server.tar.gz',tmp/'extract')
        candidates=list((tmp/'extract').glob('*/bin/code-server'))
        if len(candidates)!=1:raise RuntimeError('VS Code Server 档案结构不正确。')
        folder=candidates[0].parent.parent
        if json.loads((folder/'product.json').read_text()).get('commit')!=commit:raise RuntimeError('VS Code Server commit 不匹配。')
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():raise RuntimeError('检测到并发服务端安装，保留现有目录。')
        shutil.move(str(folder),target)
    return target

def update_json(path,change):
    path=Path(path);doc=json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(doc,dict):raise RuntimeError('现有 Cline 配置不是 JSON 对象，已保留。')
    backup(path);change(doc);atomic(path,json.dumps(doc,indent=2)+'\n')

def normalize_vsix(source,target,version):
    data=Path(source).read_bytes()
    if data.startswith(b'\x1f\x8b'):data=gzip.decompress(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        meta=json.loads(archive.read('extension/package.json'))
        if meta.get('publisher')!='saoudrizwan' or meta.get('name')!='claude-dev' or meta.get('version')!=version:raise RuntimeError('Cline 扩展身份或版本不匹配。')
        if sum(item.file_size for item in archive.infolist())>512*1024*1024:raise RuntimeError('Cline 解压内容超过大小限制。')
        for item in archive.infolist():
            name=posixpath.normpath(item.filename)
            if name.startswith('/') or name=='..' or name.startswith('../'):raise RuntimeError('Cline 扩展含不安全档案路径。')
        if archive.testzip() is not None:raise RuntimeError('Cline 扩展 ZIP 校验失败。')
    atomic(target,data)

def configure_cline():
    if not CONFIG.get('clineEnabled'):emit('info','未启用 Cline，跳过扩展与模型配置。');return
    server=vscode_server();version=CONFIG['clineVersion']
    emit('stage','下载并检查 Cline 通用扩展包。')
    vsix=BASE/('cline-'+version+'.vsix')
    if not vsix.exists():
        temp=vsix.with_suffix('.part');ready=False
        if temp.exists():
            try:normalize_vsix(temp,vsix,version);ready=True
            except (OSError,EOFError,ValueError,KeyError,RuntimeError,zipfile.BadZipFile):pass
        if not ready:
            download('https://marketplace.visualstudio.com/_apis/public/gallery/publishers/saoudrizwan/vsextensions/claude-dev/'+version+'/vspackage',temp)
            normalize_vsix(temp,vsix,version)
    key=CONFIG['clineKey'];model=CONFIG['clineModel'];data=HOME/'.cline/data'
    def provider(doc):
        doc.setdefault('version',1);doc.setdefault('modes',{});doc['lastUsedProvider']='deepseek'
        doc.setdefault('providers',{})['deepseek']={'settings':{'provider':'deepseek','apiKey':key,'model':model,'baseUrl':'https://api.deepseek.com','reasoning':{'effort':'none'}},'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'tokenSource':'manual'}
    update_json(data/'settings/providers.json',provider)
    update_json(data/'globalState.json',lambda doc:doc.update({'planModeApiProvider':'deepseek','actModeApiProvider':'deepseek','planModeApiModelId':model,'actModeApiModelId':model,'welcomeViewCompleted':True,'isNewUser':False}))
    update_json(data/'secrets.json',lambda doc:doc.update({'deepSeekApiKey':key}))
    run([server/'bin/code-server','--extensions-dir',HOME/'.vscode-server/extensions','--user-data-dir',HOME/'.vscode-server/data','--install-extension',vsix],'cline-install',300)
    emit('success','Cline 4.1.25 已安装并配置；模型 API 验证需单独执行。')

def login_status():
    result=subprocess.run([BIN/'codex','login','status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=environment(),timeout=30)
    return result.returncode==0

def device_login():
    emit('stage','等待设备码登录；请在浏览器中完成本人授权。')
    process=subprocess.Popen([str(BIN/'codex'),'login','--device-auth'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,text=True,env=environment(),bufsize=1)
    deadline=threading.Timer(900,process.terminate);deadline.daemon=True;deadline.start()
    started=time.time();url='';code='';http_status=''
    try:
        # The parent SSH operation has its own deadline; no device code is written to disk.
        for raw in process.stdout:
            line=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',raw)
            found_url=re.search(r'https://auth\.openai\.com/codex/device(?:\?[A-Za-z0-9/_?=.&-]+)?',line)
            if found_url:url=found_url.group(0)
            found_code=re.search(r'\b[A-Z0-9]{4,6}-[A-Z0-9]{4,6}\b',line)
            if found_code:code=found_code.group(0)
            status=re.search(r'\b(?:HTTP(?:/\d(?:\.\d)?)?\s*|status(?:\s+code)?\s*[:=]?\s*)([45]\d\d)\b',line,re.I)
            if status:http_status=status.group(1)
            if found_url or found_code:emit('device','请打开官方授权地址并输入设备码。',url=url,code=code)
            if time.time()-started>900:raise RuntimeError('设备授权等待超时。')
        rc=process.wait(timeout=30)
        if rc or not login_status():raise RuntimeError('设备授权未完成或账户不允许设备登录，请检查账户设置或导入登录文件。'+(' HTTP '+http_status if http_status else ''))
    finally:
        deadline.cancel()
        if process.poll() is None:process.terminate()
    emit('success','Codex 设备码登录成功。')

def evidence(events,final):
    if final.strip()!='TOOL_OK':return False
    for line in events.splitlines():
        try:item=json.loads(line).get('item',{})
        except (ValueError,AttributeError):continue
        if item.get('type')=='command_execution' and item.get('status')=='completed' and item.get('exit_code')==0 and str(item.get('aggregated_output','')).strip()=='TOOL_OK' and re.search(r'\bprintf\s+[\x22\x27]?TOOL_OK',str(item.get('command',''))):return True
    return False

def verify():
    if not login_status():emit('login_required','工具已安装。请先点击设备码登录，或导入有效登录文件。');return False
    emit('stage','调用 Codex 验证真实回复和实际 shell 命令执行。')
    report=BASE/'validation';report.mkdir(exist_ok=True);os.chmod(report,0o700)
    sandbox='workspace-write'
    if CONFIG.get('containerFullAccess'):
        isolated=Path('/.dockerenv').exists() or Path('/run/.containerenv').exists() or bool(re.search(r'\s/\s.* - overlay ',Path('/proc/self/mountinfo').read_text()))
        if not isolated:raise RuntimeError('容器完整权限选项仅适用于已识别的隔离容器。')
        sandbox='danger-full-access'
    for kind,prompt in [('reply','Reply with exactly EXT_OK. Do not use tools.'),('tool','Use the shell tool to run printf TOOL_OK, then reply with exactly TOOL_OK.')]:
        output=report/(kind+'-final.txt');atomic(output,'')
        log=run([BIN/'codex','exec','--json','--skip-git-repo-check','--sandbox',sandbox,'-C',report,'-o',output,prompt],kind+'-request',240)
        text=output.read_text().strip()
        if kind=='reply' and text!='EXT_OK':raise RuntimeError('真实回复不是精确 EXT_OK。')
        if kind=='tool' and not evidence(log.read_text(errors='replace'),text):raise RuntimeError('未证实真正执行 printf TOOL_OK；不能只凭最终文本通过。')
        emit('success','Codex 真实回复 EXT_OK。' if kind=='reply' else 'Codex 实际 shell 执行成功，最终 TOOL_OK。')
    atomic(report/'result.json',json.dumps({'reply':'EXT_OK','shellExecution':True,'toolReply':'TOOL_OK','time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})+'\n')
    return True

def model_test():
    if not CONFIG.get('clineEnabled'):raise RuntimeError('未启用 Cline 或没有模型配置。')
    proxy=CONFIG.get('proxyUrl','');opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':proxy} if proxy else {}))
    data={'model':CONFIG['clineModel'],'messages':[{'role':'user','content':'Reply with exactly CLINE_OK.'}],'max_tokens':256,'temperature':0,'thinking':{'type':'disabled'}}
    req=urllib.request.Request('https://api.deepseek.com/chat/completions',data=json.dumps(data).encode(),headers={'Authorization':'Bearer '+CONFIG['clineKey'],'Content-Type':'application/json'})
    with opener.open(req,timeout=120) as response:reply=json.load(response)
    if reply['choices'][0]['message'].get('content','').strip()!='CLINE_OK':raise RuntimeError('模型未返回精确 CLINE_OK。')
    emit('success','DeepSeek 真实 API 回复 CLINE_OK；这不是 Cline 面板 UI 对话测试。')

def main():
    global CONFIG
    CONFIG=json.load(sys.stdin)
    CONFIG['codexVersion']=codex_version_policy(CONFIG.get('codexVersion','latest'))
    for key in ('nodeVersion','clineVersion'):
        if not re.fullmatch(r'\d+\.\d+\.\d+',CONFIG[key]):raise RuntimeError('版本参数不正确。')
    if CONFIG.get('clineEnabled') and not re.fullmatch(r'[a-f0-9]{40}',CONFIG.get('vscodeCommit','')):raise RuntimeError('VS Code commit 不正确。')
    if platform.system()!='Linux':raise RuntimeError('目标服务器需要 Linux。')
    BASE.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(BASE,0o700);arch();write_proxy()
    action=sys.argv[1]
    if action in ('install','setup'):
        install_codex();configure_auth();configure_cline()
        if action=='setup':verify()
    elif action=='verify':verify()
    elif action=='login':device_login()
    elif action=='model-test':model_test()
    elif action=='tunnel':emit('success','代理通道已就绪；保持本地程序运行以维持本机代理转发。')
    else:raise RuntimeError('未知操作。')

if __name__=='__main__':
    try:main()
    except Exception as exc:
        # Report curated messages only. Network errors may include credentials in their URL.
        message=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__+'：请检查网络、依赖或私有日志。'
        emit('error',message);sys.exit(1)
