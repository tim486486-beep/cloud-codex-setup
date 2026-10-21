#!/usr/bin/env python3
"""Append only a supplied public key to the current SSH user's authorized_keys."""
import base64,json,os,stat,sys,time
from pathlib import Path

def authorize(public_key,home=None):
    if not isinstance(public_key,str) or len(public_key)>16384 or '\n' in public_key or '\r' in public_key:
        raise ValueError('公钥必须为单行 OpenSSH 公钥。')
    fields=public_key.split()
    if len(fields)!=3 or fields[2]!='cloud-codex-setup' or fields[0] not in ('ssh-ed25519','ssh-rsa','ecdsa-sha2-nistp256','ecdsa-sha2-nistp384','ecdsa-sha2-nistp521'):
        raise ValueError('不支持的公钥格式。')
    try:
        raw=base64.b64decode(fields[1],validate=True)
        size=int.from_bytes(raw[:4],'big')
        if not size or raw[4:4+size].decode('ascii')!=fields[0] or len(raw)<=4+size:raise ValueError()
    except (ValueError,UnicodeError):raise ValueError('公钥编码无效。') from None
    directory=Path(home or Path.home())/'.ssh'
    if directory.is_symlink():raise ValueError('为保护已有配置，不修改符号链接形式的 .ssh 目录。')
    directory.mkdir(mode=0o700,parents=False,exist_ok=True)
    if hasattr(os,'geteuid') and directory.stat().st_uid!=os.geteuid():raise ValueError('.ssh 目录不属于当前 SSH 用户。')
    target=directory/'authorized_keys'
    if target.is_symlink():raise ValueError('为保护已有配置，不修改符号链接形式的 authorized_keys。')
    fd=os.open(target,os.O_RDWR|os.O_CREAT|getattr(os,'O_NOFOLLOW',0),0o600)
    with os.fdopen(fd,'r+b') as out:
        st=os.fstat(out.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or (hasattr(os,'geteuid') and st.st_uid!=os.geteuid()):
            raise ValueError('authorized_keys 必须为当前用户拥有的普通文件，且不能有硬链接。')
        # Lock the inode during read/backup/append; no rewrite of unrelated keys.
        if os.name=='posix':
            import fcntl
            until=time.monotonic()+10
            while True:
                try:fcntl.flock(out.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB);break
                except BlockingIOError:
                    if time.monotonic()>until:raise ValueError('其他进程正在修改公钥文件，请稍后重试。')
                    time.sleep(.1)
        old=out.read(4*1024*1024+1)
        if len(old)>4*1024*1024:raise ValueError('现有公钥文件过大，已保留原文件。')
        wanted=fields[1].encode();kind=fields[0].encode()
        present=False
        for line in old.splitlines():
            if line.lstrip().startswith(b'#'):continue
            parts=line.split()
            if any(parts[i]==kind and parts[i+1]==wanted for i in range(len(parts)-1)):present=True;break
        if not present:
            if old:
                backup=target.with_name('authorized_keys.backup-'+str(time.time_ns()))
                with os.fdopen(os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as saved:saved.write(old)
            out.seek(0,2)
            out.write((b'\n' if old and not old.endswith(b'\n') else b'')+public_key.encode('ascii')+b'\n')
            out.flush();os.fsync(out.fileno())
        os.chmod(directory,0o700);os.fchmod(out.fileno(),0o600) if hasattr(os,'fchmod') else os.chmod(target,0o600)
    return {'alreadyPresent':present}

def main():
    try:
        result=authorize(json.load(sys.stdin).get('publicKey'))
        print(json.dumps(result),flush=True)
    except (ValueError,OSError,TypeError) as error:
        # Do not echo supplied key material, account paths or raw system errors.
        message=str(error) if isinstance(error,ValueError) else '无法安全追加公钥，请检查当前用户的目录权限。'
        print(json.dumps({'error':message}),flush=True);return 1
    return 0
if __name__=='__main__':sys.exit(main())
