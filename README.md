# Cloud Codex Setup

一个在本机运行的配置向导：保存用户提供的 SSH、Codex 登录和代理信息，然后通过 SSH 为 Linux 服务器安装 Codex CLI，可选安装 Cline / DeepSeek。与云厂商无关；不会租用、重建、开关或删除实例。

**本项目无需依赖 SSH 反向隧道代理。** 服务器可直连，或使用用户提供的服务器端代理；“通过 SSH 转发本机 HTTP 代理”仅为可选方案，选择该方案时才需要保持本机程序和 SSH 通道运行。

关键词：`Codex` · `Codex CLI` · `Cline` · `DeepSeek` · `SSH` · `Linux` · `Windows` · 云服务器部署 · 远程开发 · 自动安装 · 本地配置向导。

## 下载

- [Windows x64 便携版 v1.1.0](https://github.com/tim486486-beep/cloud-codex-setup/releases/download/v1.1.0/cloud-codex-setup-windows-x64-v1.1.0.zip)：内置 Node.js，解压后双击 start.cmd。
- [源码版与 SHA-256 校验文件](https://github.com/tim486486-beep/cloud-codex-setup/releases/tag/v1.1.0)。

使用教程直接位于项目和解压包的根目录。

## 已验证范围

Windows 客户端到 Linux x86_64 已验证 SSH 密码与私钥、Codex 登录文件导入、本人设备码授权后的真实 EXT_OK 回复与 shell 执行 TOOL_OK、DeepSeek API 和 SSH 本机代理转发。设备码登录本次在本机 HTTP 代理经 SSH 转发的线路上通过；原服务器代理线路未完成令牌交换。

Cline 4.1.25 面板真实会话已在正常 GPU 模式下完成：微软 VS Code Web 工作台通过 SSH 回环隧道访问，DeepSeek 模型在面板返回 CLINE_PANEL_OK，任务状态为 COMPLETED，持久化记录确认回复角色为 assistant。桌面 VS Code Remote - SSH 的面板交互未单独复测。

OpenAI API Key 已在 Windows 本机隔离的 CODEX_HOME 中通过标准输入登录，确认保存为 apikey 模式，官方模型列表接口返回 HTTP 200。一次最小模型请求返回 HTTP 429 / credit_balance_exhausted；尚未完成 API Key 模式的服务器部署及 Codex 真实模型回复验收。临时明文登录文件在检查后删除，未覆盖现有登录。另一云厂商、ARM64、非 root 实机部署及非 Windows 本地客户端也未逐项实测。

1.1.0 新增安装时自动跟随 Codex CLI 官方最新稳定版，兼容旧配置并核对实际运行版本。1.0.7 更新了 Cline 面板验收范围和操作说明。1.0.6 修复了 Windows 直接运行 CLI 时中文配置的子进程编码问题，以及设备登录失败时误把令牌 API 地址当成授权网页的问题。

## 完整使用教程

第一次使用请阅读 [使用教程](使用教程.md)：包含逐步填表、SSH 指纹核对、登录与代理选择、安装验收、日常使用、Agent 操作和常见问题排查。

## 快速开始

**Windows 便携版**：完整解压后双击 `start.cmd`。内置 Node.js 和 SSH 依赖，无需先安装 Node。浏览器打开的页面仅监听本机回环地址；保留启动窗口以维持连接。

**源码版**：安装 Node.js 22+，在项目目录运行：

```sh
npm ci --omit=optional
npm start
```

源码版不带 node_modules 和 Node 二进制。项目自身使用 MIT 许可证；第三方工具保留各自许可证。

## 使用流程

1. 输入 SSH 命令或主机、端口和用户名。支持已有私钥、SSH Agent 或密码。使用私钥时无需另填服务器密码；有密码短语的私钥可另外填写短语。
2. 选择 Codex 登录方式：稍后设备码登录、导入自己的 `auth.json`、OpenAI API Key，或保留服务器已有登录。Codex 与 Cline 使用的 key 分开保存。
3. 选择直连、服务器可访问的代理，或通过 SSH 转发本机 HTTP 代理。代理地址、账号和密码全部由使用者提供；本包不含代理节点、订阅或 mihomo 配置。
4. 如需要 Cline，启用可选项，填写自己的 DeepSeek key 和当前可用模型。VS Code commit 会从本机安装目录自动检测，也可手动填写。当前配置结构适配 Cline 4.1.25。
5. 保存。点击“检查 SSH”，向服务器提供方核实首次主机指纹后信任。指纹改变时拒绝连接，不会自动关闭校验。
6. 点击“安装 / 升级并验证”。选择设备码登录且服务器尚未登录时，先完成安装，页面提示等待本人登录；点击“设备码登录”并在 OpenAI 官方网页完成授权，再点击“验证 Codex”。

验证会发送两次小量真实 Codex 请求，使用所选账号额度。只有最终精确 `EXT_OK`、真实命令执行成功和最终 `TOOL_OK` 同时成立，才记录验证成功。`login status` 或版本号不等于真实调用成功。

## 获取最新版与后续升级

选择已保存的配置，点击“安装 / 升级并验证”；Agent 也可运行 `node src/cli.mjs run PROFILE_ID install` 只安装 / 升级，不发送模型请求。每次都会在线查询 npm 官方稳定版 `latest`，已有版本符合且实际运行检查通过时跳过重复下载安装。界面日志显示具体版本，远端 `~/.local/share/cloud-codex-setup/installed-codex-release.json` 记录版本与核对时间。

“最新版”以安装结束时再次查询的官方结果为准。若安装期间上游更新，会重新查询并尝试升级；持续变化或无法确认时明确失败。之后上游发布新版时，再运行安装 / 升级即可更新。仅点击“验证 Codex”不会升级。本工具不启动后台定时更新。

## 配置保存在哪里

Windows：当前用户的 `%LOCALAPPDATA%\CloudCodexSetup`。完整配置使用 Windows DPAPI CurrentUser 加密；没有明文降级模式。只能由原 Windows 用户解密，不适合作为跨 PC 备份。

Linux/macOS 本地客户端：用户配置目录中的 AES-256-GCM 文件，密钥文件和目录限制为当前用户读写。密钥也保存在该用户目录，因此不能抵御可完整读取该用户目录的攻击者。Windows 是本轮便携客户端的主要验证平台。

密码、key、导入的登录内容不会写入源码目录或浏览器 localStorage。配置列表只返回脱敏字段；留空编辑秘密字段会保留原值。更换认证类型会清除不适用的凭据。退出后重新打开，仍可选择已保存的配置。

## 服务端行为

目标：Linux x86_64 / ARM64，Bash、Python 3.12+、约 2GB 可用空间、可通过所选代理或直连访问官方源。默认使用当前 SSH 用户，支持非 root，不修改 sshd 配置，不需要 SFTP，不自动 apt 或 sudo。

- 运行文件和私有日志：`~/.local/share/cloud-codex-setup`；安装 Node 至用户目录，校验 nodejs.org 发布的 SHA-256。
- Codex CLI：每次安装 / 升级都从 npm 官方源实时查询 `latest` 稳定版本，安装该明确版本，并核对包版本、实际 `codex --version` 及安装后的官方 `latest`；旧配置中的固定 Codex 版本自动切换为此策略。查询失败或版本不符时明确报错，不使用旧版本充当最新版。入口 `~/.local/bin/codex`；已有其他入口会先备份。直接调用时可使用完整路径，或自行把 `~/.local/bin` 加入 PATH。
- Codex 登录：当前 SSH 用户的 `~/.codex/auth.json`。首次导入前备份已有文件，设置私密文件权限；重复使用同一导入内容会保留服务器已续期的登录状态，重新选择不同内容才再次导入。没有有效登录文件时，不会凭空创建有效凭据。设备授权仍必须由账号本人完成；部分组织可能不允许设备码登录。
- Cline：从 VS Marketplace 下载并检查扩展身份与版本；从微软官方源引导匹配本机 commit 的 VS Code Server，使用其 CLI 安装扩展。缺少 VS Code 时可只安装 Codex。自动配置和 DeepSeek API 成功不代表已观察到 Cline 面板 UI 对话。
- 默认验证使用 `workspace-write`。不支持沙箱的专用容器可由用户显式勾选容器完整权限；程序还会核查容器标记，不会对未知共享主机自动放宽隔离。

远端依赖在首次安装时下载，便携版并非完全离线安装包。Codex 安装阶段最多等待 40 分钟，整条远程安装最多 60 分钟，设备码授权最多 15 分钟；慢速网络可能需要重试，已完成的工具与 npm 缓存会保留。HTTPS 下载错误、认证过期、平台不兼容会明确失败。Python 3.12 以下若不具备安全 tar filter，包含符号链接的档案会拒绝提取。

## 代理的两种位置

“服务器代理”中的 `127.0.0.1` 指服务器本身；“本机代理”中的 `127.0.0.1` 指运行此程序的 PC。不能混用。

本机模式通过同一条已验证 SSH 连接，在服务器的回环地址申请临时端口。关闭程序或断开连接会停止该代理通道；需要继续使用时重新选配置并点击“保持代理通道”，程序会更新远端代理环境。未使用本机代理时无需保持窗口来维持网络。

## 交给本地 Agent

让 Agent 阅读 `AGENTS.md`。配置一次后，Agent 可以直接使用保存的数据，避免把凭据复制进聊天：

```sh
node src/cli.mjs profiles
node src/cli.mjs run PROFILE_ID probe
node src/cli.mjs run PROFILE_ID setup
node src/cli.mjs run PROFILE_ID login
node src/cli.mjs run PROFILE_ID verify
node src/cli.mjs run PROFILE_ID model-test
```

Windows 便携版可以把上面的 `node` 换成 `.\runtime\node.exe`。未知主机需先核实指纹，再使用 `trust PROFILE_ID SHA256:FINGERPRINT` 保存信任。CLI 的本机代理模式会保持运行，按 Ctrl+C 才断开。

本轮最新版策略新增了升级、离线失败、版本不符和上游版本变化的回归测试；官方 npm 的真实独立安装另在 Windows x64 隔离目录核对。此项未重新启动 Linux 测试实例，不替代 Linux 服务器端完整复测。

## 开发与验证

```sh
npm test
python -m unittest discover -s tests -p "test_*.py"
```

测试使用合成密码和临时生成的 SSH 主机密钥，覆盖加密存储、未授权 HTTP、跨来源请求、脱敏、未知/变化主机指纹、真实回环 SSH 投递、压缩包越界拒绝以及真实命令执行证据。不会连接任何预设云服务器。

打包时使用 `scripts/build-release.mjs`，只复制明确允许的源码及可选公开依赖，生成源代码 ZIP 和 Windows 便携 ZIP。运行资料不在项目目录；不要把自己的用户配置目录、远端私有日志或登录文件添加到仓库。

Codex 官方参考：[认证](https://developers.openai.com/codex/auth)、[CLI](https://developers.openai.com/codex/cli)、[命令参考](https://developers.openai.com/codex/cli/reference)。实际参数以所选 CLI 版本帮助为准。
