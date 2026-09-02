# Firefox IP Protection Bridge for Chromium

一个非官方的 Chromium 浏览器扩展，通过本地 Native Messaging + SOCKS5 桥接，让 Chrome、Edge 等 Chromium 浏览器使用符合资格的 Firefox IP Protection 服务。

## 主要功能

- 一键开启/关闭 VPN，并选择或自动推荐出口地区。
- 支持白名单、黑名单两种按网站分流模式。
- 可从 Firefox 导入账户凭据，并查询本月套餐、已用流量、剩余流量和重置时间。
- 提供 WebRTC 防泄漏、DNS 预解析防护和区域隐私保护。
- 通过本地 Native Host 连接 Firefox IP Protection，原始账户令牌不会写入扩展页面或 Chrome storage。

## 项目结构

- `extension/`：Chromium 扩展源码。
- `host/`：Native Messaging 桥接源码。
- `vendor/firefox-ip-protection-pool/`：后端兼容代码。
- `scripts/`：安装/修复及仓库检查脚本。

本项目为非官方实现，与 Mozilla、Google、Fastly 等无隶属或背书关系。公开仓库仅保存源码，不包含个人凭据、日志或本机运行时文件。
