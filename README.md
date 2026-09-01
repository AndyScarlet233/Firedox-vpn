# Firefox IP Protection Bridge for Chromium

非官方的 Windows-first Chromium 浏览器扩展原型：通过本地 Native
Messaging 桥接，在 Chromium 系浏览器中使用用户自己有资格使用的 Firefox
IP Protection 服务，并提供按域名路由、WebRTC 防泄漏、路由范围的 DNS 预解析
防护和区域隐私设置。

> **重要：这是源码公开仓库，不是包含个人登录状态的一键安装包。**
> Firefox、Mozilla、Google、Fastly、Astral 及上游项目作者均未为本项目背书。

## 安全发布边界

本仓库经过脱敏后才公开：

- 不包含 Firefox Account 邮箱、UID、session/renewal credential、OAuth token、JWT、Cookie、密码或 API key；
- 不包含原始上传目录、ZIP、运行日志、机器路径、节点/延迟快照、Python 缓存、预构建 EXE/PYD 或私有运行时；
- `runtime/` 是本地生成目录，永远不要从个人安装目录复制进仓库；
- 凭据一旦进入共享归档或 Git 历史，应立即撤销/轮换，单纯删除文件不够。

## 目录

- `extension/` — 可在 `chrome://extensions` 中加载的 Manifest V3 扩展；
- `host/native_host.py` — Native Messaging 桥接源码；
- `vendor/firefox-ip-protection-pool/` — 经过筛选的上游派生后端源码；
- `config/native-messaging-host.example.json` — 不含秘密的 Native Messaging 清单示例；
- `scripts/audit_public_tree.py` — 发布前路径/凭据静态检查；
- `docs/` — 权限、数据流与构建限制说明。

## 加载扩展

1. 克隆本仓库。
2. 打开 `chrome://extensions`（Edge/Chromium 使用对应的扩展页面）。
3. 开启“开发者模式”，选择“加载已解压的扩展”，指向仓库的 `extension/` 目录。
4. 若本机已经安装并注册了兼容的 Native Host，扩展会使用清单中的固定扩展 ID 与它通信；否则扩展界面可以加载，但 VPN/账户导入等桥接功能会显示“本地桥接程序不可用”。

本次公开仓库保留了工作包中可加载的 `extension/` 文件；仓库不携带个人机器上的 Native Host 运行时和凭据。不要把私人安装目录或 `runtime/` 复制到 Git。

## 当前构建状态

原始工作包把预构建 Windows 运行时、系统 Python 路径、节点缓存和登录凭据混在一起，而且引用的 PowerShell 安装脚本并未随包提供。因此本仓库当前选择“可审计源码 + 可加载扩展”发布：没有未经审计的 Windows EXE/一键安装 Release。

要制作可供他人使用的 Release，还必须单独完成：

- 固定并验证上游提交、Python/uv/依赖版本和下载哈希；
- 重做可复现的 Windows 运行时构建与 Native Messaging 注册/卸载流程；
- 不覆盖用户凭据、不重置全局代理、不无条件终止同名进程；
- 生成完整第三方许可证清单、SBOM、签名和 secret scan 报告；
- 在干净 Windows 账户上测试扩展、Native Messaging、代理失败回退、DNS/WebRTC 泄漏和卸载。

## 数据流与高权限说明

扩展需要 `proxy`、`nativeMessaging`、`privacy`、
`declarativeNetRequestWithHostAccess`、`contentSettings`、`scripting`、
`activeTab`、`storage`、`management` 和 `<all_urls>` 权限。它会在用户启用
时控制浏览器代理，并在可选的区域保护开启时对网页的语言、时区、定位与
字体探测行为进行处理。内容脚本在 document start、all frames、主世界/隔离
世界运行；这是高信任设计，安装前请自行审计。

Native Host 只在本机处理 Firefox 登录状态，设计目标是不把原始 token 返回
给扩展页面或 Chrome storage。网络访问依赖 Mozilla Firefox Account/Guardian、
Firefox Remote Settings 和 Firefox IP Protection/Fastly 出口池，可能在多个后端
之间轮换；这不是完整的匿名系统。当前使用 Fastly-MASQUE 的 HTTPS CONNECT
兼容路径，不提供本地 QUIC/UDP/MASQUE 数据面。

详见 [`PRIVACY.md`](PRIVACY.md)、[`SECURITY.md`](SECURITY.md) 和
[`THIRD_PARTY.md`](THIRD_PARTY.md)。

## 发布前检查

在提交前运行：

```powershell
python scripts/audit_public_tree.py
python -m json.tool extension/manifest.json > $null
```

CI 还会检查 Python 语法和扩展清单。检查必须在干净 checkout 和完整 Git
历史上重复进行；不要把本地凭据放进 issue、截图或构建日志。

## 许可证

项目许可证见 [`LICENSE`](LICENSE)。上游派生代码的许可证见
[`vendor/firefox-ip-protection-pool/LICENSE`](vendor/firefox-ip-protection-pool/LICENSE)。
